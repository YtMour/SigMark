package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/time/rate"
)

//go:embed web schema.sql
var assets embed.FS

type server struct {
	db    *pgxpool.Pool
	token string
	batch string
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	token, batch := os.Getenv("ADMIN_TOKEN"), os.Getenv("LAN_BATCH")
	if strings.TrimSpace(token) != token || token == "" || strings.ContainsAny(token, "\r\n\t ") || !batchPattern.MatchString(batch) {
		log.Fatal("configure ADMIN_TOKEN and a valid LAN_BATCH")
	}
	db, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal("invalid database configuration")
	}
	defer db.Close()
	startup, cancel := context.WithTimeout(ctx, 10*time.Second)
	schema, _ := assets.ReadFile("schema.sql")
	_, err = db.Exec(startup, string(schema))
	cancel()
	if err != nil {
		log.Fatal("database schema initialization failed")
	}
	s := server{db, token, batch}
	go s.prune(ctx)
	srv := listener(":8080", s.routes())
	go func() {
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			log.Print("LAN listener stopped")
			stop()
		}
	}()
	log.Print("SigMark LAN pilot ready")
	<-ctx.Done()
	shutdown, finish := context.WithTimeout(context.Background(), 5*time.Second)
	defer finish()
	_ = srv.Shutdown(shutdown)
}

func listener(addr string, h http.Handler) *http.Server {
	return &http.Server{Addr: addr, Handler: h, ReadHeaderTimeout: 4 * time.Second, ReadTimeout: 8 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10}
}

func send(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func fail(w http.ResponseWriter, code int, key string) {
	send(w, code, map[string]string{"error": key})
}

func headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func limit(l *rate.Limiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !l.Allow() {
				w.Header().Set("Retry-After", "2")
				fail(w, 429, "rate_limited")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (s server) routes() http.Handler {
	r := chi.NewRouter()
	r.Use(headers)
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { send(w, 200, map[string]string{"status": "ok"}) })
	r.Get("/readyz", s.ready)
	r.Route("/api", func(api chi.Router) {
		api.Post("/v1/reports", limit(rate.NewLimiter(2, 8))(http.HandlerFunc(s.submit)).ServeHTTP)
		api.Route("/admin", func(admin chi.Router) {
			admin.Use(limit(rate.NewLimiter(6, 20)), s.requireAdmin)
			admin.Get("/session", func(w http.ResponseWriter, _ *http.Request) { send(w, 200, map[string]bool{"ok": true}) })
			admin.Get("/reports", s.reports)
			admin.Get("/summary", s.summary)
		})
	})
	web, _ := fs.Sub(assets, "web")
	r.Handle("/*", http.FileServer(http.FS(web)))
	return r
}

func (s server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.Ping(ctx); err != nil {
		fail(w, 503, "not_ready")
		return
	}
	send(w, 200, map[string]string{"status": "ready"})
}

func (s server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		provided, expected := sha256.Sum256([]byte(token)), sha256.Sum256([]byte(s.token))
		if !ok || token == "" || subtle.ConstantTimeCompare(provided[:], expected[:]) != 1 {
			fail(w, 401, "admin_auth_required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s server) submit(w http.ResponseWriter, r *http.Request) {
	// This is a protocol marker, not authentication. No admin secrets are used by the APK.
	if r.Header.Get("X-SigMark-Client") != "android-lan" || r.Header.Get("Origin") != "" {
		fail(w, 403, "lan_app_required")
		return
	}
	media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if media != "application/json" {
		fail(w, 415, "json_required")
		return
	}
	var report Report
	if err := decodeStrict(http.MaxBytesReader(w, r.Body, 8<<10), &report); err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			fail(w, 413, "report_too_large")
		} else {
			fail(w, 400, "invalid_report")
		}
		return
	}
	if !report.valid() {
		fail(w, 400, "invalid_report")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var id string
	err := s.db.QueryRow(ctx, `INSERT INTO reports (id,batch,request_id,body) VALUES (gen_random_uuid(),$1,$2,$3)
	ON CONFLICT (batch, request_id) DO UPDATE SET body = reports.body WHERE reports.body = EXCLUDED.body RETURNING id`, s.batch, report.RequestID, report).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 409, "request_id_conflict")
		return
	}
	if err != nil {
		log.Print("report write failed")
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 201, map[string]string{"reportId": id, "batch": s.batch})
}

type storedReport struct {
	ID       string    `json:"id"`
	Batch    string    `json:"batch"`
	Received time.Time `json:"receivedAt"`
	Report   Report    `json:"report"`
}

func batchFilter(w http.ResponseWriter, r *http.Request) (string, bool) {
	b := r.URL.Query().Get("batch")
	if b != "" && !batchPattern.MatchString(b) {
		fail(w, 400, "invalid_batch")
		return "", false
	}
	return b, true
}

func (s server) reports(w http.ResponseWriter, r *http.Request) {
	batch, ok := batchFilter(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	rows, err := s.db.Query(ctx, `SELECT id,batch,received_at,body FROM reports WHERE ($1='' OR batch=$1) AND received_at >= now()-interval '30 days' ORDER BY received_at DESC,id DESC LIMIT 100`, batch)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	defer rows.Close()
	out := []storedReport{}
	for rows.Next() {
		var p storedReport
		if rows.Scan(&p.ID, &p.Batch, &p.Received, &p.Report) != nil {
			fail(w, 503, "storage_unavailable")
			return
		}
		out = append(out, p)
	}
	if rows.Err() != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, out)
}

func (s server) summary(w http.ResponseWriter, r *http.Request) {
	batch, ok := batchFilter(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var result json.RawMessage
	err := s.db.QueryRow(ctx, `WITH filtered AS (
	  SELECT body FROM reports WHERE ($1='' OR batch=$1) AND received_at >= now()-interval '30 days'
	), metrics AS (SELECT field FROM filtered CROSS JOIN LATERAL jsonb_array_elements(body->'metrics') field),
	status AS (SELECT field->>'status' AS key, count(*) AS n FROM metrics GROUP BY 1),
	network AS (SELECT body->>'network' AS key,count(*) AS n FROM filtered GROUP BY 1),
	by_field AS (SELECT field->>'key' AS key,count(*) AS observed,count(*) FILTER (WHERE field->>'status'='RESTRICTED') AS restricted FROM metrics GROUP BY 1)
	SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),
	'status',coalesce((SELECT jsonb_object_agg(key,n) FROM status),'{}'),
	'network',coalesce((SELECT jsonb_object_agg(key,n) FROM network),'{}'),
	'fields',coalesce((SELECT jsonb_agg(to_jsonb(by_field) ORDER BY restricted DESC,key) FROM by_field),'[]'))`, batch).Scan(&result)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, result)
}

func (s server) prune(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		cleanup, cancel := context.WithTimeout(ctx, 10*time.Second)
		_, err := s.db.Exec(cleanup, `DELETE FROM reports WHERE received_at < now()-interval '30 days'`)
		cancel()
		if err != nil && ctx.Err() == nil {
			log.Print("retention cleanup failed")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

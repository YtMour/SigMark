package main

import (
	"context"
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
	db            *pgxpool.Pool
	token         string
	batch         string
	secureCookies bool
	builds        *buildCenter
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
	s := server{db: db, token: token, batch: batch, secureCookies: os.Getenv("COOKIE_SECURE") == "true",
		builds: &buildCenter{root: os.Getenv("BUILD_DATA"), catalog: os.Getenv("BUILD_CATALOG")}}
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
	r.Get("/downloads/sigmark.apk", s.downloadAPK)
	r.Head("/downloads/sigmark.apk", s.downloadAPK)
	r.Get("/api/downloads/current", s.downloadInfo)
	r.Route("/api", func(api chi.Router) {
		api.Post("/v1/reports", limit(rate.NewLimiter(2, 8))(http.HandlerFunc(s.submit)).ServeHTTP)
		api.Route("/admin", func(admin chi.Router) {
			admin.With(limit(rate.NewLimiter(1, 5))).Post("/login", s.login)
			admin.Group(func(admin chi.Router) {
				admin.Use(limit(rate.NewLimiter(6, 20)), s.requireAdmin)
				admin.Get("/session", func(w http.ResponseWriter, _ *http.Request) { send(w, 200, map[string]bool{"ok": true}) })
				admin.Post("/logout", s.logout)
				admin.Get("/settings", s.getSettings)
				admin.Put("/settings", s.putSettings)
				admin.Get("/builds", s.buildIndex)
				admin.Get("/builds/{id}/apk", s.downloadBuild)
				admin.Post("/builds", s.requestBuild)
				admin.Post("/builds/{id}/publish", s.publishBuild)
				admin.Get("/reports", s.reports)
				admin.Get("/report-count", s.reportCount)
				admin.Get("/report-facets", s.reportFacets)
				admin.Get("/repository-stats", s.repositoryStats)
				admin.Get("/regression-baselines", s.listBaselines)
				admin.Post("/regression-baselines", s.createBaseline)
				admin.Delete("/regression-baselines/{id}", s.deleteBaseline)
				admin.Get("/device-assets", s.deviceAssets)
				admin.Post("/device-assets/assign", s.assignDeviceAsset)
				admin.Post("/device-assets/merge", s.mergeDeviceAsset)
				admin.Post("/reports/export", s.exportReports)
				admin.Post("/reports/manage", s.manageReports)
				admin.Get("/reports/{id}", s.reportDetail)
				admin.Get("/summary", s.summary)
			})
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
	if err := decodeStrict(http.MaxBytesReader(w, r.Body, 128<<10), &report); err != nil {
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
	config, err := s.readSettings(ctx)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	if !config.UploadsEnabled {
		fail(w, 503, "uploads_paused")
		return
	}
	key := r.Header.Get("X-SigMark-Asset-Key")
	if key != "" && (report.SchemaVersion != 4 || !requestPattern.MatchString(key)) {
		fail(w, 400, "invalid_asset_key")
		return
	}
	id, err := s.storeReport(ctx, config.Batch, report, key)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 409, "request_id_conflict")
		return
	}
	if err != nil {
		log.Print("report write failed")
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 201, map[string]string{"reportId": id, "batch": config.Batch})
}

type storedReport struct {
	ID        string     `json:"id"`
	Batch     string     `json:"batch"`
	Received  time.Time  `json:"receivedAt"`
	Report    Report     `json:"report"`
	TrashedAt *time.Time `json:"trashedAt,omitempty"`
	AssetID   *string    `json:"assetId,omitempty"`
}

type reportIndexRow struct {
	ID        string          `json:"id"`
	Batch     string          `json:"batch"`
	Received  time.Time       `json:"receivedAt"`
	Report    json.RawMessage `json:"report"`
	TrashedAt *time.Time      `json:"trashedAt,omitempty"`
}

func (s server) reportDetail(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !requestPattern.MatchString(id) {
		fail(w, 400, "invalid_report_id")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var p storedReport
	err := s.db.QueryRow(ctx, `SELECT id,batch,received_at,body,trashed_at,CASE WHEN $2 THEN asset_id END FROM reports WHERE id=$1`,
		id, r.URL.Query().Get("include") == "asset").Scan(&p.ID, &p.Batch, &p.Received, &p.Report, &p.TrashedAt, &p.AssetID)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "report_not_found")
		return
	}
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, p)
}

func reportFilters(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	b := r.URL.Query().Get("batch")
	if b != "" && !batchPattern.MatchString(b) {
		fail(w, 400, "invalid_batch")
		return "", "", false
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if !textValid(q, 80) {
		fail(w, 400, "invalid_query")
		return "", "", false
	}
	return b, q, true
}

const archivePredicate = `($1='' OR batch=$1) AND (CASE
 WHEN $2='' THEN true
 WHEN $2='asset:unassigned' THEN asset_id IS NULL
 WHEN left($2,6)='asset:' THEN asset_id::text=substr($2,7)
 ELSE strpos(lower(concat_ws(' ', id::text, batch, body->>'model', body->>'appVersion', body->>'network',
   body->>'androidApi', (SELECT string_agg(p->>'value', ' ') FROM jsonb_array_elements(
     coalesce(body->'parameters','[]'::jsonb)) p
     WHERE p->>'group'='system' AND p->>'key' IN ('brand','device','release','patch','romHint','buildId'))
 )), lower($2))>0 END)`

func (s server) reports(w http.ResponseWriter, r *http.Request) {
	args, ok := reportScope(w, r)
	if !ok {
		return
	}
	trash, ok := trashFilter(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	cursor := r.URL.Query().Get("before")
	at, id, err := parseCursor(cursor)
	if err != nil {
		fail(w, 400, "invalid_cursor")
		return
	}
	const pageSize = 30
	rows, err := s.db.Query(ctx, `SELECT id,batch,received_at,jsonb_build_object(
	  'model',body->'model','androidApi',body->'androidApi','network',body->'network',
	  'brand',nullif(brand,'~missing'),'android',nullif(android,'~missing'),'device',nullif(device,'~missing'),'assetId',asset_id,
	  'capturedAtEpochMs',body->'capturedAtEpochMs',
	  'buildId',jsonb_path_query_first(body,'$.parameters[*] ? (@.group == "system" && @.key == "buildId" && @.status == "AVAILABLE").value'),
	  'romHint',jsonb_path_query_first(body,'$.parameters[*] ? (@.group == "system" && @.key == "romHint" && @.status == "AVAILABLE").value'),
	  'appVersion',body->'appVersion','schemaVersion',body->'schemaVersion',
	  'collectorVersion',body->'collectorVersion','fieldSetVersion',body->'fieldSetVersion'),trashed_at
	  FROM reports `+reportDimensions+` WHERE `+archivePredicate+archiveFacets+`
	  AND (trashed_at IS NOT NULL)=$8
	  AND ($9::timestamptz IS NULL OR (received_at,id)<($9::timestamptz,$10::uuid))
	  ORDER BY received_at DESC,id DESC LIMIT $11`, append(args, trash, at, id, pageSize+1)...)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	defer rows.Close()
	out := make([]reportIndexRow, 0, pageSize+1)
	for rows.Next() {
		var item reportIndexRow
		if rows.Scan(&item.ID, &item.Batch, &item.Received, &item.Report, &item.TrashedAt) != nil {
			fail(w, 503, "storage_unavailable")
			return
		}
		out = append(out, item)
	}
	if rows.Err() != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	next := ""
	if len(out) > pageSize {
		out = out[:pageSize]
		next = makeCursor(out[pageSize-1].Received, out[pageSize-1].ID)
	}
	send(w, 200, map[string]any{"items": out, "nextCursor": next})
}

func (s server) summary(w http.ResponseWriter, r *http.Request) {
	args, ok := reportScope(w, r)
	if !ok {
		return
	}
	trash, ok := trashFilter(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var result json.RawMessage
	err := s.db.QueryRow(ctx, `WITH filtered AS (
	  SELECT body FROM reports `+reportDimensions+` WHERE `+archivePredicate+archiveFacets+` AND (trashed_at IS NOT NULL)=$8
	), metrics AS (
	  SELECT field
	  FROM filtered CROSS JOIN LATERAL jsonb_array_elements(body->'metrics') field
	  WHERE body->>'schemaVersion' = '1'
	  UNION ALL
	  SELECT jsonb_build_object('key',(p->>'group')||'.'||(p->>'key'),'status',p->>'status')
	  FROM filtered CROSS JOIN LATERAL jsonb_array_elements(body->'parameters') p
	  WHERE body->>'schemaVersion' IN ('2', '3', '4')
	),
	status AS (SELECT field->>'status' AS key, count(*) AS n FROM metrics GROUP BY 1),
	network AS (SELECT body->>'network' AS key,count(*) AS n FROM filtered GROUP BY 1),
	by_field AS (SELECT field->>'key' AS key,count(*) AS observed,count(*) FILTER (WHERE field->>'status'='RESTRICTED') AS restricted FROM metrics GROUP BY 1)
	SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),
	'status',coalesce((SELECT jsonb_object_agg(key,n) FROM status),'{}'),
	'network',coalesce((SELECT jsonb_object_agg(key,n) FROM network),'{}'),
	'fields',coalesce((SELECT jsonb_agg(to_jsonb(by_field) ORDER BY restricted DESC,key) FROM by_field),'[]'))`, append(args, trash)...).Scan(&result)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, result)
}

func (s server) reportCount(w http.ResponseWriter, r *http.Request) {
	args, ok := reportScope(w, r)
	if !ok {
		return
	}
	trash, ok := trashFilter(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var total int64
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM reports `+reportDimensions+` WHERE `+archivePredicate+archiveFacets+
		` AND (trashed_at IS NOT NULL)=$8`, append(args, trash)...).Scan(&total); err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, map[string]int64{"total": total})
}

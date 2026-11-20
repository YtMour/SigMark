package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const sessionCookie = "sigmark_session"
const sessionTTL = 7 * 24 * time.Hour

var sessionPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func (s server) tokenMatches(value string) bool {
	return value != "" && s.token != "" && subtle.ConstantTimeCompare([]byte(digest(value)), []byte(digest(s.token))) == 1
}
func adminIntent(r *http.Request) bool {
	// No CORS headers; a cross-origin browser cannot send this non-simple header.
	return r.Header.Get("X-SigMark-Admin") == "1" && r.Header.Get("Sec-Fetch-Site") != "cross-site"
}
func (s server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		bearer, hasBearer := strings.CutPrefix(auth, "Bearer ")
		ok := hasBearer && s.tokenMatches(bearer)
		if auth == "" && s.db != nil {
			if c, err := r.Cookie(sessionCookie); err == nil && sessionPattern.MatchString(c.Value) {
				ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
				defer cancel()
				err = s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM admin_sessions WHERE digest=$1 AND credential_version=$2 AND expires_at>now())`, digest(c.Value), digest(s.token)).Scan(&ok)
				if err != nil {
					fail(w, 503, "session_store_unavailable")
					return
				}
			}
		}
		if !ok {
			fail(w, 401, "admin_auth_required")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !adminIntent(r) {
			fail(w, 403, "same_origin_required")
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (s server) cookie(w http.ResponseWriter, r *http.Request, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: value, Path: "/api/admin", HttpOnly: true, Secure: s.secureCookies || r.TLS != nil, SameSite: http.SameSiteStrictMode, MaxAge: age})
}
func (s server) login(w http.ResponseWriter, r *http.Request) {
	if !adminIntent(r) {
		fail(w, 403, "same_origin_required")
		return
	}
	var form struct {
		Token string `json:"token"`
	}
	if err := decodeStrict(http.MaxBytesReader(w, r.Body, 1024), &form); err != nil || !s.tokenMatches(form.Token) {
		fail(w, 401, "admin_auth_required")
		return
	}
	var opaque [32]byte
	if _, err := rand.Read(opaque[:]); err != nil {
		fail(w, 503, "session_store_unavailable")
		return
	}
	value := hex.EncodeToString(opaque[:])
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if s.db == nil {
		fail(w, 503, "session_store_unavailable")
		return
	}
	if old, e := r.Cookie(sessionCookie); e == nil && sessionPattern.MatchString(old.Value) {
		if _, err := s.db.Exec(ctx, `DELETE FROM admin_sessions WHERE digest=$1`, digest(old.Value)); err != nil {
			fail(w, 503, "session_store_unavailable")
			return
		}
	}
	if _, err := s.db.Exec(ctx, `DELETE FROM admin_sessions WHERE expires_at<=now() OR credential_version<>$1`, digest(s.token)); err != nil {
		fail(w, 503, "session_store_unavailable")
		return
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO admin_sessions(digest,credential_version,expires_at) VALUES($1,$2,$3)`, digest(value), digest(s.token), time.Now().Add(sessionTTL)); err != nil {
		fail(w, 503, "session_store_unavailable")
		return
	}
	s.cookie(w, r, value, int(sessionTTL.Seconds()))
	send(w, 200, map[string]bool{"ok": true})
}
func (s server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil && sessionPattern.MatchString(c.Value) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if _, err := s.db.Exec(ctx, `DELETE FROM admin_sessions WHERE digest=$1`, digest(c.Value)); err != nil {
			fail(w, 503, "session_store_unavailable")
			return
		}
	}
	s.cookie(w, r, "", -1)
	send(w, 200, map[string]bool{"ok": true})
}

type consoleSettings struct {
	Batch          string `json:"batch"`
	UploadsEnabled bool   `json:"uploadsEnabled"`
}

func (s server) readSettings(ctx context.Context) (consoleSettings, error) {
	var out consoleSettings
	err := s.db.QueryRow(ctx, `SELECT batch,uploads_enabled FROM console_settings WHERE singleton`).Scan(&out.Batch, &out.UploadsEnabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return consoleSettings{s.batch, true}, nil
	}
	return out, err
}
func (s server) getSettings(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	got, err := s.readSettings(ctx)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, got)
}
func (s server) putSettings(w http.ResponseWriter, r *http.Request) {
	var raw struct {
		Batch          string `json:"batch"`
		UploadsEnabled *bool  `json:"uploadsEnabled"`
	}
	if err := decodeStrict(http.MaxBytesReader(w, r.Body, 1024), &raw); err != nil || !batchPattern.MatchString(raw.Batch) || raw.UploadsEnabled == nil {
		fail(w, 400, "invalid_settings")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if _, err := s.db.Exec(ctx, `INSERT INTO console_settings(singleton,batch,uploads_enabled) VALUES(true,$1,$2)
	ON CONFLICT(singleton) DO UPDATE SET batch=EXCLUDED.batch,uploads_enabled=EXCLUDED.uploads_enabled`, raw.Batch, *raw.UploadsEnabled); err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, consoleSettings{raw.Batch, *raw.UploadsEnabled})
}

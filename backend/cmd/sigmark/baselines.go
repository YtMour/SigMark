package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type baselineInput struct {
	Name         string `json:"name"`
	ReportID     string `json:"reportId"`
	ExpectUnlock bool   `json:"expectUnlock"`
}

const baselineLimit = 100

func (b baselineInput) valid() bool {
	return strings.TrimSpace(b.Name) != "" && textValid(b.Name, 60) && requestPattern.MatchString(b.ReportID)
}

const listBaselineSQL = `SELECT coalesce(jsonb_agg(jsonb_build_object(
	'id',b.id,'name',b.name,'reportId',b.report_id,'expectUnlock',b.expect_unlock,
	'createdAt',b.created_at,'state',CASE WHEN r.id IS NULL THEN 'missing' WHEN r.trashed_at IS NOT NULL THEN 'trashed' ELSE 'ready' END,
	'model',r.body->>'model','batch',r.batch,'assetId',r.asset_id) ORDER BY b.created_at DESC,b.id DESC),'[]')
	FROM regression_baselines b LEFT JOIN reports r ON r.id=b.report_id`

func (s server) listBaselines(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var data json.RawMessage
	if err := s.db.QueryRow(ctx, listBaselineSQL).Scan(&data); err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, map[string]any{"schemaVersion": 1, "items": data})
}

func (s server) createBaseline(w http.ResponseWriter, r *http.Request) {
	var input baselineInput
	if decodeStrict(http.MaxBytesReader(w, r.Body, 2048), &input) != nil || !input.valid() {
		fail(w, 400, "invalid_baseline")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var count int
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(714301,5528)`); err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM regression_baselines`).Scan(&count); err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	if count >= baselineLimit {
		fail(w, 409, "baseline_limit")
		return
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO regression_baselines(name,report_id,expect_unlock)
		SELECT $1,id,$3 FROM reports WHERE id=$2 AND trashed_at IS NULL FOR SHARE RETURNING id`,
		strings.TrimSpace(input.Name), input.ReportID, input.ExpectUnlock).Scan(&id)
	var pgerr *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		fail(w, 409, "baseline_report_not_available")
		return
	case errors.As(err, &pgerr) && pgerr.Code == "23505":
		fail(w, 409, "baseline_name_exists")
		return
	case err != nil:
		fail(w, 503, "storage_unavailable")
		return
	}
	if err = tx.Commit(ctx); err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 201, map[string]string{"id": id})
}

func (s server) deleteBaseline(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !requestPattern.MatchString(id) {
		fail(w, 400, "invalid_baseline")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	row, err := s.db.Exec(ctx, `DELETE FROM regression_baselines WHERE id=$1`, id)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	if row.RowsAffected() != 1 {
		fail(w, 404, "baseline_not_found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

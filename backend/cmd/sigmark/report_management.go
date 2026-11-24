package main

import (
	"context"
	"net/http"
	"time"
)

func trashFilter(w http.ResponseWriter, r *http.Request) (bool, bool) {
	switch r.URL.Query().Get("view") {
	case "", "archive":
		return false, true
	case "trash":
		return true, true
	default:
		fail(w, 400, "invalid_report_view")
		return false, false
	}
}

type reportMutation struct {
	Action       string   `json:"action"`
	IDs          []string `json:"ids"`
	Confirmation string   `json:"confirmation,omitempty"`
}

func (input reportMutation) statement() string {
	if len(input.IDs) < 1 || len(input.IDs) > 30 {
		return ""
	}
	seen := make(map[string]bool, len(input.IDs))
	for _, id := range input.IDs {
		if !requestPattern.MatchString(id) || seen[id] {
			return ""
		}
		seen[id] = true
	}
	switch input.Action {
	case "trash":
		return `UPDATE reports SET trashed_at=now() WHERE id=ANY($1::text[]::uuid[]) AND trashed_at IS NULL`
	case "restore":
		return `UPDATE reports SET trashed_at=NULL WHERE id=ANY($1::text[]::uuid[]) AND trashed_at IS NOT NULL`
	case "purge":
		if input.Confirmation == "DELETE" {
			return `DELETE FROM reports WHERE id=ANY($1::text[]::uuid[]) AND trashed_at IS NOT NULL`
		}
	}
	return ""
}

func (s server) manageReports(w http.ResponseWriter, r *http.Request) {
	var input reportMutation
	if decodeStrict(http.MaxBytesReader(w, r.Body, 4096), &input) != nil {
		fail(w, 400, "invalid_report_selection")
		return
	}
	statement := input.statement()
	if statement == "" {
		fail(w, 400, "invalid_report_selection")
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
	// Keep trash and purge from changing the preview snapshot while an asset
	// merge or undo holds the exclusive association lock.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock_shared(714301,5527)`); err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	result, err := tx.Exec(ctx, statement, input.IDs)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	if result.RowsAffected() != int64(len(input.IDs)) {
		fail(w, 409, "report_selection_changed")
		return
	}
	if tx.Commit(ctx) != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, map[string]any{"action": input.Action, "affected": result.RowsAffected()})
}

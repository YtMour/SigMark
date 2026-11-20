package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

const exportLimit = 250
const exportByteLimit = 32 << 20

var exportSlots = make(chan struct{}, 2)

type exportSelection struct {
	Mode string   `json:"mode"`
	IDs  []string `json:"ids,omitempty"`
}

func (input exportSelection) valid() bool {
	if input.Mode == "filtered" {
		return len(input.IDs) == 0
	}
	if input.Mode != "selected" || len(input.IDs) < 1 || len(input.IDs) > 30 {
		return false
	}
	seen := make(map[string]bool, len(input.IDs))
	for _, id := range input.IDs {
		if !requestPattern.MatchString(id) || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}

func (s server) exportReports(w http.ResponseWriter, r *http.Request) {
	var selection exportSelection
	if decodeStrict(http.MaxBytesReader(w, r.Body, 4096), &selection) != nil || !selection.valid() {
		fail(w, 400, "invalid_report_selection")
		return
	}
	args, ok := reportScope(w, r)
	if !ok {
		return
	}
	trash, ok := trashFilter(w, r)
	if !ok {
		return
	}
	select {
	case exportSlots <- struct{}{}:
		defer func() { <-exportSlots }()
	default:
		fail(w, 429, "export_busy")
		return
	}
	ids := selection.IDs
	if ids == nil {
		ids = []string{}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := s.db.Query(ctx, `SELECT id,batch,received_at,trashed_at,body
	FROM reports `+reportDimensions+` WHERE `+archivePredicate+archiveFacets+`
	AND (trashed_at IS NOT NULL)=$8 AND (cardinality($9::text[])=0 OR id=ANY($9::text[]::uuid[]))
	ORDER BY received_at DESC,id DESC LIMIT $10`, append(args, trash, ids, exportLimit+1)...)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	defer rows.Close()
	type record struct {
		ID        string          `json:"id"`
		Batch     string          `json:"batch"`
		Received  time.Time       `json:"receivedAt"`
		TrashedAt *time.Time      `json:"trashedAt,omitempty"`
		Report    json.RawMessage `json:"report"`
	}
	var reports []record
	size := 0
	for rows.Next() {
		var row record
		if rows.Scan(&row.ID, &row.Batch, &row.Received, &row.TrashedAt, &row.Report) != nil {
			fail(w, 503, "storage_unavailable")
			return
		}
		size += len(row.Report)
		if len(reports) >= exportLimit || size > exportByteLimit {
			fail(w, 413, "report_export_limit")
			return
		}
		reports = append(reports, row)
	}
	if rows.Err() != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	if selection.Mode == "selected" && len(reports) != len(ids) {
		fail(w, 409, "report_selection_changed")
		return
	}
	if len(reports) == 0 {
		fail(w, 404, "report_export_empty")
		return
	}
	var buf bytes.Buffer
	bundle := zip.NewWriter(&buf)
	write := func(name string, value any) bool {
		entry, err := bundle.Create(name)
		return err == nil && json.NewEncoder(entry).Encode(value) == nil
	}
	now := time.Now().UTC()
	manifest := make([]string, 0, len(reports))
	for _, row := range reports {
		name := "reports/" + row.ID + ".json"
		if !requestPattern.MatchString(row.ID) || !write(name, row) {
			fail(w, 503, "report_export_failed")
			return
		}
		manifest = append(manifest, name)
	}
	if !write("manifest.json", map[string]any{"schemaVersion": 1, "exportedAt": now, "count": len(manifest), "files": manifest}) || bundle.Close() != nil {
		fail(w, 503, "report_export_failed")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="SigMark-reports-`+now.Format("20060102-150405")+`.zip"`)
	w.Header().Set("X-SigMark-Report-Count", strconv.Itoa(len(manifest)))
	w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(25 * time.Second))
	_, _ = buf.WriteTo(w)
}

package main

import (
	"context"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
)

const labHistoryLimit = 12

// This sheet is a read-only view. Both the baseline candidates and anchor are
// resolved in one database snapshot; there is no association based on model.
const labReportSQL = `WITH anchor AS (
 SELECT id,batch,received_at,body,asset_id,(body->>'capturedAtEpochMs')::bigint AS at_ms
 FROM reports WHERE id=$1 AND trashed_at IS NULL
)
SELECT true,id,batch,received_at,body,asset_id FROM anchor
UNION ALL
SELECT false,h.id,h.batch,h.received_at,h.body,a.asset_id
FROM anchor a CROSS JOIN LATERAL (
 SELECT r.id,r.batch,r.received_at,r.body
 FROM reports r
 WHERE r.asset_id=a.asset_id AND r.trashed_at IS NULL AND r.id<>a.id
 AND (r.body->>'capturedAtEpochMs')::bigint<a.at_ms AND r.received_at<=a.received_at
 ORDER BY (r.body->>'capturedAtEpochMs')::bigint DESC,r.received_at DESC,r.id DESC
 LIMIT $2
) h`

type labReportSheet struct {
	SchemaVersion int            `json:"schemaVersion"`
	Current       storedReport   `json:"current"`
	History       []storedReport `json:"history"`
	HistoryLimit  int            `json:"historyLimit"`
	HasEarlier    bool           `json:"hasEarlier"`
}

func (s server) labReport(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !requestPattern.MatchString(id) {
		fail(w, 400, "invalid_report_id")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	rows, err := s.db.Query(ctx, labReportSQL, id, labHistoryLimit+1)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	defer rows.Close()
	out := labReportSheet{SchemaVersion: 1, HistoryLimit: labHistoryLimit, History: []storedReport{}}
	for rows.Next() {
		var anchor bool
		var p storedReport
		if rows.Scan(&anchor, &p.ID, &p.Batch, &p.Received, &p.Report, &p.AssetID) != nil {
			fail(w, 503, "storage_unavailable")
			return
		}
		if anchor {
			out.Current = p
		} else {
			out.History = append(out.History, p)
		}
	}
	if rows.Err() != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	if out.Current.ID == "" {
		fail(w, 404, "report_not_found")
		return
	}
	// The UNION does not promise result order. Put newest capture first, with
	// deterministic receipt and report identifiers for ties.
	sort.Slice(out.History, func(i, j int) bool {
		a, b := out.History[i], out.History[j]
		if a.Report.CapturedAt != b.Report.CapturedAt {
			return a.Report.CapturedAt > b.Report.CapturedAt
		}
		if !a.Received.Equal(b.Received) {
			return a.Received.After(b.Received)
		}
		return a.ID > b.ID
	})
	if len(out.History) > labHistoryLimit {
		out.HasEarlier = true
		out.History = out.History[:labHistoryLimit]
	}
	send(w, 200, out)
}

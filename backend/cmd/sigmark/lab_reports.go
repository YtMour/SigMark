package main

import (
	"context"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
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
	Registered    []labBaseline  `json:"registeredBaselines"`
	Selected      *storedReport  `json:"registeredReport,omitempty"`
}

type labBaseline struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	ReportID        string `json:"reportId"`
	ExpectUnlock    bool   `json:"expectUnlock"`
	ExpectedNetwork string `json:"expectedNetwork"`
	State           string `json:"state"`
}

// Registered baselines need not be within the 12 most recent samples. The
// relationship and eligibility come from the archive, never model strings or URL flags.
const labBaselineSQL = `SELECT b.id,b.name,b.report_id,b.expect_unlock,b.expected_network
 FROM regression_baselines b JOIN reports r ON r.id=b.report_id
 WHERE r.asset_id=$1 AND r.trashed_at IS NULL AND
 (r.body->>'capturedAtEpochMs')::bigint<$2 AND r.received_at<=$3
 ORDER BY b.created_at DESC,b.id DESC`

func (s server) labReport(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !requestPattern.MatchString(id) {
		fail(w, 400, "invalid_report_id")
		return
	}
	saved := r.URL.Query().Get("saved")
	if saved != "" && !requestPattern.MatchString(saved) {
		fail(w, 400, "invalid_baseline")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, labReportSQL, id, labHistoryLimit+1)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	defer rows.Close()
	out := labReportSheet{SchemaVersion: 1, HistoryLimit: labHistoryLimit, History: []storedReport{}, Registered: []labBaseline{}}
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
	rows.Close()
	if out.Current.AssetID != nil {
		if err := loadLabBaselines(ctx, tx, &out, saved); err != nil {
			fail(w, 503, "storage_unavailable")
			return
		}
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

func loadLabBaselines(ctx context.Context, tx pgx.Tx, out *labReportSheet, saved string) error {
	rows, err := tx.Query(ctx, labBaselineSQL, *out.Current.AssetID, out.Current.Report.CapturedAt, out.Current.Received)
	if err != nil {
		return err
	}
	defer rows.Close()
	selectedID := ""
	for rows.Next() {
		b := labBaseline{State: "ready"}
		if err := rows.Scan(&b.ID, &b.Name, &b.ReportID, &b.ExpectUnlock, &b.ExpectedNetwork); err != nil {
			return err
		}
		out.Registered = append(out.Registered, b)
		if b.ID == saved {
			selectedID = b.ReportID
		}
	}
	if err = rows.Err(); err != nil || selectedID == "" {
		return err
	}
	rows.Close()
	p := new(storedReport)
	if err = tx.QueryRow(ctx, `SELECT id,batch,received_at,body,asset_id FROM reports WHERE id=$1`, selectedID).
		Scan(&p.ID, &p.Batch, &p.Received, &p.Report, &p.AssetID); err != nil {
		return err
	}
	out.Selected = p
	return nil
}

package main

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const profileLimit = 50
const profileDays = 30
const profileVersion = "sigmark-profile/1"

type profileEvidence struct {
	Key    string `json:"key"`
	Status string `json:"status"`
	Value  string `json:"value,omitempty"`
	Source string `json:"source,omitempty"`
	Reason string `json:"reason,omitempty"`
	Errno  *int   `json:"errno,omitempty"`
}
type profileHit struct {
	ID         string `json:"id"`
	CapturedAt int64  `json:"capturedAtEpochMs"`
}
type profileLabel struct {
	Code             string            `json:"code"`
	State            string            `json:"state"`
	Evidence         []profileEvidence `json:"evidence"`
	HistoryHits      int               `json:"historyHits"`
	HistoryEvaluable int               `json:"historyEvaluable"`
	LastHit          *profileHit       `json:"lastHistoricalHit,omitempty"`
}
type deviceProfile struct {
	ReportID   string         `json:"reportId"`
	Version    string         `json:"ruleVersion"`
	Linked     bool           `json:"linked"`
	CapturedAt int64          `json:"capturedAtEpochMs"`
	Days       int            `json:"historyDays"`
	Limit      int            `json:"historyLimit"`
	Samples    int            `json:"historySamples"`
	Limited    bool           `json:"historyLimited"`
	Labels     []profileLabel `json:"labels"`
}

// A configuration declaration is an observation, not attestation. In particular,
// x86 ABI, missing sensors/SIM, developer mode and debug APKs are not emulator labels.
func profileSignals(parameters []Parameter) []profileLabel {
	fields := map[string]profileEvidence{}
	for _, p := range parameters {
		k := p.Group + "." + p.Key
		e := profileEvidence{Key: k, Status: p.Status, Source: p.Source, Reason: p.Reason, Errno: p.Errno}
		if p.Status == "AVAILABLE" && p.Value != nil {
			e.Value = strings.TrimSpace(*p.Value)
		}
		fields[k] = e
	}
	eval := func(code string, keys []string, classify func(string) string) profileLabel {
		out := profileLabel{Code: code, State: "insufficient", Evidence: []profileEvidence{}}
		negative := 0
		for _, k := range keys {
			v, ok := fields[k]
			if !ok {
				out.Evidence = append(out.Evidence, profileEvidence{Key: k, Status: "NOT_ARCHIVED"})
				continue
			}
			out.Evidence = append(out.Evidence, v)
			if v.Status != "AVAILABLE" || v.Value == "" || strings.EqualFold(v.Value, "unknown") {
				continue
			}
			switch classify(v.Value) {
			case "hit":
				out.State = "hit"
			case "not_observed":
				negative++
			}
		}
		if out.State != "hit" && negative == len(keys) {
			out.State = "not_observed"
		}
		return out
	}
	binary := func(hit, no string) func(string) string {
		return func(s string) string {
			switch s {
			case hit:
				return "hit"
			case no:
				return "not_observed"
			}
			return "insufficient"
		}
	}
	return []profileLabel{
		eval("virtual_build_markers", []string{"cpu.hardware", "system.product", "system.device"}, func(s string) string {
			s = strings.ToLower(s)
			if s == "ranchu" || s == "goldfish" || s == "vbox86" || s == "emulator" || strings.HasPrefix(s, "sdk_gphone") {
				return "hit"
			}
			return "not_observed"
		}),
		eval("selinux_permissive", []string{"system.selinux"}, binary("Permissive（宽容模式）", "Enforcing（强制模式）")),
		eval("debugger_attached", []string{"app.debuggerConnected"}, binary("是", "否")),
	}
}

func (p *deviceProfile) addHistory(id string, r Report) {
	p.Samples++
	for i, h := range profileSignals(r.Parameters) {
		v := &p.Labels[i]
		if h.State != "insufficient" {
			v.HistoryEvaluable++
		}
		if h.State == "hit" {
			v.HistoryHits++
			if v.LastHit == nil || r.CapturedAt > v.LastHit.CapturedAt {
				v.LastHit = &profileHit{id, r.CapturedAt}
			}
		}
	}
}

// One SQL snapshot; no cross-asset, trash, later-received, or later-captured rows.
// A delayed upload is compared by its phone capture time, never inferred to be a new device.
const profileSQL = `WITH anchor AS (
 SELECT id,asset_id,received_at,body,(body->>'capturedAtEpochMs')::bigint AS at_ms FROM reports WHERE id=$1 AND trashed_at IS NULL
), samples AS (
 SELECT true AS target,id,asset_id IS NOT NULL AS linked,body,at_ms FROM anchor
 UNION ALL
 SELECT false,h.id,true,h.body,h.at_ms FROM anchor a CROSS JOIN LATERAL (
   SELECT r.id,r.body,(r.body->>'capturedAtEpochMs')::bigint AS at_ms FROM reports r
   WHERE r.asset_id=a.asset_id AND r.trashed_at IS NULL AND r.id<>a.id AND r.received_at<=a.received_at
   AND (r.body->>'capturedAtEpochMs')::bigint >= a.at_ms-$2::bigint AND (r.body->>'capturedAtEpochMs')::bigint < a.at_ms
   ORDER BY at_ms DESC,r.id DESC LIMIT $3
 ) h
) SELECT target,id,linked,body FROM samples ORDER BY target DESC,at_ms DESC,id DESC`

func (s server) deviceProfile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !requestPattern.MatchString(id) {
		fail(w, 400, "invalid_report_id")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	rows, err := s.db.Query(ctx, profileSQL, id, int64(profileDays)*24*60*60*1000, profileLimit+1)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	defer rows.Close()
	out := deviceProfile{Version: profileVersion, Days: profileDays, Limit: profileLimit}
	for rows.Next() {
		var target, linked bool
		var rid string
		var doc Report
		if err := rows.Scan(&target, &rid, &linked, &doc); err != nil {
			fail(w, 503, "storage_unavailable")
			return
		}
		if target {
			out.ReportID = rid
			out.Linked = linked
			out.CapturedAt = doc.CapturedAt
			out.Labels = profileSignals(doc.Parameters)
		} else if out.Samples < profileLimit {
			out.addHistory(rid, doc)
		} else {
			out.Limited = true
		}
	}
	if rows.Err() != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	if out.ReportID == "" {
		fail(w, 404, "report_not_found")
		return
	}
	send(w, 200, out)
}

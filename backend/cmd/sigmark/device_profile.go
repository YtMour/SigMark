package main

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const profileLimit = 50
const profileDays = 30
const profileVersion = "sigmark-profile/3"

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
	Code              string            `json:"code"`
	State             string            `json:"state"`
	Evidence          []profileEvidence `json:"evidence"`
	HistoryHits       int               `json:"historyHits"`
	HistoryRestricted int               `json:"historyRestricted"`
	HistoryEvaluable  int               `json:"historyEvaluable"`
	LastHit           *profileHit       `json:"lastHistoricalHit,omitempty"`
}

// profileIdentity is one distinct identity declaration seen inside the same asset
// history. It answers "did this asset ever claim a different model/board/chip?";
// it is a declaration, never a proof of the physical device.
type profileIdentity struct {
	Model          string `json:"model,omitempty"`
	Device         string `json:"device,omitempty"`
	Board          string `json:"board,omitempty"`
	BoardPlatform  string `json:"boardPlatform,omitempty"`
	BootHardware   string `json:"bootHardware,omitempty"`
	HardwareSku    string `json:"hardwareSku,omitempty"`
	Samples        int    `json:"samples"`
	LastCapturedAt int64  `json:"lastCapturedAtEpochMs"`
	LastReportID   string `json:"lastReportId"`
}

type deviceProfile struct {
	ReportID        string            `json:"reportId"`
	Version         string            `json:"ruleVersion"`
	Linked          bool              `json:"linked"`
	CapturedAt      int64             `json:"capturedAtEpochMs"`
	Days            int               `json:"historyDays"`
	Limit           int               `json:"historyLimit"`
	Samples         int               `json:"historySamples"`
	Limited         bool              `json:"historyLimited"`
	Identity        []profileIdentity `json:"identityHistory"`
	IdentityLimited bool              `json:"identityTruncated,omitempty"`
	Labels          []profileLabel    `json:"labels"`
}

const identityComboLimit = 5

// identityOf reads only available values; an absent key stays absent so two
// reports that both lack the field do not look like a change.
func identityOf(parameters []Parameter) profileIdentity {
	out := profileIdentity{}
	for _, p := range parameters {
		if p.Status != "AVAILABLE" || p.Value == nil {
			continue
		}
		value := strings.TrimSpace(*p.Value)
		if value == "" || strings.EqualFold(value, "unknown") {
			continue
		}
		switch p.Group + "." + p.Key {
		case "system.model":
			out.Model = value
		case "system.device":
			out.Device = value
		case "system.board":
			out.Board = value
		case "system.boardPlatform":
			out.BoardPlatform = value
		case "system.bootHardware":
			out.BootHardware = value
		case "system.hardwareSku":
			out.HardwareSku = value
		}
	}
	return out
}

func (p *deviceProfile) recordIdentity(id string, r Report) {
	entry := identityOf(r.Parameters)
	key := strings.ToLower(strings.Join([]string{entry.Model, entry.Device, entry.Board,
		entry.BoardPlatform, entry.BootHardware, entry.HardwareSku}, "\x00"))
	for i := range p.Identity {
		current := &p.Identity[i]
		existing := strings.ToLower(strings.Join([]string{current.Model, current.Device, current.Board,
			current.BoardPlatform, current.BootHardware, current.HardwareSku}, "\x00"))
		if existing == key {
			current.Samples++
			if r.CapturedAt >= current.LastCapturedAt {
				current.LastCapturedAt = r.CapturedAt
				current.LastReportID = id
			}
			return
		}
	}
	if len(p.Identity) >= identityComboLimit {
		p.IdentityLimited = true
		return
	}
	entry.Samples = 1
	entry.LastCapturedAt = r.CapturedAt
	entry.LastReportID = id
	p.Identity = append(p.Identity, entry)
}

// latestFirst keeps the newest declaration at the top; SQL already returns rows
// newest-first per group, and the target row is scanned first.
func (p *deviceProfile) sortIdentity() {
	sort.SliceStable(p.Identity, func(i, j int) bool {
		return p.Identity[i].LastCapturedAt > p.Identity[j].LastCapturedAt
	})
}

// A configuration declaration is an observation, not attestation. In particular,
// x86 ABI, missing sensors/SIM, developer mode and debug APKs are not emulator labels.
// A restricted read is a boundary, never a hit and never a negative: it is counted
// separately in historyRestricted instead of completing a label's missing evidence.
// The returned slice order is a wire contract: the web client maps history counters
// by position and renders metadata by code. Append labels, never reorder them.
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
	// Direct reads keep the parenthetical suffix; an inferred value only appends
	// 「推断」 to the same mode word, so the mode is identified by prefix.
	prefixed := func(hit, no string) func(string) string {
		return func(s string) string {
			switch {
			case strings.HasPrefix(s, hit):
				return "hit"
			case strings.HasPrefix(s, no):
				return "not_observed"
			}
			return "insufficient"
		}
	}
	// Debug.isDebuggerConnected reports 是/否; TracerPid is a bare decimal where
	// 0 means no tracer. An unparsable value is insufficient evidence, not a hit.
	attached := func(s string) string {
		switch s {
		case "是":
			return "hit"
		case "否":
			return "not_observed"
		}
		if n, err := strconv.Atoi(s); err == nil && strconv.Itoa(n) == s {
			if n == 0 {
				return "not_observed"
			}
			return "hit"
		}
		return "insufficient"
	}
	// Ordered observation codes only produce none/one-or-more codes. Any archived
	// code that is not the literal "none" is a positive clue; a missing row simply
	// does not complete the negative side of the label.
	notNone := func(s string) string {
		if s == "none" {
			return "not_observed"
		}
		return "hit"
	}
	// identity_conflict is not a per-field classification: it compares two
	// independent declarations of the same identity inside one observation, so it
	// must be built here instead of by eval. A pair only counts when both sides
	// carry a usable value; a difference in any comparable pair beats agreement in
	// the others, and a restricted side is neither a hit nor a negative.
	value := func(k string) profileEvidence {
		if v, ok := fields[k]; ok {
			return v
		}
		return profileEvidence{Key: k, Status: "NOT_ARCHIVED"}
	}
	usable := func(e profileEvidence) bool {
		return e.Status == "AVAILABLE" && e.Value != "" && !strings.EqualFold(e.Value, "unknown")
	}
	identity := profileLabel{Code: "identity_conflict", State: "insufficient", Evidence: []profileEvidence{}}
	compared := 0
	for _, pair := range [][2]string{
		{"system.board", "system.boardPlatform"},
		{"cpu.hardware", "system.bootHardware"},
		{"system.sku", "system.hardwareSku"},
	} {
		left, right := value(pair[0]), value(pair[1])
		identity.Evidence = append(identity.Evidence, left, right)
		if !usable(left) || !usable(right) {
			continue
		}
		compared++
		if !strings.EqualFold(left.Value, right.Value) {
			identity.State = "hit"
		}
	}
	if identity.State != "hit" && compared > 0 {
		identity.State = "not_observed"
	}
	return append([]profileLabel{
		eval("virtual_build_markers", []string{"cpu.hardware", "system.product", "system.device"}, func(s string) string {
			s = strings.ToLower(s)
			if s == "ranchu" || s == "goldfish" || s == "vbox86" || s == "emulator" || strings.HasPrefix(s, "sdk_gphone") {
				return "hit"
			}
			return "not_observed"
		}),
		eval("selinux_permissive", []string{"system.selinux"}, prefixed("Permissive", "Enforcing")),
		eval("debugger_attached", []string{"app.debuggerConnected", "environment.tracerPid"}, attached),
		eval("hook_injection", []string{"environment.hookSignals", "environment.rootMountHints"}, notNone),
		eval("root_manager_visible", []string{"environment.rootManagerVisible"}, notNone),
		eval("multi_open", []string{"environment.userProfile"}, func(s string) string {
			switch s {
			case "secondary", "managed":
				return "hit"
			case "owner":
				return "not_observed"
			}
			return "insufficient"
		}),
		eval("rom_verification", []string{"environment.verityMode", "environment.buildDebuggable"}, func(s string) string {
			switch s {
			case "disabled", "logging", "开启":
				return "hit"
			case "enforcing", "关闭":
				return "not_observed"
			}
			return "insufficient"
		}),
		eval("software_drm", []string{"environment.drmSecurityLevel"}, func(s string) string {
			switch s {
			case "L3":
				return "hit"
			case "L1", "L2":
				return "not_observed"
			}
			return "insufficient"
		}),
	}, identity)
}

func (p *deviceProfile) addHistory(id string, r Report) {
	p.Samples++
	p.recordIdentity(id, r)
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
		for _, e := range h.Evidence {
			if e.Status == "RESTRICTED" {
				v.HistoryRestricted++
				break
			}
		}
	}
}

// recordHistory keeps at most profileLimit earlier samples; the first skipped row
// only marks historyLimited. The SQL fetch already caps the query at profileLimit+1.
func (p *deviceProfile) recordHistory(id string, r Report) {
	if p.Samples >= profileLimit {
		p.Limited = true
		return
	}
	p.addHistory(id, r)
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
			out.recordIdentity(rid, doc)
		} else {
			out.recordHistory(rid, doc)
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
	out.sortIdentity()
	send(w, 200, out)
}

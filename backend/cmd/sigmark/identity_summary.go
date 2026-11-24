package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Repository-wide identity view. It answers three questions the per-report view
// cannot: did one asset ever declare different identities, does one declaration
// appear under several assets, and which reports disagree with themselves.
// Everything here is a declaration in an archive, never a physical attestation.
const (
	identitySummaryVersion = "sigmark-identity/1"
	identitySummaryLimit   = 20
)

type identityValues struct {
	Model         string `json:"model,omitempty"`
	Device        string `json:"device,omitempty"`
	Board         string `json:"board,omitempty"`
	BoardPlatform string `json:"boardPlatform,omitempty"`
	BootHardware  string `json:"bootHardware,omitempty"`
	HardwareSku   string `json:"hardwareSku,omitempty"`
}

type identityDecl struct {
	identityValues
	Reports        int    `json:"reports"`
	LastCapturedAt int64  `json:"lastCapturedAtEpochMs"`
	LastReportID   string `json:"lastReportId"`
}

type identityShared struct {
	identityValues
	AssetCount     int    `json:"assetCount"`
	Reports        int    `json:"reports"`
	LastCapturedAt int64  `json:"lastCapturedAtEpochMs"`
	LastReportID   string `json:"lastReportId"`
}

type identityDrift struct {
	AssetID        string         `json:"assetId"`
	Identities     []identityDecl `json:"identities"`
	Reports        int            `json:"reports"`
	LastCapturedAt int64          `json:"lastCapturedAtEpochMs"`
}

type identityPair struct {
	LeftKey  string `json:"leftKey"`
	RightKey string `json:"rightKey"`
	Left     string `json:"left"`
	Right    string `json:"right"`
}

type identityConflictSample struct {
	ReportID   string         `json:"reportId"`
	AssetID    string         `json:"assetId,omitempty"`
	CapturedAt int64          `json:"capturedAtEpochMs"`
	Pairs      []identityPair `json:"pairs"`
}

type identitySummary struct {
	SchemaVersion       int                      `json:"schemaVersion"`
	RuleVersion         string                   `json:"ruleVersion"`
	GeneratedAt         int64                    `json:"generatedAtEpochMs"`
	Reports             int                      `json:"reports"`
	Assets              int                      `json:"assets"`
	MultiIdentityAssets []identityDrift          `json:"multiIdentityAssets"`
	SharedIdentities    []identityShared         `json:"sharedIdentities"`
	ConflictReports     int                      `json:"conflictReports"`
	ConflictSamples     []identityConflictSample `json:"conflictSamples"`
	Truncated           bool                     `json:"truncated"`
}

// identityRow is one archived report reduced to what this view needs.
type identityRow struct {
	ReportID   string
	AssetID    *string
	CapturedAt int64
	Values     identityValues
	Pairs      []identityPair
}

var identityValueKeys = [][2]string{
	{"model", "system.model"},
	{"device", "system.device"},
	{"board", "system.board"},
	{"boardPlatform", "system.boardPlatform"},
	{"bootHardware", "system.bootHardware"},
	{"hardwareSku", "system.hardwareSku"},
}

// identityConflicts returns only pairs where both sides are usable. A restricted
// or absent side is not a disagreement, exactly like the per-report rule.
func identityConflicts(values map[string]string) []identityPair {
	out := []identityPair{}
	for _, pair := range [][2]string{
		{"system.board", "system.boardPlatform"},
		{"cpu.hardware", "system.bootHardware"},
		{"system.sku", "system.hardwareSku"},
	} {
		left := strings.TrimSpace(values[pair[0]])
		right := strings.TrimSpace(values[pair[1]])
		if left == "" || right == "" || strings.EqualFold(left, "unknown") || strings.EqualFold(right, "unknown") {
			continue
		}
		if !strings.EqualFold(left, right) {
			out = append(out, identityPair{LeftKey: pair[0], RightKey: pair[1], Left: left, Right: right})
		}
	}
	return out
}

func identityValuesFrom(values map[string]string) identityValues {
	pick := func(key string) string { return strings.TrimSpace(values[key]) }
	return identityValues{pick("system.model"), pick("system.device"), pick("system.board"),
		pick("system.boardPlatform"), pick("system.bootHardware"), pick("system.hardwareSku")}
}

func identityTuple(v identityValues) string {
	return strings.ToLower(strings.Join([]string{v.Model, v.Device, v.Board, v.BoardPlatform,
		v.BootHardware, v.HardwareSku}, "\x1f"))
}

func assetKey(id *string) string {
	if id == nil {
		return ""
	}
	return *id
}

func capIdentity[T any](rows []T, limit int) ([]T, bool) {
	if len(rows) > limit {
		return rows[:limit], true
	}
	return rows, false
}

// buildIdentitySummary is pure so the aggregation rules are testable without a DB.
func buildIdentitySummary(rows []identityRow, generatedAt int64) identitySummary {
	out := identitySummary{SchemaVersion: 1, RuleVersion: identitySummaryVersion, GeneratedAt: generatedAt,
		Reports: len(rows), MultiIdentityAssets: []identityDrift{}, SharedIdentities: []identityShared{},
		ConflictSamples: []identityConflictSample{}}
	assetIdentities := map[string]map[string]*identityDecl{}
	assetReports := map[string]int{}
	assetLast := map[string]int64{}
	tupleShared := map[string]*identityShared{}
	tupleAssets := map[string]map[string]bool{}
	assetSet := map[string]bool{}
	conflicts := []identityConflictSample{}
	for _, row := range rows {
		if asset := assetKey(row.AssetID); asset != "" {
			assetSet[asset] = true
			assetReports[asset]++
			if row.CapturedAt > assetLast[asset] {
				assetLast[asset] = row.CapturedAt
			}
			if assetIdentities[asset] == nil {
				assetIdentities[asset] = map[string]*identityDecl{}
			}
			key := identityTuple(row.Values)
			decl := assetIdentities[asset][key]
			if decl == nil {
				decl = &identityDecl{identityValues: row.Values}
				assetIdentities[asset][key] = decl
			}
			decl.Reports++
			if row.CapturedAt >= decl.LastCapturedAt {
				decl.LastCapturedAt, decl.LastReportID = row.CapturedAt, row.ReportID
			}
			shared := tupleShared[key]
			if shared == nil {
				shared = &identityShared{identityValues: row.Values}
				tupleShared[key] = shared
			}
			shared.Reports++
			if row.CapturedAt >= shared.LastCapturedAt {
				shared.LastCapturedAt, shared.LastReportID = row.CapturedAt, row.ReportID
			}
			if tupleAssets[key] == nil {
				tupleAssets[key] = map[string]bool{}
			}
			tupleAssets[key][asset] = true
		}
		if len(row.Pairs) > 0 {
			out.ConflictReports++
			conflicts = append(conflicts, identityConflictSample{ReportID: row.ReportID,
				AssetID: assetKey(row.AssetID), CapturedAt: row.CapturedAt, Pairs: row.Pairs})
		}
	}
	out.Assets = len(assetSet)

	drifts := []identityDrift{}
	for asset, identities := range assetIdentities {
		if len(identities) < 2 {
			continue
		}
		part := identityDrift{AssetID: asset, Reports: assetReports[asset], LastCapturedAt: assetLast[asset]}
		for _, decl := range identities {
			part.Identities = append(part.Identities, *decl)
		}
		sort.Slice(part.Identities, func(i, j int) bool {
			if part.Identities[i].LastCapturedAt != part.Identities[j].LastCapturedAt {
				return part.Identities[i].LastCapturedAt > part.Identities[j].LastCapturedAt
			}
			return part.Identities[i].LastReportID < part.Identities[j].LastReportID
		})
		drifts = append(drifts, part)
	}
	sort.Slice(drifts, func(i, j int) bool {
		if drifts[i].LastCapturedAt != drifts[j].LastCapturedAt {
			return drifts[i].LastCapturedAt > drifts[j].LastCapturedAt
		}
		return drifts[i].AssetID < drifts[j].AssetID
	})
	var cut bool
	if out.MultiIdentityAssets, cut = capIdentity(drifts, identitySummaryLimit); cut {
		out.Truncated = true
	}

	sharedRows := []identityShared{}
	for key, shared := range tupleShared {
		if len(tupleAssets[key]) < 2 {
			continue
		}
		copied := *shared
		copied.AssetCount = len(tupleAssets[key])
		sharedRows = append(sharedRows, copied)
	}
	sort.Slice(sharedRows, func(i, j int) bool {
		if sharedRows[i].AssetCount != sharedRows[j].AssetCount {
			return sharedRows[i].AssetCount > sharedRows[j].AssetCount
		}
		if sharedRows[i].Reports != sharedRows[j].Reports {
			return sharedRows[i].Reports > sharedRows[j].Reports
		}
		return sharedRows[i].LastCapturedAt > sharedRows[j].LastCapturedAt
	})
	if out.SharedIdentities, cut = capIdentity(sharedRows, identitySummaryLimit); cut {
		out.Truncated = true
	}

	sort.Slice(conflicts, func(i, j int) bool {
		if conflicts[i].CapturedAt != conflicts[j].CapturedAt {
			return conflicts[i].CapturedAt > conflicts[j].CapturedAt
		}
		return conflicts[i].ReportID < conflicts[j].ReportID
	})
	if out.ConflictSamples, cut = capIdentity(conflicts, identitySummaryLimit); cut {
		out.Truncated = true
	}
	return out
}

// One row per active report; duplicate keys are collapsed before aggregation.
const identitySummarySQL = `SELECT r.id, r.asset_id,
	COALESCE((r.body->>'capturedAtEpochMs')::bigint, 0),
	COALESCE((
		SELECT jsonb_object_agg(k, v) FROM (
			SELECT DISTINCT ON (p->>'group', p->>'key')
				(p->>'group')||'.'||(p->>'key') AS k, p->>'value' AS v
			FROM jsonb_array_elements(COALESCE(r.body->'parameters','[]'::jsonb)) p
			WHERE p->>'status'='AVAILABLE' AND p->>'value' IS NOT NULL AND p->>'value' <> ''
				AND lower(p->>'value') <> 'unknown'
			ORDER BY p->>'group', p->>'key'
		) x
	), '{}'::jsonb)
FROM reports r
WHERE r.trashed_at IS NULL`

type identityQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// collectIdentityRows keeps the handler thin and lets integration tests point the
// same scanner at a temporary table.
func collectIdentityRows(ctx context.Context, q identityQuerier) ([]identityRow, error) {
	rows, err := q.Query(ctx, identitySummarySQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	collected := make([]identityRow, 0, 64)
	for rows.Next() {
		var id string
		var asset *string
		var capturedAt int64
		var raw []byte
		if err := rows.Scan(&id, &asset, &capturedAt, &raw); err != nil {
			return nil, err
		}
		values := map[string]string{}
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &values); err != nil {
				return nil, err
			}
		}
		collected = append(collected, identityRow{ReportID: id, AssetID: asset, CapturedAt: capturedAt,
			Values: identityValuesFrom(values), Pairs: identityConflicts(values)})
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	return collected, nil
}

func (s server) identitySummary(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	collected, err := collectIdentityRows(ctx, s.db)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, buildIdentitySummary(collected, time.Now().UnixMilli()))
}

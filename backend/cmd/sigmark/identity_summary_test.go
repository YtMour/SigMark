package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func identityPtr(value string) *string { return &value }

func identityRowOf(id, asset string, at int64, model, device, board, platform, hardware, sku string) identityRow {
	values := map[string]string{}
	put := func(key, value string) {
		if value != "" {
			values[key] = value
		}
	}
	put("system.model", model)
	put("system.device", device)
	put("system.board", board)
	put("system.boardPlatform", platform)
	put("system.bootHardware", hardware)
	put("system.hardwareSku", sku)
	row := identityRow{ReportID: id, CapturedAt: at, Values: identityValuesFrom(values), Pairs: identityConflicts(values)}
	if asset != "" {
		row.AssetID = identityPtr(asset)
	}
	return row
}

func TestIdentitySummaryAggregatesDriftSharedAndConflicts(t *testing.T) {
	rows := []identityRow{
		identityRowOf("r1", "A", 1000, "23078PND5G", "corot", "mt6985", "mt6985", "mtk", "23078PND5G"),
		identityRowOf("r2", "A", 2000, "23078PND5G", "corot", "mt6985", "gs101", "mtk", "GR1YH"),
		identityRowOf("r3", "B", 1500, "23078PND5G", "corot", "mt6985", "mt6985", "mtk", "23078PND5G"),
		identityRowOf("r4", "", 3000, "MI 8", "dipper", "sdm845", "sdm845", "qcom", ""),
	}
	got := buildIdentitySummary(rows, 9000)
	if got.SchemaVersion != 1 || got.RuleVersion != identitySummaryVersion || got.GeneratedAt != 9000 {
		t.Fatalf("envelope: %+v", got)
	}
	if got.Reports != 4 || got.Assets != 2 {
		t.Fatalf("totals: reports=%d assets=%d", got.Reports, got.Assets)
	}
	if got.ConflictReports != 1 || len(got.ConflictSamples) != 1 {
		t.Fatalf("conflicts: %d %+v", got.ConflictReports, got.ConflictSamples)
	}
	sample := got.ConflictSamples[0]
	// system.sku is not archived in this fixture, so only the board pair is comparable.
	if sample.ReportID != "r2" || sample.AssetID != "A" || len(sample.Pairs) != 1 {
		t.Fatalf("conflict sample: %+v", sample)
	}
	if sample.Pairs[0].Left != "mt6985" || sample.Pairs[0].Right != "gs101" ||
		sample.Pairs[0].LeftKey != "system.board" || sample.Pairs[0].RightKey != "system.boardPlatform" {
		t.Fatalf("pair order or keys changed: %+v", sample.Pairs)
	}
	if len(got.MultiIdentityAssets) != 1 {
		t.Fatalf("drift assets: %+v", got.MultiIdentityAssets)
	}
	drift := got.MultiIdentityAssets[0]
	if drift.AssetID != "A" || drift.Reports != 2 || drift.LastCapturedAt != 2000 || len(drift.Identities) != 2 {
		t.Fatalf("drift: %+v", drift)
	}
	if drift.Identities[0].LastReportID != "r2" || drift.Identities[1].LastReportID != "r1" {
		t.Fatalf("drift order must be newest first: %+v", drift.Identities)
	}
	if len(got.SharedIdentities) != 1 {
		t.Fatalf("shared identities: %+v", got.SharedIdentities)
	}
	shared := got.SharedIdentities[0]
	if shared.AssetCount != 2 || shared.Reports != 2 || shared.Model != "23078PND5G" || shared.LastReportID != "r3" {
		t.Fatalf("shared: %+v", shared)
	}
}

func TestIdentitySummaryTreatsMissingAndRestrictedAsNoEvidence(t *testing.T) {
	rows := []identityRow{
		identityRowOf("r1", "A", 1000, "", "", "", "", "", ""),
		identityRowOf("r2", "A", 2000, "", "", "", "", "", ""),
		identityRowOf("r3", "B", 3000, "", "", "mt6985", "", "", ""),
		identityRowOf("r4", "C", 4000, "", "", "mt6985", "", "", ""),
	}
	got := buildIdentitySummary(rows, 1)
	if got.ConflictReports != 0 || len(got.ConflictSamples) != 0 {
		t.Fatalf("missing sides must not conflict: %+v", got.ConflictSamples)
	}
	if len(got.MultiIdentityAssets) != 0 {
		t.Fatalf("identical empty tuples must not drift: %+v", got.MultiIdentityAssets)
	}
	// B and C share the same partial tuple (board only); that is a shared declaration.
	if len(got.SharedIdentities) != 1 || got.SharedIdentities[0].AssetCount != 2 {
		t.Fatalf("partial shared declaration: %+v", got.SharedIdentities)
	}
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"multiIdentityAssets":[]`, `"sharedIdentities":[`, `"conflictSamples":[]`} {
		if !strings.Contains(string(raw), field) {
			t.Fatalf("empty list must serialize as [] (%s): %s", field, raw)
		}
	}
}

func TestIdentitySummaryCapsLists(t *testing.T) {
	rows := []identityRow{}
	for i := 0; i < identitySummaryLimit+3; i++ {
		asset := "asset-" + string(rune('a'+i))
		rows = append(rows,
			identityRowOf("x"+asset, asset, int64(i+1), "model", "device", "board-"+asset, "board-"+asset, "hw", "sku"),
			identityRowOf("y"+asset, asset, int64(i+1), "model", "device", "board-"+asset, "other-"+asset, "hw", "sku"))
	}
	got := buildIdentitySummary(rows, 1)
	if !got.Truncated || len(got.MultiIdentityAssets) != identitySummaryLimit {
		t.Fatalf("drift cap: truncated=%v len=%d", got.Truncated, len(got.MultiIdentityAssets))
	}
	if len(got.ConflictSamples) != identitySummaryLimit {
		t.Fatalf("conflict cap: %d", len(got.ConflictSamples))
	}
	if got.Assets != identitySummaryLimit+3 || got.ConflictReports != identitySummaryLimit+3 {
		t.Fatalf("totals must not be capped: assets=%d conflicts=%d", got.Assets, got.ConflictReports)
	}
}

func TestIdentitySummaryRequiresAdminToken(t *testing.T) {
	h := (server{token: "test-token"}).routes()
	req := httptest.NewRequest("GET", "/api/admin/identity-summary", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatalf("unauthenticated status = %d", w.Code)
	}
}

func TestIdentitySummaryPostgres(t *testing.T) {
	dsn := os.Getenv("SIGMARK_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set SIGMARK_TEST_DATABASE_URL for PostgreSQL integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	if _, err = conn.Exec(ctx, `CREATE TEMP TABLE reports (
		id uuid PRIMARY KEY, batch text NOT NULL, request_id uuid NOT NULL,
		received_at timestamptz NOT NULL, body jsonb NOT NULL, trashed_at timestamptz, asset_id uuid)`); err != nil {
		t.Fatal(err)
	}
	_, err = conn.Exec(ctx, `WITH fixtures(n,asset,platform,sku,trash) AS (VALUES
		(1,'00000000-0000-4000-8000-00000000000a'::uuid,'mt6985','23078PND5G',NULL::timestamptz),
		(2,'00000000-0000-4000-8000-00000000000a'::uuid,'gs101','GR1YH',NULL),
		(3,'00000000-0000-4000-8000-00000000000b'::uuid,'mt6985','23078PND5G',NULL),
		(4,NULL::uuid,'gs101','GR1YH',NULL),
		(5,'00000000-0000-4000-8000-00000000000a'::uuid,'gs101','GR1YH',now())
	) INSERT INTO reports
	SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'identity-qa',
	       ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,to_timestamp(n),
	       jsonb_build_object('schemaVersion',4,'capturedAtEpochMs',n*1000,'fieldSetVersion',19,
	         'parameters',jsonb_build_array(
	           jsonb_build_object('group','system','key','model','status','AVAILABLE','value','23078PND5G'),
	           jsonb_build_object('group','system','key','device','status','AVAILABLE','value','corot'),
	           jsonb_build_object('group','system','key','board','status','AVAILABLE','value','mt6985'),
	           jsonb_build_object('group','system','key','boardPlatform','status','AVAILABLE','value',platform),
	           jsonb_build_object('group','system','key','bootHardware','status','AVAILABLE','value','mtk'),
	           jsonb_build_object('group','system','key','hardwareSku','status','AVAILABLE','value',sku),
	           jsonb_build_object('group','system','key','vendorSpl','status','RESTRICTED','value',NULL)
	         )),trash,asset
	FROM fixtures`)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := collectIdentityRows(ctx, conn)
	if err != nil {
		t.Fatal(err)
	}
	got := buildIdentitySummary(rows, 1)
	if got.Reports != 4 || got.Assets != 2 {
		t.Fatalf("trashed row must be excluded: reports=%d assets=%d", got.Reports, got.Assets)
	}
	if got.ConflictReports != 2 || len(got.ConflictSamples) != 2 {
		t.Fatalf("conflicts: %d %+v", got.ConflictReports, got.ConflictSamples)
	}
	if len(got.MultiIdentityAssets) != 1 || got.MultiIdentityAssets[0].AssetID != "00000000-0000-4000-8000-00000000000a" {
		t.Fatalf("drift: %+v", got.MultiIdentityAssets)
	}
	if len(got.SharedIdentities) != 1 || got.SharedIdentities[0].AssetCount != 2 {
		t.Fatalf("shared: %+v", got.SharedIdentities)
	}
}

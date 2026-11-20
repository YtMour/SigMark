package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestCoverageCatalog(t *testing.T) {
	keys := coverageFieldKeys()
	if !slices.IsSorted(keys) || len(slices.Compact(slices.Clone(keys))) != len(keys) {
		t.Fatal("field keys must be deterministic and unique")
	}
	for _, key := range []string{"system.selinux", "network.wifiFrequency", "environment.systemDebuggable", "cellular.slotService"} {
		if !slices.Contains(keys, key) {
			t.Errorf("missing %s", key)
		}
	}
	for _, key := range []string{"system.fingerprint", "cellular.subscriptionId", "environment.configurationDigest"} {
		if slices.Contains(keys, key) {
			t.Errorf("local-only field shown in coverage: %s", key)
		}
	}
}

func TestRepositoryStatsInput(t *testing.T) {
	for _, value := range []string{"", "legacy", "2", "5", "999"} {
		if !validFieldSetFilter(value) {
			t.Errorf("rejected %q", value)
		}
	}
	h := (server{token: "test-token"}).routes()
	for _, probe := range []struct {
		url, token string
		status     int
	}{
		{"/api/admin/repository-stats", "", 401},
		{"/api/admin/repository-stats?fieldSet=%2B5", "Bearer test-token", 400},
		{"/api/admin/repository-stats?fieldSet=05", "Bearer test-token", 400},
		{"/api/admin/repository-stats?fieldSet=1000", "Bearer test-token", 400},
	} {
		req := httptest.NewRequest("GET", probe.url, nil)
		req.Header.Set("Authorization", probe.token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != probe.status {
			t.Errorf("%s: got %d, want %d", probe.url, w.Code, probe.status)
		}
	}
}

func TestRepositoryStatsPostgres(t *testing.T) {
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
	// Hide any persistent relation of the same name for this connection only.
	_, err = conn.Exec(ctx, `CREATE TEMP TABLE reports (
		id uuid PRIMARY KEY, batch text NOT NULL, request_id uuid NOT NULL,
		received_at timestamptz NOT NULL, body jsonb NOT NULL, trashed_at timestamptz, asset_id uuid
	)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = conn.Exec(ctx, `WITH fixtures(n,batch,rid,captured,archived,legacy) AS (VALUES
		(1,'model-a',1,100,true,false), (2,'model-b',1,100,true,false),
		(3,'model-a',3,100,true,false), (4,'model-a',4,101,true,false),
		(5,'model-a',5,102,true,true), (6,'model-a',6,103,false,false)
	)
	INSERT INTO reports
	SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,batch,
	       ('00000000-0000-4000-8000-'||lpad(rid::text,12,'0'))::uuid,
	       to_timestamp(n), jsonb_strip_nulls(jsonb_build_object(
	         'schemaVersion', CASE WHEN legacy THEN 1 ELSE 4 END,
	         'model','QA Stats','androidApi',34,'requestId',rid,'capturedAtEpochMs',captured,
	         'fieldSetVersion',CASE WHEN legacy THEN NULL ELSE 5 END,
	         'parameters',CASE WHEN legacy THEN NULL ELSE '[{"group":"system","key":"selinux","status":"RESTRICTED","reason":"ACCESS_DENIED"}]'::jsonb END,
	         'metrics',CASE WHEN legacy THEN '[{"key":"system.selinux","status":"RESTRICTED"}]'::jsonb ELSE NULL END)),
	       CASE WHEN archived THEN NULL ELSE now() END,NULL::uuid
	FROM fixtures`)
	if err != nil {
		t.Fatal(err)
	}
	type counts struct{ Archived int }
	type fieldCounts struct {
		Field                       string
		Restricted, Legacy, Missing int
		Reasons                     map[string]int
	}
	query := func(batch, fieldSet string) (out struct {
		Scope  counts
		Fields []fieldCounts
	}) {
		t.Helper()
		var raw []byte
		if err := conn.QueryRow(ctx, repositoryStatsSQL, batch, "", "", "", "", "", "", fieldSet, coverageFieldKeys()).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatal(err)
		}
		return
	}
	all := query("", "")
	if all.Scope.Archived != 5 {
		t.Fatalf("incorrect totals: %+v", all.Scope)
	}
	if scoped := query("model-b", "5"); scoped.Scope != (counts{Archived: 1}) {
		t.Fatalf("incorrect scope across replicated batches: %+v", scoped.Scope)
	}
	idx := slices.IndexFunc(all.Fields, func(f fieldCounts) bool { return f.Field == "system.selinux" })
	if idx < 0 {
		t.Fatal("SELinux field was not returned")
	}
	f := all.Fields[idx]
	if f.Restricted != 4 || f.Legacy != 1 || f.Missing != 0 || f.Reasons["ACCESS_DENIED"] != 4 {
		t.Fatalf("incorrect field coverage: %+v", f)
	}
}

func TestAssetOverviewPostgres(t *testing.T) {
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
	if _, err = conn.Exec(ctx, `CREATE TEMP TABLE reports(batch text, body jsonb, asset_id uuid, trashed_at timestamptz);
	   INSERT INTO reports SELECT 'qa',jsonb_build_object('model','Test','androidApi',29,'parameters',
	   jsonb_build_array(jsonb_build_object('group','system','key','release','status','AVAILABLE','value',release))),
	   CASE WHEN grouped THEN '00000000-0000-4000-8000-000000000001'::uuid END,CASE WHEN trash THEN now() END
	   FROM (VALUES ('10',true,false),('10',true,false),('14',true,false),('10',false,false),('11',true,true)) f(release,grouped,trash)`); err != nil {
		t.Fatal(err)
	}
	var raw []byte
	if err = conn.QueryRow(ctx, assetOverviewSQL).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	type bucket struct {
		Value            string
		Reports, Devices int
	}
	var got struct {
		Totals        map[string]int
		Distributions map[string]struct{ Buckets []bucket }
	}
	if err = json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.Totals["devices"] != 1 || got.Totals["reports"] != 4 || got.Totals["unassigned"] != 1 || got.Totals["trash"] != 1 {
		t.Fatalf("incorrect totals: %v", got.Totals)
	}
	if want := []bucket{{"10", 3, 1}, {"14", 1, 1}}; !slices.Equal(got.Distributions["android"].Buckets, want) {
		t.Fatalf("incorrect version distribution: %+v", got.Distributions["android"])
	}
}

package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"time"
)

var statisticsSlots = make(chan struct{}, 2)

func coverageFieldKeys() []string {
	known := map[string]struct{}{}
	for _, list := range []map[string][]string{parameterKeys, diagnosticKeys} {
		for group, keys := range list {
			for _, key := range keys {
				known[group+"."+key] = struct{}{}
			}
		}
	}
	for _, item := range versionedParameters {
		known[item.group+"."+item.key] = struct{}{}
	}
	keys := make([]string, 0, len(known))
	for field := range known {
		keys = append(keys, field)
	}
	sort.Strings(keys)
	return keys
}

func validFieldSetFilter(value string) bool {
	if value == "" || value == "legacy" {
		return true
	}
	n, err := strconv.Atoi(value)
	return err == nil && n > 0 && n <= 999 && strconv.Itoa(n) == value
}

// Coverage counts archived observations. Device deduplication belongs to deviceAssets.
const repositoryStatsSQL = `WITH scoped AS MATERIALIZED (
	SELECT id,coalesce(body->>'fieldSetVersion','legacy') AS field_set
	FROM reports ` + reportDimensions + `
	WHERE trashed_at IS NULL AND ` + archivePredicate + archiveFacets + `
), samples AS MATERIALIZED (
	SELECT id FROM scoped WHERE ($8='' OR field_set=$8)
), field_sets AS (
	SELECT DISTINCT field_set FROM scoped
), observed AS (
	SELECT CASE WHEN r.body->>'schemaVersion'='1' THEN p->>'key' ELSE (p->>'group')||'.'||(p->>'key') END AS field,
	       CASE WHEN r.body->>'schemaVersion'='1' THEN 'LEGACY' ELSE p->>'status' END AS state,
	       CASE WHEN r.body->>'schemaVersion'='1' THEN NULL ELSE p->>'reason' END AS reason,
	       p->>'label' AS label
	FROM samples JOIN reports r USING(id)
	CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN r.body->>'schemaVersion'='1' THEN r.body->'metrics' ELSE r.body->'parameters' END) p
), tall AS (
	SELECT field,state,reason,max(label) AS label,count(*) AS n FROM observed GROUP BY field,state,reason
), by_field AS (
	SELECT field,max(label) AS label,
	       coalesce(sum(n) FILTER (WHERE state='AVAILABLE'),0) AS available,
	       coalesce(sum(n) FILTER (WHERE state='RESTRICTED'),0) AS restricted,
	       coalesce(sum(n) FILTER (WHERE state='UNAVAILABLE'),0) AS unavailable,
	       coalesce(sum(n) FILTER (WHERE state='ERROR'),0) AS errors,
	       coalesce(sum(n) FILTER (WHERE state='LEGACY'),0) AS legacy,
	       coalesce(jsonb_object_agg(reason,n) FILTER (WHERE reason IS NOT NULL AND reason<>''),'{}') AS reasons
	FROM tall GROUP BY field
), field_catalog AS (
	SELECT unnest($9::text[]) AS field UNION SELECT field FROM by_field
), sample_stats AS (
	SELECT (SELECT count(*) FROM samples) AS total
), field_rows AS (
	SELECT field,split_part(field,'.',1) AS "group",split_part(field,'.',2) AS key,by_field.label,
	       coalesce(available,0) AS available,coalesce(restricted,0) AS restricted,
	       coalesce(unavailable,0) AS unavailable,coalesce(errors,0) AS errors,coalesce(legacy,0) AS legacy,
	       total - coalesce(available+restricted+unavailable+errors+legacy,0) AS missing,
	       coalesce(reasons,'{}') AS reasons
	FROM field_catalog LEFT JOIN by_field USING (field) CROSS JOIN sample_stats WHERE total>0
)
SELECT jsonb_build_object(
 'schemaVersion',2,'generatedAt',statement_timestamp(),
 'scope',jsonb_build_object('archived',(SELECT total FROM sample_stats)),
 'fieldSets',coalesce((SELECT jsonb_agg(field_set ORDER BY field_set) FROM field_sets),'[]'),
 'fields',coalesce((SELECT jsonb_agg(to_jsonb(field_rows) ORDER BY field) FROM field_rows),'[]')
)`

func (s server) repositoryStats(w http.ResponseWriter, r *http.Request) {
	args, ok := reportScope(w, r)
	if !ok {
		return
	}
	fieldSet := r.URL.Query().Get("fieldSet")
	if !validFieldSetFilter(fieldSet) {
		fail(w, 400, "invalid_field_set")
		return
	}
	select {
	case statisticsSlots <- struct{}{}:
		defer func() { <-statisticsSlots }()
	default:
		w.Header().Set("Retry-After", "2")
		fail(w, 429, "rate_limited")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	var data json.RawMessage
	if err := s.db.QueryRow(ctx, repositoryStatsSQL, append(args, fieldSet, coverageFieldKeys())...).Scan(&data); err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, data)
}

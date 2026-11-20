package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const missingFacet = "~missing"

// Only archived AVAILABLE values participate. Old reports are not enriched from other reports.
const reportDimensions = ` CROSS JOIN LATERAL (
 SELECT coalesce(nullif(btrim(body->>'model'),''),'~missing') AS model,
        coalesce(nullif(body->>'androidApi','0'),'~missing') AS api,
        coalesce(nullif(btrim(jsonb_path_query_first(body,'$.parameters[*] ? (@.group == "system" && @.key == "brand" && @.status == "AVAILABLE").value') #>> '{}'),''),'~missing') AS brand,
        coalesce(nullif(btrim(jsonb_path_query_first(body,'$.parameters[*] ? (@.group == "system" && @.key == "release" && @.status == "AVAILABLE").value') #>> '{}'),''),'~missing') AS android,
        coalesce(nullif(btrim(jsonb_path_query_first(body,'$.parameters[*] ? (@.group == "system" && @.key == "device" && @.status == "AVAILABLE").value') #>> '{}'),''),'~missing') AS device
) dims `

const archiveFacets = ` AND ($3='' OR brand=$3) AND ($4='' OR model=$4)
 AND ($5='' OR android=$5) AND ($6='' OR api=$6) AND ($7='' OR device=$7) `

func reportScope(w http.ResponseWriter, r *http.Request) ([]any, bool) {
	batch, query, ok := reportFilters(w, r)
	if !ok {
		return nil, false
	}
	facets, ok := readFacets(w, r)
	if !ok {
		return nil, false
	}
	return append([]any{batch, query}, facets...), true
}

func readFacets(w http.ResponseWriter, r *http.Request) ([]any, bool) {
	var result []any
	for _, key := range []string{"brand", "model", "android", "api", "device"} {
		value := strings.TrimSpace(r.URL.Query().Get(key))
		if !textValid(value, 512) {
			fail(w, 400, "invalid_report_facet")
			return nil, false
		}
		if key == "api" && value != "" && value != missingFacet {
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || n > 999 || strconv.Itoa(n) != value {
				fail(w, 400, "invalid_report_facet")
				return nil, false
			}
		}
		result = append(result, value)
	}
	return result, true
}

func (s server) reportFacets(w http.ResponseWriter, r *http.Request) {
	args, ok := reportScope(w, r)
	if !ok {
		return
	}
	trash, ok := trashFilter(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var data json.RawMessage
	// Disjunctive counts let users change a selected option. Brand → model → device
	// remains hierarchical, so selecting a brand narrows rather than resets its children.
	err := s.db.QueryRow(ctx, `WITH scoped AS (
	SELECT brand,model,android,api,device FROM reports `+reportDimensions+` WHERE `+archivePredicate+`
	AND (trashed_at IS NOT NULL)=$8
	), expanded AS (
	SELECT facet,value FROM scoped CROSS JOIN LATERAL (VALUES
	 ('brand',brand,($5='' OR android=$5) AND ($6='' OR api=$6)),
	 ('model',model,($3='' OR brand=$3) AND ($5='' OR android=$5) AND ($6='' OR api=$6)),
	 ('device',device,($3='' OR brand=$3) AND ($4='' OR model=$4) AND ($5='' OR android=$5) AND ($6='' OR api=$6)),
	 ('android',android,($3='' OR brand=$3) AND ($4='' OR model=$4) AND ($6='' OR api=$6) AND ($7='' OR device=$7)),
	 ('api',api,($3='' OR brand=$3) AND ($4='' OR model=$4) AND ($5='' OR android=$5) AND ($7='' OR device=$7))
	) t(facet,value,include) WHERE include
	), counts AS (SELECT facet,value,count(*) AS count FROM expanded GROUP BY facet,value),
	ranked AS (SELECT *, row_number() OVER (PARTITION BY facet ORDER BY count DESC,value) AS rank FROM counts),
	packed AS (SELECT facet,jsonb_agg(jsonb_build_object('value',value,'count',count) ORDER BY rank) AS options
	FROM ranked WHERE rank<=150 OR value='~missing' GROUP BY facet)
	SELECT coalesce(jsonb_object_agg(facet,options),'{}') FROM packed`, append(args, trash)...).Scan(&data)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, data)
}

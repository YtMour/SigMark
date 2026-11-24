package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Serialize retries before resolving an installation: even a client which lost the
// receipt and changed consent must never create or relink an asset on replay.
func (s server) storeReport(ctx context.Context, batch string, report Report, key string) (string, bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback(ctx)
	// Two-int advisory locks are separate from the bigint installation locks.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(714302,hashtext($1))`, batch+":"+report.RequestID); err != nil {
		return "", false, err
	}
	var id string
	var linked, identical bool
	err = tx.QueryRow(ctx, `SELECT id, asset_id IS NOT NULL, body=$3::jsonb FROM reports WHERE batch=$1 AND request_id=$2`, batch, report.RequestID, report).Scan(&id, &linked, &identical)
	switch {
	case err == nil:
		if !identical {
			return "", false, pgx.ErrNoRows
		}
		return id, linked, tx.Commit(ctx)
	case !errors.Is(err, pgx.ErrNoRows):
		return "", false, err
	}
	var asset *string
	if key != "" {
		// Protect installation resolution against a concurrent manual merge.
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock_shared(714301,5527)`); err != nil {
			return "", false, err
		}
		digest := sha256.Sum256([]byte(key))
		hash := hex.EncodeToString(digest[:])
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,712166))`, hash); err != nil {
			return "", false, err
		}
		var resolved string
		err = tx.QueryRow(ctx, `SELECT asset_id FROM asset_installations WHERE digest=$1`, hash).Scan(&resolved)
		if errors.Is(err, pgx.ErrNoRows) {
			err = tx.QueryRow(ctx, `INSERT INTO device_assets DEFAULT VALUES RETURNING id`).Scan(&resolved)
			if err == nil {
				_, err = tx.Exec(ctx, `INSERT INTO asset_installations(digest,asset_id) VALUES($1,$2)`, hash, resolved)
			}
		}
		if err != nil {
			return "", false, err
		}
		asset = &resolved
	}
	err = tx.QueryRow(ctx, `INSERT INTO reports(id,batch,request_id,body,asset_id) VALUES(gen_random_uuid(),$1,$2,$3,$4) RETURNING id,asset_id IS NOT NULL`, batch, report.RequestID, report, asset).Scan(&id, &linked)
	if err != nil {
		return "", false, err
	}
	return id, linked, tx.Commit(ctx)
}

type deviceAssignment struct {
	IDs     []string `json:"ids"`
	AssetID string   `json:"assetId,omitempty"`
	Label   string   `json:"label,omitempty"`
}

func (a deviceAssignment) valid() bool {
	if (reportMutation{Action: "trash", IDs: a.IDs}).statement() == "" {
		return false
	}
	if a.AssetID != "" {
		return requestPattern.MatchString(a.AssetID) && a.Label == ""
	}
	return strings.TrimSpace(a.Label) != "" && textValid(a.Label, 60)
}

func (s server) assignDeviceAsset(w http.ResponseWriter, r *http.Request) {
	var a deviceAssignment
	if decodeStrict(http.MaxBytesReader(w, r.Body, 4096), &a) != nil || !a.valid() {
		fail(w, 400, "invalid_device_assignment")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock_shared(714301,5527)`); err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	if a.AssetID == "" {
		err = tx.QueryRow(ctx, `INSERT INTO device_assets(label) VALUES($1) RETURNING id`, strings.TrimSpace(a.Label)).Scan(&a.AssetID)
	} else {
		err = tx.QueryRow(ctx, `SELECT id FROM device_assets WHERE id=$1`, a.AssetID).Scan(&a.AssetID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "device_asset_not_found")
		return
	}
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	updated, err := tx.Exec(ctx, `UPDATE reports SET asset_id=$2 WHERE id=ANY($1::text[]::uuid[])
	AND asset_id IS NULL AND trashed_at IS NULL`, a.IDs, a.AssetID)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	if updated.RowsAffected() != int64(len(a.IDs)) {
		fail(w, 409, "device_assignment_changed")
		return
	}
	if tx.Commit(ctx) != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, map[string]any{"assetId": a.AssetID, "assigned": updated.RowsAffected()})
}

type assetMerge struct {
	Source    string `json:"source"`
	Target    string `json:"target"`
	Confirmed bool   `json:"confirmed"`
	Preview   string `json:"previewToken"`
}

func (a assetMerge) valid() bool {
	return a.Confirmed && a.Source != a.Target && requestPattern.MatchString(a.Source) && requestPattern.MatchString(a.Target)
}

func (s server) deviceAssets(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("summary") == "1" {
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()
		var payload json.RawMessage
		err := s.db.QueryRow(ctx, assetOverviewSQL).Scan(&payload)
		if err != nil {
			fail(w, 503, "storage_unavailable")
			return
		}
		send(w, 200, payload)
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	at, id, err := parseCursor(r.URL.Query().Get("before"))
	if !textValid(q, 80) || err != nil {
		fail(w, 400, "invalid_query")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var totals, items json.RawMessage
	var nextAt *time.Time
	var nextID *string
	err = s.db.QueryRow(ctx, `WITH groups AS (
	    SELECT asset_id AS id,count(*) AS reports, min(received_at) AS "firstSeen",max(received_at) AS "lastSeen"
	    FROM reports WHERE trashed_at IS NULL AND asset_id IS NOT NULL GROUP BY asset_id
	  ), page AS MATERIALIZED (
	    SELECT g.*, a.label, latest.model FROM groups g JOIN device_assets a USING (id)
	    CROSS JOIN LATERAL (
	      SELECT body->>'model' AS model FROM reports WHERE asset_id=g.id AND trashed_at IS NULL
	      ORDER BY received_at DESC,id DESC LIMIT 1
	    ) latest
	    WHERE ($1='' OR strpos(lower(concat_ws(' ',a.label,latest.model,g.id::text)),lower($1))>0)
	      AND ($2::timestamptz IS NULL OR (g."lastSeen",g.id)<($2::timestamptz,$3::uuid))
	    ORDER BY g."lastSeen" DESC,g.id DESC LIMIT 31
	  ), counters AS (
	    SELECT count(*) FILTER (WHERE trashed_at IS NULL) AS reports,
	      count(*) FILTER (WHERE trashed_at IS NULL AND asset_id IS NULL) AS unassigned,
	      count(*) FILTER (WHERE trashed_at IS NOT NULL) AS trash FROM reports
	  )
	  SELECT (SELECT jsonb_build_object('devices',(SELECT count(*) FROM groups),'reports',reports,'unassigned',unassigned,'trash',trash) FROM counters),
	    coalesce((SELECT jsonb_agg(to_jsonb(first_page)) FROM (SELECT * FROM page ORDER BY "lastSeen" DESC,id DESC LIMIT 30) first_page),'[]'),
	    CASE WHEN (SELECT count(*) FROM page)>30 THEN (SELECT "lastSeen" FROM page ORDER BY "lastSeen" DESC,id DESC OFFSET 29 LIMIT 1) END,
	    CASE WHEN (SELECT count(*) FROM page)>30 THEN (SELECT id FROM page ORDER BY "lastSeen" DESC,id DESC OFFSET 29 LIMIT 1) END`, q, at, id).Scan(&totals, &items, &nextAt, &nextID)
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	next := ""
	if nextAt != nil && nextID != nil {
		next = makeCursor(*nextAt, *nextID)
	}
	send(w, 200, map[string]any{"totals": totals, "items": items, "nextCursor": next})
}

// Count repository reports, and count devices separately inside each bucket.
// A device may be represented in multiple Android versions after a ROM upgrade.
const assetOverviewSQL = `WITH active AS MATERIALIZED (
	SELECT asset_id,batch,brand,android,api,model FROM reports ` + reportDimensions + ` WHERE trashed_at IS NULL
), grouped AS (
	SELECT category,value,count(*) AS reports,count(DISTINCT asset_id) AS devices
	FROM active CROSS JOIN LATERAL (VALUES ('brand',brand),('android',android),
		('model',model),('api',api),('batch',batch)) AS d(category,value)
	GROUP BY category,value
), ranked AS (
	SELECT *,row_number() OVER (PARTITION BY category ORDER BY reports DESC,value) AS rank
	FROM grouped
), distributions AS (
	SELECT category,jsonb_build_object('buckets',jsonb_agg(jsonb_build_object('value',value,'reports',reports,'devices',devices) ORDER BY rank)
		FILTER(WHERE rank<=8),'otherBuckets',greatest(count(*)-8,0)) AS data
	FROM ranked GROUP BY category
)
SELECT jsonb_build_object('schemaVersion',1,'generatedAt',statement_timestamp(),
	'totals',jsonb_build_object('devices',count(DISTINCT asset_id),'reports',count(*),
		'unassigned',count(*) FILTER(WHERE asset_id IS NULL),
		'trash',(SELECT count(*) FROM reports WHERE trashed_at IS NOT NULL)),
	'distributions',coalesce((SELECT jsonb_object_agg(category,data) FROM distributions),'{}'))
FROM active`

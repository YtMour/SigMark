package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

const undoWindow = 24 * time.Hour
const assetWriteLock = `SELECT pg_advisory_xact_lock(714301,5527)`
const readAssetImpactSQL = `SELECT a.id,a.label,a.created_at,
  coalesce(nullif(a.label,''),(SELECT r.body->>'model' FROM reports r WHERE r.asset_id=a.id ORDER BY r.trashed_at NULLS FIRST,r.received_at DESC,r.id DESC LIMIT 1),'未命名设备'),
  ARRAY(SELECT r.id::text FROM reports r WHERE r.asset_id=a.id ORDER BY r.id),
  ARRAY(SELECT r.id::text FROM reports r WHERE r.asset_id=a.id AND r.trashed_at IS NOT NULL ORDER BY r.id),
  ARRAY(SELECT b.id::text FROM regression_baselines b JOIN reports r ON r.id=b.report_id WHERE r.asset_id=a.id ORDER BY b.id),
  ARRAY(SELECT i.digest::text FROM asset_installations i WHERE i.asset_id=a.id ORDER BY i.digest)
 FROM device_assets a WHERE a.id=$1`

type assetImpact struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Reports       int    `json:"reports"`
	Trashed       int    `json:"trashed"`
	Baselines     int    `json:"baselines"`
	Installations int    `json:"installations"`
}

type assetSnapshot struct {
	assetImpact
	label                               string
	created                             time.Time
	reports, trash, baselines, installs []string
}

func readAssetImpact(ctx context.Context, tx pgx.Tx, id string) (assetSnapshot, error) {
	var a assetSnapshot
	err := tx.QueryRow(ctx, readAssetImpactSQL, id).Scan(&a.ID, &a.label, &a.created, &a.Title, &a.reports, &a.trash, &a.baselines, &a.installs)
	a.Trashed, a.Baselines, a.Installations = len(a.trash), len(a.baselines), len(a.installs)
	a.Reports = len(a.reports) - a.Trashed
	return a, err
}

func stableDigest(data any) string {
	b, _ := json.Marshal(data) // Callers only pass JSON-ready scalars and slices.
	d := sha256.Sum256(b)
	return hex.EncodeToString(d[:])
}

func previewDigest(source, target assetSnapshot) string {
	snapshot := func(a assetSnapshot) []any { return []any{a.assetImpact, a.reports, a.trash, a.baselines, a.installs} }
	return stableDigest([]any{snapshot(source), snapshot(target)})
}

// Compare identities, not counts. Trash/restore keeps the same report ID and
// can remain in effect during undo; newly uploaded/purged/moved rows cannot.
func membershipDigest(reports, installs []string) string {
	r := append([]string{}, reports...)
	i := append([]string{}, installs...)
	sort.Strings(r)
	sort.Strings(i)
	return stableDigest([]any{r, i})
}

func validPreview(token string) bool {
	decoded, err := hex.DecodeString(token)
	return err == nil && len(decoded) == sha256.Size
}

func mergeReadFailure(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "device_asset_not_found")
		return
	}
	fail(w, 503, "storage_unavailable")
}

func mergeSnapshots(ctx context.Context, tx pgx.Tx, source, target string) (assetSnapshot, assetSnapshot, error) {
	a, err := readAssetImpact(ctx, tx, source)
	if err != nil {
		return a, assetSnapshot{}, err
	}
	b, err := readAssetImpact(ctx, tx, target)
	return a, b, err
}

func (s server) previewAssetMerge(w http.ResponseWriter, r *http.Request) {
	a := assetMerge{Source: r.URL.Query().Get("source"), Target: r.URL.Query().Get("target"), Confirmed: true}
	if !a.valid() {
		fail(w, 400, "invalid_device_assignment")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		mergeReadFailure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	source, target, err := mergeSnapshots(ctx, tx, a.Source, a.Target)
	if err != nil {
		mergeReadFailure(w, err)
		return
	}
	send(w, 200, map[string]any{"schemaVersion": 1, "source": source.assetImpact, "target": target.assetImpact,
		"previewToken": previewDigest(source, target), "undoWindowHours": int(undoWindow / time.Hour)})
}

func pruneExpiredAssetMergePayload(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `UPDATE asset_merge_operations SET report_ids='{}',install_digests='{}',target_guard=''
	 WHERE created_at<=now()-interval '24 hours' AND target_guard<>''`)
	return err
}

func (s server) mergeDeviceAsset(w http.ResponseWriter, r *http.Request) {
	var a assetMerge
	if decodeStrict(http.MaxBytesReader(w, r.Body, 2048), &a) != nil || !a.valid() {
		fail(w, 400, "invalid_device_assignment")
		return
	}
	if !validPreview(a.Preview) {
		fail(w, 400, "asset_merge_preview_required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		mergeReadFailure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, assetWriteLock); err != nil {
		mergeReadFailure(w, err)
		return
	}
	source, target, err := mergeSnapshots(ctx, tx, a.Source, a.Target)
	if err != nil {
		mergeReadFailure(w, err)
		return
	}
	if a.Preview != previewDigest(source, target) {
		fail(w, 409, "asset_merge_preview_changed")
		return
	}
	guard := membershipDigest(append(append([]string{}, target.reports...), source.reports...),
		append(append([]string{}, target.installs...), source.installs...))
	if err = pruneExpiredAssetMergePayload(ctx, tx); err != nil {
		mergeReadFailure(w, err)
		return
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO asset_merge_operations
	 (source_id,target_id,source_label,source_created_at,source_title,target_title,active_moved,trash_moved,baselines_moved,installs_moved,
	  target_guard,report_ids,install_digests) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
		source.ID, target.ID, source.label, source.created, source.Title, target.Title, source.Reports, source.Trashed, source.Baselines, source.Installations,
		guard, source.reports, source.installs).Scan(&id)
	if err != nil {
		mergeReadFailure(w, err)
		return
	}
	for _, sql := range []string{`UPDATE reports SET asset_id=$2 WHERE asset_id=$1`, `UPDATE asset_installations SET asset_id=$2 WHERE asset_id=$1`} {
		if _, err = tx.Exec(ctx, sql, a.Source, a.Target); err != nil {
			mergeReadFailure(w, err)
			return
		}
	}
	if _, err = tx.Exec(ctx, `DELETE FROM device_assets WHERE id=$1`, a.Source); err != nil {
		mergeReadFailure(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		mergeReadFailure(w, err)
		return
	}
	send(w, 200, map[string]string{"assetId": a.Target, "operationId": id})
}

type mergeAudit struct {
	ID            string     `json:"id"`
	SourceID      string     `json:"sourceId"`
	TargetID      string     `json:"targetId"`
	SourceTitle   string     `json:"sourceTitle"`
	TargetTitle   string     `json:"targetTitle"`
	Reports       int        `json:"reports"`
	Trashed       int        `json:"trashed"`
	Baselines     int        `json:"baselines"`
	Installations int        `json:"installations"`
	Created       time.Time  `json:"createdAt"`
	Expires       time.Time  `json:"expiresAt"`
	Undone        *time.Time `json:"undoneAt,omitempty"`
	State         string     `json:"state"`
}

func (s server) listAssetMerges(w http.ResponseWriter, r *http.Request) {
	at, id, err := parseCursor(r.URL.Query().Get("before"))
	if err != nil {
		fail(w, 400, "invalid_query")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	rows, err := s.db.Query(ctx, `SELECT id,source_id,target_id,source_title,target_title,active_moved,trash_moved,baselines_moved,installs_moved,created_at,
	 created_at+interval '24 hours',undone_at,CASE WHEN undone_at IS NOT NULL THEN 'undone' WHEN now()>=created_at+interval '24 hours' THEN 'expired'
	 WHEN NOT EXISTS(SELECT 1 FROM device_assets a WHERE a.id=target_id) THEN 'changed' ELSE 'eligible' END
	 FROM asset_merge_operations WHERE ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::uuid))
	 ORDER BY created_at DESC,id DESC LIMIT 21`, at, id)
	if err != nil {
		mergeReadFailure(w, err)
		return
	}
	defer rows.Close()
	items := []mergeAudit{}
	for rows.Next() {
		var i mergeAudit
		if err = rows.Scan(&i.ID, &i.SourceID, &i.TargetID, &i.SourceTitle, &i.TargetTitle, &i.Reports, &i.Trashed, &i.Baselines, &i.Installations,
			&i.Created, &i.Expires, &i.Undone, &i.State); err != nil {
			mergeReadFailure(w, err)
			return
		}
		items = append(items, i)
	}
	if err = rows.Err(); err != nil {
		mergeReadFailure(w, err)
		return
	}
	next := ""
	if len(items) > 20 {
		items = items[:20]
		last := items[len(items)-1]
		next = makeCursor(last.Created, last.ID)
	}
	send(w, 200, map[string]any{"schemaVersion": 1, "items": items, "nextCursor": next})
}

func (s server) undoAssetMerge(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var input struct {
		Confirmed bool `json:"confirmed"`
	}
	if !requestPattern.MatchString(id) || decodeStrict(http.MaxBytesReader(w, r.Body, 512), &input) != nil || !input.Confirmed {
		fail(w, 400, "invalid_device_assignment")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		mergeReadFailure(w, err)
		return
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, assetWriteLock); err != nil {
		mergeReadFailure(w, err)
		return
	}
	var source, target, label, guard string
	var created time.Time
	var eligible bool
	var reports, installs []string
	err = tx.QueryRow(ctx, `SELECT source_id,target_id,source_label,source_created_at,target_guard,report_ids,install_digests,
	 undone_at IS NULL AND now()<created_at+interval '24 hours' FROM asset_merge_operations WHERE id=$1`, id).
		Scan(&source, &target, &label, &created, &guard, &reports, &installs, &eligible)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "asset_merge_not_found")
		return
	}
	if err != nil {
		mergeReadFailure(w, err)
		return
	}
	if !eligible || guard == "" {
		fail(w, 409, "asset_merge_undo_unavailable")
		return
	}
	state, err := readAssetImpact(ctx, tx, target)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && membershipDigest(state.reports, state.installs) != guard) {
		fail(w, 409, "asset_merge_membership_changed")
		return
	}
	if err != nil {
		mergeReadFailure(w, err)
		return
	}
	if _, err = tx.Exec(ctx, `INSERT INTO device_assets(id,label,created_at) VALUES($1,$2,$3)`, source, label, created); err != nil {
		mergeReadFailure(w, err)
		return
	}
	for _, update := range []struct {
		sql string
		ids []string
	}{
		{`UPDATE reports SET asset_id=$1 WHERE asset_id=$2 AND id=ANY($3::text[]::uuid[])`, reports},
		{`UPDATE asset_installations SET asset_id=$1 WHERE asset_id=$2 AND digest=ANY($3::text[]::bpchar[])`, installs},
	} {
		n, e := tx.Exec(ctx, update.sql, source, target, update.ids)
		if e != nil {
			mergeReadFailure(w, e)
			return
		}
		if n.RowsAffected() != int64(len(update.ids)) {
			fail(w, 409, "asset_merge_membership_changed")
			return
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE asset_merge_operations SET undone_at=now(),report_ids='{}',install_digests='{}',target_guard='' WHERE id=$1`, id); err != nil {
		mergeReadFailure(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		mergeReadFailure(w, err)
		return
	}
	send(w, 200, map[string]string{"operationId": id, "assetId": source})
}

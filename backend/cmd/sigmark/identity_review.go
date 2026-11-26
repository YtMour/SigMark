package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

var reviewIdentityKeys = []string{"system.model", "system.device", "system.initialSdk", "system.boardPlatform", "system.bootHardware", "system.hardwareSku"}
var identityDeviceCode = regexp.MustCompile("^[A-Za-z0-9._-]{1,80}$")

type identityReviewInput struct {
	Observer   string             `json:"observer"`
	ObservedAt int64              `json:"observedAtEpochMs"`
	Readings   map[string]*string `json:"readings"`
	Confirmed  bool               `json:"confirmed"`
}

type identityReviewPair struct {
	Key   string  `json:"key"`
	App   *string `json:"app"`
	Shell *string `json:"shell"`
	State string  `json:"state"`
}

type identityReview struct {
	ReportID   string               `json:"reportId"`
	CapturedAt int64                `json:"capturedAtEpochMs"`
	ObservedAt int64                `json:"observedAtEpochMs"`
	Compared   int                  `json:"compared"`
	Different  int                  `json:"different"`
	Pairs      []identityReviewPair `json:"pairs"`
}

func validIdentityClaim(key, value string) bool {
	if value == "" || strings.EqualFold(value, "unknown") || strings.EqualFold(value, "null") {
		return false
	}
	switch key {
	case "system.model":
		return textValid(value, 100)
	case "system.device":
		return identityDeviceCode.MatchString(value)
	case "system.initialSdk":
		return compactIntRange(value, 1, 99)
	case "system.boardPlatform", "system.bootHardware", "system.hardwareSku":
		return skuCode.MatchString(value)
	default:
		return false
	}
}

func buildIdentityReview(id string, report Report, in identityReviewInput) (identityReview, bool) {
	result := identityReview{ReportID: id, CapturedAt: report.CapturedAt, ObservedAt: in.ObservedAt}
	// Require two observations from the same capture window. A stored result can
	// appear on another archived report only as explicitly labelled asset history.
	if !in.Confirmed || in.Observer != "ADB_SHELL" || in.ObservedAt <= 0 ||
		in.ObservedAt > 8640000000000000 || report.CapturedAt <= 0 || report.CapturedAt > 8640000000000000 ||
		in.ObservedAt < report.CapturedAt-300000 || in.ObservedAt > report.CapturedAt+300000 ||
		len(in.Readings) > len(reviewIdentityKeys) {
		return result, false
	}
	for key, value := range in.Readings {
		if !oneOf(key, reviewIdentityKeys...) || (value != nil && !validIdentityClaim(key, *value)) {
			return result, false
		}
	}
	fields := make(map[string]*string, len(reviewIdentityKeys))
	if validIdentityClaim("system.model", report.Model) {
		fields["system.model"] = &report.Model
	}
	for _, parameter := range report.Parameters {
		key := parameter.Group + "." + parameter.Key
		if key != "system.model" && parameter.Status == "AVAILABLE" && parameter.Value != nil &&
			validIdentityClaim(key, *parameter.Value) {
			fields[key] = parameter.Value
		}
	}
	for _, key := range reviewIdentityKeys {
		pair := identityReviewPair{Key: key, App: fields[key], Shell: in.Readings[key], State: "missing"}
		if pair.App != nil && pair.Shell != nil {
			result.Compared++
			pair.State = "matching"
			if !strings.EqualFold(*pair.App, *pair.Shell) {
				result.Different++
				pair.State = "different"
			}
		}
		result.Pairs = append(result.Pairs, pair)
	}
	return result, result.Compared > 0
}

func (s server) saveIdentityReview(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var in identityReviewInput
	if !requestPattern.MatchString(id) || decodeStrict(http.MaxBytesReader(w, r.Body, 4096), &in) != nil {
		fail(w, 400, "invalid_identity_review")
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
	var report Report
	err = tx.QueryRow(ctx, `SELECT body FROM reports WHERE id=$1 AND trashed_at IS NULL FOR SHARE`, id).Scan(&report)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "report_not_found")
		return
	}
	if err != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	review, valid := buildIdentityReview(id, report, in)
	if !valid {
		fail(w, 400, "invalid_identity_review")
		return
	}
	_, err = tx.Exec(ctx, `INSERT INTO report_identity_reviews(report_id, evidence) VALUES ($1,$2)
		ON CONFLICT (report_id) DO UPDATE SET evidence=EXCLUDED.evidence`, id, review)
	if err != nil || tx.Commit(ctx) != nil {
		fail(w, 503, "storage_unavailable")
		return
	}
	send(w, 200, review)
}

const identityReviewSQL = `SELECT coalesce((
	SELECT review.evidence FROM report_identity_reviews review
	JOIN reports paired ON paired.id=review.report_id
	WHERE selected.trashed_at IS NULL AND paired.trashed_at IS NULL
		AND (paired.id=selected.id OR paired.asset_id=selected.asset_id)
	ORDER BY (paired.id=selected.id) DESC, (review.evidence->>'observedAtEpochMs')::bigint DESC, paired.id
	LIMIT 1), 'null'::jsonb) FROM reports selected WHERE selected.id=$1`

func (s server) getIdentityReview(ctx context.Context, id string) (json.RawMessage, error) {
	var result json.RawMessage
	err := s.db.QueryRow(ctx, identityReviewSQL, id).Scan(&result)
	return result, err
}

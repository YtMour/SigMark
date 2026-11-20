package main

import (
	"encoding/base64"
	"errors"
	"strings"
	"time"
)

func makeCursor(t time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(t.UTC().Format(time.RFC3339Nano) + "/" + id))
}

func parseCursor(raw string) (*time.Time, *string, error) {
	if raw == "" {
		return nil, nil, nil
	}
	invalid := errors.New("invalid cursor")
	if len(raw) > 128 {
		return nil, nil, invalid
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, nil, invalid
	}
	date, id, ok := strings.Cut(string(b), "/")
	if !ok || !requestPattern.MatchString(id) {
		return nil, nil, invalid
	}
	t, err := time.Parse(time.RFC3339Nano, date)
	if err != nil {
		return nil, nil, invalid
	}
	return &t, &id, nil
}

package main

import (
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"

	"unicode"
	"unicode/utf8"
)

type Metric struct {
	Key    string `json:"key"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}

type Report struct {
	SchemaVersion int      `json:"schemaVersion"`
	RequestID     string   `json:"requestId"`
	CapturedAt    int64    `json:"capturedAtEpochMs"`
	Model         string   `json:"model"`
	AndroidAPI    int      `json:"androidApi"`
	AppVersion    string   `json:"appVersion"`
	Network       string   `json:"network"`
	WifiBand      string   `json:"wifiBand"`
	Radio         string   `json:"radio"`
	Metrics       []Metric `json:"metrics"`
	Feedback      string   `json:"feedback,omitempty"`
}

var (
	batchPattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)
	requestPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	modelPattern   = regexp.MustCompile(`^[\p{L}\p{N} ._+()-]{1,40}$`)
	versionPattern = regexp.MustCompile(`^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$`)
)

func oneOf(s string, options ...string) bool {
	for _, o := range options {
		if s == o {
			return true
		}
	}
	return false
}

func decodeStrict(r io.Reader, dst any) error {
	d := json.NewDecoder(r)
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errors.New("trailing data")
	}
	return nil
}

func (p Report) valid() bool {
	if p.SchemaVersion != 1 || !requestPattern.MatchString(p.RequestID) || p.AndroidAPI < 0 || p.AndroidAPI > 999 ||
		!modelPattern.MatchString(p.Model) || !versionPattern.MatchString(p.AppVersion) ||
		p.CapturedAt < 946684800000 || p.CapturedAt >= 4102444800000 ||
		!oneOf(p.Network, "wifi", "cellular", "ethernet", "vpn", "none", "other", "unknown") ||
		!oneOf(p.WifiBand, "2.4", "4.9", "5", "6", "60", "unknown") ||
		!oneOf(p.Radio, "lte", "nr", "iwlan", "other", "unknown") ||
		utf8.RuneCountInString(p.Feedback) > 300 || strings.IndexFunc(p.Feedback, unicode.IsControl) >= 0 || len(p.Metrics) == 0 || len(p.Metrics) > 6 {
		return false
	}
	seen := map[string]bool{}
	for _, m := range p.Metrics {
		if seen[m.Key] || !oneOf(m.Key, "system.selinux", "cpu.kernelFull", "network.wifiFrequency", "network.internetValidation", "cellular.dataRat", "cellular.cellDiagnostics") {
			return false
		}
		seen[m.Key] = true
		if !oneOf(m.Status, "AVAILABLE", "UNAVAILABLE", "RESTRICTED", "ERROR") {
			return false
		}
		if m.Reason != "" && !((m.Status == "RESTRICTED" && oneOf(m.Reason, "PERMISSION_REQUIRED", "LOCATION_DISABLED", "ACCESS_DENIED")) ||
			(m.Status == "UNAVAILABLE" && m.Reason == "NOT_REPORTED") || (m.Status == "ERROR" && m.Reason == "READ_FAILED")) {
			return false
		}
	}
	return true
}

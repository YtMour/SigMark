package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func synthetic() Report {
	return Report{SchemaVersion: 1, RequestID: "00000000-0000-4000-8000-000000000001", CapturedAt: 1800000000000,
		Model: "Synthetic QA", AndroidAPI: 34, AppVersion: "0.3.0", Network: "wifi", WifiBand: "5", Radio: "lte",
		Metrics: []Metric{{Key: "system.selinux", Status: "RESTRICTED", Reason: "ACCESS_DENIED"}}}
}

func TestParametersAndPaginationContract(t *testing.T) {
	p := synthetic()
	p.SchemaVersion = 2
	p.Parameters = []Parameter{{Group: "system", Key: "selinux", Label: "SELinux", Source: "/sys/fs/selinux/enforce", Status: "RESTRICTED", Reason: "ACCESS_DENIED"}}
	errno := 13
	p.Parameters[0].Errno = &errno
	if !p.valid() {
		t.Fatal("detailed report rejected")
	}
	p.Parameters[0].Key = "fingerprint"
	if p.valid() {
		t.Fatal("excluded key accepted")
	}
	p.Parameters[0].Key = "selinux"
	p.Parameters[0].Value = new(string)
	if p.valid() {
		t.Fatal("unavailable value must be null")
	}
	p.Parameters[0].Value = nil
	p.SchemaVersion = 1
	if p.valid() {
		t.Fatal("unexpected v1 parameters accepted")
	}
	at := time.Unix(1800000000, 123456000)
	got, id, err := parseCursor(makeCursor(at, p.RequestID))
	if err != nil || !got.Equal(at) || *id != p.RequestID {
		t.Fatal("cursor round trip")
	}
	if _, _, err := parseCursor("not-an-index"); err == nil {
		t.Fatal("invalid cursor accepted")
	}
}

func TestReportSchemaRejectsExcessData(t *testing.T) {
	r := synthetic()
	if !r.valid() {
		t.Fatal("valid report rejected")
	}
	withoutMetrics := synthetic()
	withoutMetrics.Metrics = nil
	if withoutMetrics.valid() {
		t.Fatal("null metrics accepted")
	}
	r.Metrics[0].Key = "system.fingerprint"
	if r.valid() {
		t.Fatal("unexpected field accepted")
	}
	r = synthetic()
	r.Metrics = append(r.Metrics, r.Metrics[0])
	if r.valid() {
		t.Fatal("duplicate metric accepted")
	}
	r = synthetic()
	r.Metrics[0].Status = "AVAILABLE"
	if r.valid() {
		t.Fatal("inconsistent reason accepted")
	}
	b, _ := json.Marshal(synthetic())
	if decodeStrict(strings.NewReader(string(b[:len(b)-1])+`,"ssid":"private"}`), new(Report)) == nil {
		t.Fatal("accepted unknown top-level field")
	}
	if decodeStrict(strings.NewReader(string(b)+` {}`), new(Report)) == nil {
		t.Fatal("accepted trailing data")
	}
}

func TestLanSeparation(t *testing.T) {
	s := server{token: "test-token", batch: "lan-direct"}
	h := s.routes()
	for _, tc := range []struct {
		method, path, authorization, marker, origin string
		want                                        int
	}{
		{"GET", "/", "", "", "", 200},
		{"GET", "/api/admin/session", "", "", "", 401},
		{"GET", "/api/admin/session", "Bearer wrong", "", "", 401},
		{"GET", "/api/admin/session", "Bearer test-token", "", "", 200},
		{"GET", "/api/admin/reports", "", "android-lan", "", 401},
		{"POST", "/api/admin/invites", "Bearer test-token", "", "", 404},
		{"POST", "/api/v1/reports", "Bearer test-token", "", "", 403},
		{"POST", "/api/v1/reports", "", "android-lan", "http://example.test", 403},
		{"POST", "/api/v1/reports", "", "android-lan", "", 415},
	} {
		r := httptest.NewRequest(tc.method, tc.path, nil)
		if tc.authorization != "" {
			r.Header.Set("Authorization", tc.authorization)
		}
		if tc.marker != "" {
			r.Header.Set("X-SigMark-Client", tc.marker)
		}
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("%s %s: got %d want %d", tc.method, tc.path, w.Code, tc.want)
		}
		if w.Header().Get("WWW-Authenticate") != "" {
			t.Fatal("native login challenge must not appear")
		}
	}
}

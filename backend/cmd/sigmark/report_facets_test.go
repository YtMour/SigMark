package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFacetParameters(t *testing.T) {
	for _, suffix := range []string{"", "?api=29", "?api=~missing", "?brand=Example&model=Example+One&device=example"} {
		r := httptest.NewRequest("GET", "/"+suffix, nil)
		args, ok := reportScope(httptest.NewRecorder(), r)
		if !ok || len(args) != 7 || args[5] != r.URL.Query().Get("api") {
			t.Fatalf("scope %q: %v, %t", suffix, args, ok)
		}
	}
	for _, suffix := range []string{"api=-1", "api=01", "api=NaN", "api=1000", "device=%00", "brand=" + strings.Repeat("x", 513)} {
		w := httptest.NewRecorder()
		_, ok := reportScope(w, httptest.NewRequest("GET", "/?"+suffix, nil))
		if ok || w.Code != 400 {
			t.Fatalf("invalid filter accepted: %q", suffix)
		}
	}
}

func TestExportGuards(t *testing.T) {
	id := "00000000-0000-4000-8000-000000000001"
	if !(exportSelection{Mode: "selected", IDs: []string{id}}).valid() || !(exportSelection{Mode: "filtered"}).valid() {
		t.Fatal("invalid validation for supported modes")
	}
	for _, input := range []exportSelection{
		{Mode: "selected", IDs: []string{id, id}}, {Mode: "selected"}, {Mode: "selected", IDs: make([]string, 31)},
		{Mode: "filtered", IDs: []string{id}}, {Mode: "all"}, {Mode: "selected", IDs: []string{"../manifest.json"}},
	} {
		if input.valid() {
			t.Fatalf("accepted invalid export request: %#v", input)
		}
	}
	router := (server{token: "test-token"}).routes()
	for _, probe := range []struct {
		path, auth, intent, body string
		want                     int
	}{
		{"/api/admin/report-facets", "", "", "", 401},
		{"/api/admin/reports/export", "", "", "{}", 401},
		{"/api/admin/reports/export", "Bearer test-token", "", "{}", 403},
		{"/api/admin/reports/export", "Bearer test-token", "1", `{"mode":"filtered","other":1}`, 400},
		{"/api/admin/reports/export", "Bearer test-token", "1", `{"mode":"filtered"}` + strings.Repeat(" ", 4096), 400},
	} {
		method := "POST"
		if probe.path == "/api/admin/report-facets" {
			method = "GET"
		}
		r := httptest.NewRequest(method, probe.path, strings.NewReader(probe.body))
		r.Header.Set("Authorization", probe.auth)
		r.Header.Set("X-SigMark-Admin", probe.intent)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != probe.want {
			t.Fatalf("%s %s: got %d, want %d", method, probe.path, w.Code, probe.want)
		}
	}
}

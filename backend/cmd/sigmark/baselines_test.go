package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBaselineInputAndAuth(t *testing.T) {
	id := "00000000-0000-4000-8000-000000000001"
	if !(baselineInput{Name: "MI 8 刷机前", ReportID: id, ExpectUnlock: true}).valid() {
		t.Fatal("valid baseline rejected")
	}
	for _, input := range []baselineInput{
		{Name: " ", ReportID: id}, {Name: "line\nbreak", ReportID: id}, {Name: strings.Repeat("甲", 61), ReportID: id}, {Name: "QA", ReportID: "invalid"},
	} {
		if input.valid() {
			t.Fatalf("invalid baseline: %+v", input)
		}
	}
	router := (server{token: "qa"}).routes()
	for _, test := range []struct {
		method, path, token, intent string
		want                        int
	}{
		{"GET", "/api/admin/regression-baselines", "", "", 401},
		{"POST", "/api/admin/regression-baselines", "Bearer qa", "", 403},
		{"POST", "/api/admin/regression-baselines", "Bearer qa", "1", 400},
		{"DELETE", "/api/admin/regression-baselines/invalid", "Bearer qa", "1", 400},
	} {
		req := httptest.NewRequest(test.method, test.path, strings.NewReader("{}"))
		req.Header.Set("Authorization", test.token)
		req.Header.Set("X-SigMark-Admin", test.intent)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != test.want {
			t.Errorf("%s %s = %d, want %d", test.method, test.path, rec.Code, test.want)
		}
	}
}

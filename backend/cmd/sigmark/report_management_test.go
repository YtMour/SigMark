package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReportManagementGuards(t *testing.T) {
	ids := []string{"00000000-0000-4000-8000-000000000001"}
	for _, action := range []string{"trash", "restore", "purge"} {
		input := reportMutation{Action: action, IDs: ids}
		if action == "purge" {
			if input.statement() != "" {
				t.Fatal("missing purge confirmation accepted")
			}
			input.Confirmation = "DELETE"
		}
		if !strings.Contains(input.statement(), "trashed_at") {
			t.Fatalf("missing state guard for %s", action)
		}
		input.IDs = []string{ids[0], ids[0]}
		if input.statement() != "" {
			t.Fatal("duplicate ID accepted")
		}
	}
	router := (server{token: "test-token"}).routes()
	for _, probe := range []struct {
		auth, intent string
		want         int
	}{{"", "", 401}, {"Bearer test-token", "", 403}, {"Bearer test-token", "1", 400}} {
		request := httptest.NewRequest("POST", "/api/admin/reports/manage", strings.NewReader(`{"action":"purge","ids":["bad"]}`))
		request.Header.Set("Authorization", probe.auth)
		request.Header.Set("X-SigMark-Admin", probe.intent)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != probe.want {
			t.Fatalf("got %d, want %d", response.Code, probe.want)
		}
	}
}

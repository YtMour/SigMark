package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDeviceAssetGuards(t *testing.T) {
	id := "00000000-0000-4000-8000-000000000001"
	other := "00000000-0000-4000-8000-000000000002"
	if !(deviceAssignment{IDs: []string{id}, Label: "MI 8 / bench"}).valid() ||
		!(deviceAssignment{IDs: []string{id}, AssetID: other}).valid() ||
		!(assetMerge{Source: id, Target: other, Confirmed: true}).valid() {
		t.Fatal("valid device operations were rejected")
	}
	if (deviceAssignment{IDs: []string{id, id}, Label: "QA"}).valid() ||
		(deviceAssignment{IDs: []string{id}, Label: "QA", AssetID: other}).valid() ||
		(assetMerge{Source: id, Target: id, Confirmed: true}).valid() ||
		(assetMerge{Source: id, Target: other}).valid() {
		t.Fatal("invalid device operations were accepted")
	}
	router := (server{token: "test-token"}).routes()
	for _, route := range []string{"/api/admin/device-assets/assign", "/api/admin/device-assets/merge"} {
		for _, tc := range []struct {
			token, mark string
			code        int
		}{
			{"", "", 401}, {"Bearer test-token", "", 403}, {"Bearer test-token", "1", 400},
		} {
			req := httptest.NewRequest("POST", route, strings.NewReader("{}"))
			req.Header.Set("Authorization", tc.token)
			req.Header.Set("X-SigMark-Admin", tc.mark)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != tc.code {
				t.Fatalf("%s: got %d, want %d", route, w.Code, tc.code)
			}
		}
	}
}

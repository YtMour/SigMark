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
	for _, route := range []string{"/api/admin/device-assets/assign", "/api/admin/device-assets/merge", "/api/admin/device-assets/merges/" + id + "/undo"} {
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

func TestMergeGuardsTrackMembershipAndPreviewStatus(t *testing.T) {
	a := assetSnapshot{assetImpact: assetImpact{ID: "a", Reports: 2}, reports: []string{"r1", "r2"}, installs: []string{"i"}}
	b := assetSnapshot{assetImpact: assetImpact{ID: "b"}}
	p := previewDigest(a, b)
	if !validPreview(p) || validPreview("short") || p == previewDigest(b, a) {
		t.Fatal("preview must be a valid directional fingerprint")
	}
	b.trash = []string{"r2"}
	if p == previewDigest(a, b) {
		t.Fatal("trash state must invalidate the displayed preview")
	}
	x := membershipDigest(a.reports, a.installs)
	if x != membershipDigest([]string{"r2", "r1"}, a.installs) || x == membershipDigest([]string{"r2", "r3"}, a.installs) {
		t.Fatal("undo guard must track identities independent of input order")
	}
}

func TestRepositoryReadTokenCannotUseAdminOrMutationRoutes(t *testing.T) {
	router := (server{token: "admin-token", readerToken: "distinct-fixture-read-token"}).routes()
	for _, c := range []struct {
		method, path string
		want         int
	}{
		{"GET", "/field-dictionary", 200},
		{"GET", "/device-assets/merges", 403}, {"GET", "/settings", 403}, {"GET", "/builds", 403},
		{"POST", "/device-assets/merge", 403}, {"POST", "/reports/export", 403},
		{"POST", "/device-assets/merges/00000000-0000-4000-8000-000000000001/undo", 403},
		{"POST", "/login", 401},
	} {
		req := httptest.NewRequest(c.method, "/api/admin"+c.path, strings.NewReader(`{"token":"distinct-fixture-read-token"}`))
		req.Header.Set("Authorization", "Bearer distinct-fixture-read-token")
		req.Header.Set("X-SigMark-Admin", "1")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != c.want {
			t.Errorf("%s %s = %d; want %d", c.method, c.path, w.Code, c.want)
		}
	}
}

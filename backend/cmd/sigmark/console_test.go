package main

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBuildQueueAndPublishedDownload(t *testing.T) {
	base := t.TempDir()
	root, err := os.OpenRoot(base)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	revision := strings.Repeat("1", 40)
	if err := writeJSON(root, "versions.json", []buildVersion{{Name: "Approved", Commit: revision}}); err != nil {
		t.Fatal(err)
	}
	handler := (server{token: "test-token", builds: &buildCenter{
		root: base, catalog: filepath.Join(base, "versions.json"),
	}}).routes()
	call := func(method, path, body string, intent, crossSite bool, code int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if strings.HasPrefix(path, "/api/admin/") {
			r.Header.Set("Authorization", "Bearer test-token")
		}
		if intent {
			r.Header.Set("X-SigMark-Admin", "1")
		}
		if crossSite {
			r.Header.Set("Sec-Fetch-Site", "cross-site")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != code {
			t.Fatalf("%s %s returned %d, want %d (%s)", method, path, w.Code, code, w.Body)
		}
		return w
	}
	const queue = "/api/admin/builds"
	request := `{"commit":"` + revision + `"}`
	call("POST", queue, request, false, false, 403)
	call("POST", queue, request, true, true, 403)
	call("POST", queue, `{"commit":"`+strings.Repeat("2", 40)+`"}`, true, false, 403)
	call("POST", queue, request, true, false, 202)
	call("POST", queue, request, true, false, 409)
	call("GET", "/downloads/sigmark.apk", "", false, false, 404)

	jobs, err := listBuilds(root)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("queue=%+v, err=%v", jobs, err)
	}
	job := jobs[0]
	payload := []byte("test artifact")
	dir := "jobs/" + job.ID
	job.State, job.Size, job.SHA256 = "succeeded", int64(len(payload)), strings.Repeat("0", 64)
	if err := root.WriteFile(dir+"/sigmark.apk", payload, 0644); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(root, dir+"/job.json", job); err != nil {
		t.Fatal(err)
	}
	call("POST", queue+"/"+job.ID+"/publish", "", true, false, 409)
	sum := sha256.Sum256(payload)
	job.SHA256 = hex.EncodeToString(sum[:])
	if err := writeJSON(root, dir+"/job.json", job); err != nil {
		t.Fatal(err)
	}
	call("POST", queue+"/"+job.ID+"/publish", "", true, false, 200)
	if err := writeJSON(root, "worker-heartbeat.json", time.Now()); err != nil {
		t.Fatal(err)
	}
	if index := call("GET", queue, "", false, false, 200).Body.String(); !strings.Contains(index, `"workerOnline":true`) ||
		!strings.Contains(index, `"publishedId":"`+job.ID+`"`) {
		t.Fatal(index)
	}
	call("GET", "/api/downloads/current", "", false, false, 200)
	apk := call("GET", "/downloads/sigmark.apk", "", false, false, 200)
	if apk.Body.String() != string(payload) || apk.Header().Get("Content-Type") != "application/vnd.android.package-archive" {
		t.Fatal("incorrect APK response")
	}
	if call(http.MethodHead, "/downloads/sigmark.apk", "", false, false, 200).Body.Len() != 0 {
		t.Fatal("HEAD sent a body")
	}
}

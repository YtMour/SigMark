package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestV7SecurityFieldsAreBoundedAndVersioned(t *testing.T) {
	p := synthetic()
	p.SchemaVersion = 4
	p.CollectorVersion = "0.18.0"
	p.FieldSetVersion = 7
	value := "sample"
	f := Parameter{Group: "system", Key: "partition_vendor", Source: "Build", Label: "vendor", Value: &value, Status: "AVAILABLE"}
	p.Parameters = []Parameter{f}
	p.Coverage = []Coverage{{Group: "system", Available: 1}}
	if !p.valid() {
		t.Fatal("valid v7 partition rejected")
	}
	p.FieldSetVersion = 6
	if p.valid() {
		t.Fatal("v6 accepted v7 field")
	}
	for _, bad := range []string{"partition_../vendor", "partition_", "partition_" + strings.Repeat("x", 33), "certSha256"} {
		f.Key = bad
		if f.valid(4, 7) {
			t.Fatal("unscoped field:", bad)
		}
	}
}
func TestPublishedSignerHistory(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	a, b := strings.Repeat("1", 32), strings.Repeat("2", 32)
	one, two := strings.Repeat("a", 64), strings.Repeat("b", 64)
	old := buildJob{ID: a, Version: "0.17.0", VersionCode: 19, State: "succeeded", SignerSHA256: one}
	newer := buildJob{ID: b, Version: "0.18.0", VersionCode: 20, State: "succeeded", SignerSHA256: two}
	for _, j := range []buildJob{old, newer} {
		if e := root.MkdirAll("jobs/"+j.ID, 0755); e != nil {
			t.Fatal(e)
		}
		if e := writeJSON(root, "jobs/"+j.ID+"/job.json", j); e != nil {
			t.Fatal(e)
		}
	}
	get := func(v, code, channel, pkg string) map[string]string {
		r := httptest.NewRequest("GET", "/api/admin/release-signer?version="+v+"&code="+code+"&package="+pkg+"&channel="+channel, nil)
		w := httptest.NewRecorder()
		(server{builds: &buildCenter{root: dir}}).releaseSigner(w, r)
		var result map[string]string
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
			t.Fatalf("lookup %d: %v", w.Code, w.Body)
		}
		return result
	}
	if e := writeJSON(root, "current.json", a); e != nil {
		t.Fatal(e)
	}
	if get("0.18.0", "20", "lan-debug", "com.sigmark.app")["state"] != "unregistered" {
		t.Fatal("unpublished job matched")
	}
	if e := retainPublished(root, old); e != nil {
		t.Fatal(e)
	}
	if e := writeJSON(root, "current.json", b); e != nil {
		t.Fatal(e)
	}
	if get("0.17.0", "19", "lan-debug", "com.sigmark.app")["signerSha256"] != one ||
		get("0.18.0", "20", "lan-debug", "com.sigmark.app")["signerSha256"] != two ||
		get("0.17.0", "20", "lan-debug", "com.sigmark.app")["state"] != "unregistered" ||
		get("0.17.0", "19", "release", "com.sigmark.app")["state"] != "unregistered" {
		t.Fatal("incorrect release scope")
	}
}

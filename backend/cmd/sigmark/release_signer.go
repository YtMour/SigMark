package main

import (
	"errors"
	"net/http"
	"os"
	"strconv"
)

// Only the verified current pointer or a previously current release is evidence.
// A successful build which was never published is not a release.
func signerPath(version string, code int64) string {
	return "published-signers/" + version + "-" + strconv.FormatInt(code, 10) + ".json"
}
func retainPublished(root *os.Root, job buildJob) error {
	if !versionPattern.MatchString(job.Version) || job.VersionCode <= 0 || !sha256Pattern.MatchString(job.SignerSHA256) {
		return nil
	}
	if err := root.MkdirAll("published-signers", 0755); err != nil {
		return err
	}
	return writeJSON(root, signerPath(job.Version, job.VersionCode), job.SignerSHA256)
}
func (s server) releaseSigner(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	version := q.Get("version")
	code, err := strconv.ParseInt(q.Get("code"), 10, 32)
	if err != nil || code <= 0 || !versionPattern.MatchString(version) {
		fail(w, 400, "invalid_release")
		return
	}
	// The build worker verifies com.sigmark.app and imports debug artifacts only.
	if q.Get("package") != "com.sigmark.app" || q.Get("channel") != "lan-debug" {
		send(w, 200, map[string]string{"state": "unregistered"})
		return
	}
	root, err := s.builds.open()
	if err != nil {
		fail(w, 503, "build_store_unavailable")
		return
	}
	defer root.Close()
	digest := ""
	id, err := readJSON[string](root, "current.json")
	if err == nil {
		if !buildID.MatchString(id) {
			fail(w, 503, "build_store_unavailable")
			return
		}
		job, e := readJSON[buildJob](root, "jobs/"+id+"/job.json")
		if e != nil || job.ID != id || job.State != "succeeded" {
			fail(w, 503, "build_store_unavailable")
			return
		}
		if job.Version == version && job.VersionCode == code {
			digest = job.SignerSHA256
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		fail(w, 503, "build_store_unavailable")
		return
	}
	if digest == "" {
		digest, err = readJSON[string](root, signerPath(version, code))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			fail(w, 503, "build_store_unavailable")
			return
		}
	}
	if digest == "" {
		send(w, 200, map[string]string{"state": "unregistered"})
		return
	}
	if !sha256Pattern.MatchString(digest) {
		fail(w, 503, "build_store_unavailable")
		return
	}
	send(w, 200, map[string]string{"state": "registered", "signerSha256": digest})
}

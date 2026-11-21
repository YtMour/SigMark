package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
)

type buildCenter struct {
	root, catalog string
	mu            sync.Mutex
}
type buildVersion struct {
	Name           string `json:"name"`
	Commit         string `json:"commit"`
	Profiles       bool   `json:"profiles,omitempty"`
	Version        string `json:"version,omitempty"`
	SnapshotSHA256 string `json:"snapshotSha256,omitempty"`
}
type buildProfile struct {
	Label       string `json:"label,omitempty"`
	Version     string `json:"version,omitempty"`
	VersionCode int64  `json:"versionCode,omitempty"`
	Checks      bool   `json:"checks,omitempty"`
}

func (p buildProfile) valid() bool {
	return textValid(p.Label, 60) && strings.TrimSpace(p.Label) == p.Label &&
		((p.Version == "" && p.VersionCode == 0) || (versionPattern.MatchString(p.Version) && p.VersionCode > 0 && p.VersionCode <= 2_100_000_000))
}

type buildJob struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Commit       string        `json:"commit"`
	State        string        `json:"state"`
	CreatedAt    time.Time     `json:"createdAt"`
	Message      string        `json:"message,omitempty"`
	Version      string        `json:"version,omitempty"`
	VersionCode  int64         `json:"versionCode,omitempty"`
	Origin       string        `json:"origin,omitempty"`
	SHA256       string        `json:"sha256,omitempty"`
	Size         int64         `json:"size,omitempty"`
	Profile      *buildProfile `json:"profile,omitempty"`
	SignerSHA256 string        `json:"signerSha256,omitempty"`
}

var buildID = regexp.MustCompile(`^[a-f0-9]{32}$`)
var commitID = regexp.MustCompile(`^[a-f0-9]{40}$`)
var sha256Pattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

const maxAPK int64 = 128 << 20

func (c *buildCenter) open() (*os.Root, error) {
	if c == nil || c.root == "" {
		return nil, os.ErrNotExist
	}
	return os.OpenRoot(c.root)
}
func readJSON[T any](root *os.Root, path string) (out T, err error) {
	file, err := root.Open(path)
	if err != nil {
		return out, err
	}
	defer file.Close()
	err = decodeStrict(io.LimitReader(file, 128<<10), &out)
	return out, err
}
func writeJSON(root *os.Root, path string, value any) error {
	var nonce [8]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return err
	}
	tmp := path + "." + hex.EncodeToString(nonce[:]) + ".tmp"
	f, err := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	defer root.Remove(tmp)
	err = json.NewEncoder(f).Encode(value)
	if e := f.Close(); err == nil {
		err = e
	}
	if err != nil {
		return err
	}
	return root.Rename(tmp, path)
}
func (c *buildCenter) versions() []buildVersion {
	out := []buildVersion{}
	if c == nil || c.catalog == "" {
		return out
	}
	f, err := os.Open(c.catalog)
	if err != nil {
		return out
	}
	defer f.Close()
	var records []buildVersion
	if decodeStrict(io.LimitReader(f, 64<<10), &records) != nil {
		return out
	}
	seen := map[string]bool{}
	for _, v := range records {
		if v.SnapshotSHA256 != "" && (!sha256Pattern.MatchString(v.SnapshotSHA256) || !strings.HasPrefix(v.SnapshotSHA256, v.Commit)) {
			continue
		}
		if commitID.MatchString(v.Commit) && v.Name != "" && textValid(v.Name, 80) && !seen[v.Commit] {
			out = append(out, v)
			seen[v.Commit] = true
		}
	}
	return out
}
func listBuilds(root *os.Root) ([]buildJob, error) {
	d, err := root.Open("jobs")
	if errors.Is(err, os.ErrNotExist) {
		return []buildJob{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer d.Close()
	entries, err := d.ReadDir(-1)
	if err != nil {
		return nil, err
	}
	jobs := []buildJob{}
	for _, e := range entries {
		if !e.IsDir() || !buildID.MatchString(e.Name()) {
			continue
		}
		job, err := readJSON[buildJob](root, "jobs/"+e.Name()+"/job.json")
		if err == nil && job.ID == e.Name() {
			jobs = append(jobs, job)
		}
	}
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].CreatedAt.After(jobs[j].CreatedAt) })
	return jobs, nil
}
func (s server) buildIndex(w http.ResponseWriter, r *http.Request) {
	root, err := s.builds.open()
	if errors.Is(err, os.ErrNotExist) {
		send(w, 200, map[string]any{"versions": []buildVersion{}, "jobs": []buildJob{}, "workerOnline": false})
		return
	}
	if err != nil {
		fail(w, 503, "build_store_unavailable")
		return
	}
	defer root.Close()
	jobs, err := listBuilds(root)
	if err != nil {
		fail(w, 503, "build_store_unavailable")
		return
	}
	publishedID, _ := readJSON[string](root, "current.json")
	heartbeat, _ := readJSON[time.Time](root, "worker-heartbeat.json")
	age := time.Since(heartbeat)
	send(w, 200, map[string]any{
		"versions": s.builds.versions(), "jobs": jobs, "publishedId": publishedID,
		"workerOnline": age > -5*time.Second && age < 15*time.Second,
	})
}
func (s server) requestBuild(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Commit  string        `json:"commit"`
		Profile *buildProfile `json:"profile"`
	}
	if decodeStrict(http.MaxBytesReader(w, r.Body, 1024), &req) != nil || !commitID.MatchString(req.Commit) {
		fail(w, 400, "invalid_version")
		return
	}
	var chosen buildVersion
	for _, v := range s.builds.versions() {
		if v.Commit == req.Commit {
			chosen = v
			break
		}
	}
	if chosen.Commit == "" {
		fail(w, 403, "version_not_approved")
		return
	}
	if req.Profile != nil && (!req.Profile.valid() || (req.Profile.Version != "" && !chosen.Profiles)) {
		fail(w, 400, "invalid_build_profile")
		return
	}
	root, err := s.builds.open()
	if err != nil {
		fail(w, 503, "build_store_unavailable")
		return
	}
	defer root.Close()
	s.builds.mu.Lock()
	defer s.builds.mu.Unlock()
	jobs, err := listBuilds(root)
	if err != nil {
		fail(w, 503, "build_store_unavailable")
		return
	}
	for _, job := range jobs {
		if job.State == "queued" || job.State == "running" {
			fail(w, 409, "build_already_queued")
			return
		}
	}
	var rid [16]byte
	if _, err := rand.Read(rid[:]); err != nil {
		fail(w, 503, "build_store_unavailable")
		return
	}
	job := buildJob{ID: hex.EncodeToString(rid[:]), Commit: chosen.Commit, Name: chosen.Name, State: "queued", CreatedAt: time.Now().UTC(), Profile: req.Profile}
	dir := "jobs/" + job.ID
	if root.MkdirAll(dir, 0755) != nil || writeJSON(root, dir+"/job.json", job) != nil {
		fail(w, 503, "build_store_unavailable")
		return
	}
	send(w, 202, job)
}
func openAPK(root *os.Root, id string) (*os.File, buildJob, error) {
	if !buildID.MatchString(id) {
		return nil, buildJob{}, os.ErrNotExist
	}
	dir := "jobs/" + id
	job, err := readJSON[buildJob](root, dir+"/job.json")
	if err != nil || job.ID != id || job.State != "succeeded" || job.Size < 1 || job.Size > maxAPK || len(job.SHA256) != 64 {
		return nil, job, os.ErrNotExist
	}
	f, err := root.Open(dir + "/sigmark.apk")
	if err != nil {
		return nil, job, err
	}
	file, err := f.Stat()
	if err != nil || !file.Mode().IsRegular() || file.Size() != job.Size {
		f.Close()
		return nil, job, os.ErrNotExist
	}
	return f, job, nil
}
func (s server) publishBuild(w http.ResponseWriter, r *http.Request) {
	root, err := s.builds.open()
	if err != nil {
		fail(w, 503, "build_store_unavailable")
		return
	}
	defer root.Close()
	s.builds.mu.Lock()
	defer s.builds.mu.Unlock()
	id := chi.URLParam(r, "id")
	f, job, err := openAPK(root, id)
	if err != nil {
		fail(w, 404, "artifact_not_found")
		return
	}
	defer f.Close()
	if currentID, e := readJSON[string](root, "current.json"); e == nil && currentID != id {
		if old, e := readJSON[buildJob](root, "jobs/"+currentID+"/job.json"); e == nil {
			if old.VersionCode > 0 && job.VersionCode <= old.VersionCode {
				fail(w, 409, "publish_version_not_newer")
				return
			}
			if old.SignerSHA256 != "" && old.SignerSHA256 != job.SignerSHA256 {
				fail(w, 409, "publish_signer_changed")
				return
			}
			if retainPublished(root, old) != nil {
				fail(w, 503, "build_store_unavailable")
				return
			}
		}
	}
	sum := sha256.New()
	if _, e := io.Copy(sum, io.LimitReader(f, maxAPK+1)); e != nil || hex.EncodeToString(sum.Sum(nil)) != job.SHA256 {
		fail(w, 409, "artifact_checksum_mismatch")
		return
	}
	if writeJSON(root, "current.json", id) != nil {
		fail(w, 503, "build_store_unavailable")
		return
	}
	send(w, 200, job)
}
func (s server) currentAPK() (*os.File, buildJob, error) {
	root, err := s.builds.open()
	if err != nil {
		return nil, buildJob{}, err
	}
	defer root.Close()
	id, err := readJSON[string](root, "current.json")
	if err != nil {
		return nil, buildJob{}, err
	}
	return openAPK(root, id)
}
func (s server) downloadInfo(w http.ResponseWriter, r *http.Request) {
	f, job, err := s.currentAPK()
	if err != nil {
		fail(w, 404, "no_published_apk")
		return
	}
	f.Close()
	send(w, 200, map[string]any{"version": job.Version, "versionCode": job.VersionCode, "size": job.Size, "sha256": job.SHA256, "origin": job.Origin, "signerSha256": job.SignerSHA256})
}
func (s server) downloadAPK(w http.ResponseWriter, r *http.Request) {
	f, job, err := s.currentAPK()
	if err != nil {
		fail(w, 404, "no_published_apk")
		return
	}
	defer f.Close()
	if expected := r.URL.Query().Get("sha256"); expected != "" && expected != job.SHA256 {
		fail(w, 409, "release_changed")
		return
	}
	serveAPK(w, r, f, job)
}

func (s server) downloadBuild(w http.ResponseWriter, r *http.Request) {
	root, err := s.builds.open()
	if err != nil {
		fail(w, 404, "artifact_not_found")
		return
	}
	defer root.Close()
	f, job, err := openAPK(root, chi.URLParam(r, "id"))
	if err != nil {
		fail(w, 404, "artifact_not_found")
		return
	}
	defer f.Close()
	serveAPK(w, r, f, job)
}

func serveAPK(w http.ResponseWriter, r *http.Request, f *os.File, job buildJob) {
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(3 * time.Minute))
	w.Header().Set("Content-Type", "application/vnd.android.package-archive")
	w.Header().Set("Content-Disposition", `attachment; filename="SigMark-LAN.apk"`)
	w.Header().Set("ETag", `"`+job.SHA256+`"`)
	http.ServeContent(w, r, "SigMark-LAN.apk", job.CreatedAt, f)
}

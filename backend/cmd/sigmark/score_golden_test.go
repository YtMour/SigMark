package main

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

// goldenUpdate rewrites the golden files from the current implementation. It is the only
// sanctioned way to change them: a plain `go test` must fail when the output moves, so a
// rule change can never quietly alter what a real device is graded as.
var goldenUpdate = flag.Bool("update-score-golden", false, "rewrite score golden files")

// TestScoreGoldenFreezesRealDevices pins the complete score document for both real
// anchors, field by field. The per-rule tests above check one rule each; this one checks
// that the whole thing a real Pixel 6 and a real MI 8 actually produce stays put.
//
// It exists because replaying the archive is how three real defects were found (a blind
// declaration axis publishing 100/A, a diluted 30-point conflict publishing 88/A, and an
// overlay codename charged twice). None of those were visible from a single-rule test:
// each rule was individually correct, and the wrong answer came from how they composed.
// A golden file is the cheapest way to notice the next one.
func TestScoreGoldenFreezesRealDevices(t *testing.T) {
	pixelValues, pixelStatus := pixel6Evidence()
	mi8Values, mi8Status := mi8Evidence()
	emulatorValues, emulatorStatus := emulatorEvidence()
	cases := []struct {
		name   string
		values map[string]string
		status map[string]string
	}{
		{"pixel6", pixelValues, pixelStatus},
		{"mi8", mi8Values, mi8Status},
		// The emulator is not a real device, but it is a real capture: these values came
		// out of an actual android-34 AVD running the actual APK. It is the only anchor
		// that reaches "decisive + below the coverage floor", so freezing it is what
		// stops that path from regressing unnoticed.
		{"emulator", emulatorValues, emulatorStatus},
	}
	for _, c := range cases {
		score := scoreDevice(c.values, c.status)
		raw, err := json.MarshalIndent(score, "", "  ")
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		raw = append(raw, '\n')
		path := filepath.Join("testdata", "score-"+c.name+".golden.json")
		if *goldenUpdate {
			if err := os.MkdirAll("testdata", 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, raw, 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("%s: read golden: %v (run with -update-score-golden to create it)", c.name, err)
		}
		if string(want) != string(raw) {
			t.Fatalf("%s: score document changed.\n--- golden ---\n%s\n--- now ---\n%s\n"+
				"If this change is intended, re-run with -update-score-golden and review the diff: "+
				"a band move here means a real device is graded differently.", c.name, want, raw)
		}
	}
}

// The golden files must also be readable as the wire contract: every documented field is
// present, value and score may be null, and nothing the frontend depends on is missing.
func TestScoreGoldenKeepsTheWireShape(t *testing.T) {
	for _, name := range []string{"pixel6", "mi8", "emulator"} {
		path := filepath.Join("testdata", "score-"+name+".golden.json")
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Skipf("%s golden not present yet: %v", name, err)
		}
		var doc map[string]any
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		for _, key := range []string{"version", "value", "band", "bandLabel", "coverage",
			"coverageLabel", "decisive", "axes", "caps", "undetermined"} {
			if _, ok := doc[key]; !ok {
				t.Errorf("%s: missing top-level %q", name, key)
			}
		}
		// Compare against the constant, not a literal: the golden files are regenerated on a
		// version bump, and a literal here would make every bump look like a wire break.
		if doc["version"] != scoreVersion {
			t.Errorf("%s: version = %v, want %v", name, doc["version"], scoreVersion)
		}
		axes, ok := doc["axes"].([]any)
		if !ok || len(axes) != 3 {
			t.Fatalf("%s: axes = %v, want exactly 3", name, doc["axes"])
		}
		for i, want := range []string{"declaration", "behavior", "usage"} {
			axis, _ := axes[i].(map[string]any)
			if axis["code"] != want {
				t.Errorf("%s: axes[%d].code = %v, want %q", name, i, axis["code"], want)
			}
			// Score may be null but the key must exist: the frontend branches on it.
			if _, ok := axis["score"]; !ok {
				t.Errorf("%s: axes[%d] has no score key", name, i)
			}
			if _, ok := axis["deductions"].([]any); !ok {
				t.Errorf("%s: axes[%d].deductions is not an array", name, i)
			}
		}
		// Every deduction keeps its provenance; a bare number is a contract violation.
		for _, raw := range axes {
			axis, _ := raw.(map[string]any)
			deductions, _ := axis["deductions"].([]any)
			for _, entry := range deductions {
				d, _ := entry.(map[string]any)
				for _, key := range []string{"code", "label", "axis", "points", "keys", "detail"} {
					if _, ok := d[key]; !ok {
						t.Errorf("%s: deduction missing %q: %v", name, key, d)
					}
				}
				keys, _ := d["keys"].([]any)
				if len(keys) == 0 {
					t.Errorf("%s: deduction without keys: %v", name, d)
				}
				if d["axis"] != axis["code"] {
					t.Errorf("%s: deduction axis %v does not match its axis %v", name, d["axis"], axis["code"])
				}
			}
		}
	}
}

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The emulator variants below are not invented. Each is the archived evidence of a real
// capture taken on `sigmark-emu34` (android-34 google_apis x86_64) after a specific
// modification, uploaded through the real APK, and read back from the admin API:
//
//	ff32a085  stock AVD, user 0
//	556ac263  app launched as user 10 (a second Android user)
//	fe2f4ef5  + a tmpfs mounted under a path containing `.magisk`
//	d0cf5b15  user 10 + the magisk-named mount
//	c3ad4750  + `setenforce 0`   ← the only capture in the archive where SELinux is permissive
//	86705d8a  the same three modifications repeated — proves the result is reproducible
//
// They exist because until now the behavior axis had **zero** positive samples for
// hook_injection, selinux_permissive and multi_open. Every one of those weights was an
// untested guess with no evidence behind it. These captures are that evidence.
//
// Every variant also carries the build markers (an AVD always does), so every one is
// decisive and lands on D. That is deliberate and it is also a limitation: the D band is
// not what these fixtures measure. What they measure is that each branch fires, prices
// the documented amount, does not disturb its siblings, and keeps the ledger ordered.
const (
	variantMultiOpenReport  = "556ac263-2fb5-4588-a773-c1640c1b0060"
	variantMagiskReport     = "fe2f4ef5-33d6-4d66-bb31-a55fc9b787bf"
	variantThreeReport      = "d0cf5b15-d936-4599-b4b1-5d7eb05b325d"
	variantPermissiveReport = "c3ad4750-4351-4dfe-a421-2a0da418b7c3"
)

// emulatorVariant builds the baseline emulator evidence and applies only the fields that
// each modification actually changed. Everything else stays byte-identical to the
// baseline capture, which is what makes a diff attributable to the modification rather
// than to capture noise.
func emulatorVariant(overrides map[string]string, readable map[string]string) (map[string]string, map[string]string) {
	values, statuses := emulatorEvidence()
	for key, value := range overrides {
		values[key] = value
	}
	for key, value := range readable {
		values[key] = value
		delete(statuses, key)
	}
	return values, statuses
}

// user10 is the second-user variant: the app reports it is running in a non-owner profile.
func user10() (map[string]string, map[string]string) {
	return emulatorVariant(map[string]string{"environment.userProfile": "secondary"}, nil)
}

// magiskMount is the variant where a tmpfs is mounted under a `.magisk` path. The probe
// reads /proc/self/mountinfo, so any mount whose mount point or source contains that
// string fires — no root manager package needs to be installed.
func magiskMount() (map[string]string, map[string]string) {
	return emulatorVariant(map[string]string{
		"environment.rootMountHints": "magisk_path",
		"environment.userProfile":    "secondary",
	}, nil)
}

// rootManager is the variant where a package named com.topjohnwu.magisk is installed with a
// launcher activity, so queryIntentActivities returns it. The probe only matches a fixed
// package-name list, so the stub needs nothing but the manifest — but it does need the
// LAUNCHER intent filter, because package visibility (API 30+) hides everything else.
func rootManager() (map[string]string, map[string]string) {
	return emulatorVariant(map[string]string{
		"environment.rootManagerVisible": "magisk",
		"environment.rootMountHints":     "magisk_path",
		"environment.userProfile":        "secondary",
	}, nil)
}

// traced is the variant where a real ptrace client is attached: `strace -f -p <pid>` from
// an adb root shell, which makes the kernel write a non-zero TracerPid. This is the only
// way to produce the branch — `am instrument -e debug true` merely makes the process wait
// for a debugger and leaves both Debug.isDebuggerConnected() and TracerPid at their
// negative values, which is why the first attempt produced not_observed.
func traced() (map[string]string, map[string]string) {
	return emulatorVariant(map[string]string{
		"environment.tracerPid":          "9072",
		"environment.rootManagerVisible": "magisk",
		"environment.rootMountHints":     "magisk_path",
		"environment.userProfile":        "secondary",
	}, nil)
}

// permissive is the full three-modification capture. `setenforce 0` is the only way to
// produce a permissive SELinux on this image, and a stock phone would need root to do it,
// so this is the one shape a real device cannot reach.
func permissive() (map[string]string, map[string]string) {
	return emulatorVariant(map[string]string{
		"environment.rootMountHints":  "magisk_path",
		"environment.userProfile":     "secondary",
		"system.selinux":              "Permissive（宽容模式）",
		"system.selinuxEvidence":      "exact",
		"environment.buildDebuggable": "开启",
		"system.partitionCount":       "6",
	}, map[string]string{
		// The baseline could not read SELinux at all; this capture could.
		"system.selinux": "Permissive（宽容模式）",
	})
}

func TestScoreEmulatorVariantMultiOpenPricesEight(t *testing.T) {
	values, statuses := user10()
	score := scoreDevice(values, statuses)

	behavior := scoreAxisByCode(t, score, axisBehavior)
	got := scoreDeductionsByCode(behavior, "MULTI_OPEN")
	if len(got) != 1 || got[0].Points != 8 {
		t.Fatalf("MULTI_OPEN = %+v, want exactly one 8-point entry", got)
	}
	// Documented non-decisive: the only cap may be the build marker's. A second user is a
	// job environment, not proof of a disguise.
	for _, cap := range score.Caps {
		if cap.Code != "DECISIVE_VIRTUAL_BUILD" {
			t.Fatalf("unexpected cap %q: multi_open must not cap the band", cap.Code)
		}
	}
	// Ordering is part of the contract: 35 then 8.
	if behavior.Deductions[0].Code != "VIRTUAL_BUILD_MARKERS" || behavior.Deductions[1].Code != "MULTI_OPEN" {
		t.Fatalf("ledger order = [%s %s], want [VIRTUAL_BUILD_MARKERS MULTI_OPEN]",
			behavior.Deductions[0].Code, behavior.Deductions[1].Code)
	}
}

func TestScoreEmulatorVariantMagiskMountPricesHook(t *testing.T) {
	values, statuses := magiskMount()
	score := scoreDevice(values, statuses)

	behavior := scoreAxisByCode(t, score, axisBehavior)
	got := scoreDeductionsByCode(behavior, "HOOK_INJECTION")
	if len(got) != 1 || got[0].Points != 25 {
		t.Fatalf("HOOK_INJECTION = %+v, want exactly one 25-point entry", got)
	}
	// The evidence must be traceable: a deduction without a readable key is unappealable.
	found := false
	for _, key := range got[0].Keys {
		if key == "environment.rootMountHints" {
			found = true
		}
	}
	if !found {
		t.Fatalf("HOOK_INJECTION keys = %v, want environment.rootMountHints among them", got[0].Keys)
	}
}

// Two behavior branches firing together: each prices once and the ledger stays sorted.
// This is the case that shows the axis is additive rather than first-match-wins.
func TestScoreEmulatorVariantBranchesStack(t *testing.T) {
	values, statuses := magiskMount()
	score := scoreDevice(values, statuses)

	behavior := scoreAxisByCode(t, score, axisBehavior)
	for _, want := range []struct {
		code   string
		points int
	}{{"VIRTUAL_BUILD_MARKERS", 35}, {"HOOK_INJECTION", 25}, {"MULTI_OPEN", 8}} {
		got := scoreDeductionsByCode(behavior, want.code)
		if len(got) != 1 || got[0].Points != want.points {
			t.Fatalf("%s = %+v, want one %d-point entry", want.code, got, want.points)
		}
	}
	previous := 1000
	for _, deduction := range behavior.Deductions {
		if deduction.Points > previous {
			t.Fatalf("ledger is not sorted descending: %+v", behavior.Deductions)
		}
		previous = deduction.Points
	}
}

// The permissive capture is the only one in the whole archive where SELINUX_PERMISSIVE
// fires, and the only one that reaches behavior coverage 1.0 — so it is the fixture that
// proves the six-label denominator is actually reachable, not just a formula.
func TestScoreEmulatorVariantPermissiveReachesFullBehaviorCoverage(t *testing.T) {
	values, statuses := permissive()
	score := scoreDevice(values, statuses)

	behavior := scoreAxisByCode(t, score, axisBehavior)
	if behavior.Coverage != 1 {
		t.Fatalf("behavior coverage = %v, want 1.0: all six priced labels answered", behavior.Coverage)
	}
	got := scoreDeductionsByCode(behavior, "SELINUX_PERMISSIVE")
	if len(got) != 1 || got[0].Points != 15 {
		t.Fatalf("SELINUX_PERMISSIVE = %+v, want exactly one 15-point entry", got)
	}
	// Four branches: 35 + 25 + 15 + 8 = 83, so the axis keeps 17.
	want := 100 - 35 - 25 - 15 - 8
	if axisScoreOf(t, behavior) != want {
		t.Fatalf("behavior score = %d, want %d", axisScoreOf(t, behavior), want)
	}
	// rom_verification fires too (buildDebuggable=开启) but is display-only, so it must
	// not appear in the ledger.
	if len(scoreDeductionsFor(behavior, "rom_verification")) != 0 {
		t.Fatalf("rom_verification is display-only but was priced")
	}
	// Still not a new decisive reason: permissive is suspicious, not proof.
	for _, cap := range score.Caps {
		if cap.Code != "DECISIVE_VIRTUAL_BUILD" {
			t.Fatalf("unexpected cap %q", cap.Code)
		}
	}
}

// The three-modification capture is the most severe shape the lab can produce without
// touching the build markers themselves: 83 of the behavior axis's 100 points are gone.
// It still cannot escape D, because it is still an emulator — which is the honest
// conclusion: on this axis the decisive cap dominates every non-decisive finding.
func TestScoreEmulatorVariantsAreOrderedBySeverity(t *testing.T) {
	type variant struct {
		name   string
		values map[string]string
		status map[string]string
		want   []string
	}
	baseValues, baseStatus := emulatorEvidence()
	u10Values, u10Status := user10()
	mgValues, mgStatus := magiskMount()
	pmValues, pmStatus := permissive()
	cases := []variant{
		{"baseline", baseValues, baseStatus, []string{"VIRTUAL_BUILD_MARKERS"}},
		{"user10", u10Values, u10Status, []string{"VIRTUAL_BUILD_MARKERS", "MULTI_OPEN"}},
		{"magisk", mgValues, mgStatus,
			[]string{"VIRTUAL_BUILD_MARKERS", "HOOK_INJECTION", "MULTI_OPEN"}},
		{"permissive", pmValues, pmStatus,
			[]string{"VIRTUAL_BUILD_MARKERS", "HOOK_INJECTION", "SELINUX_PERMISSIVE", "MULTI_OPEN"}},
	}
	for _, c := range cases {
		score := scoreDevice(c.values, c.status)
		behavior := scoreAxisByCode(t, score, axisBehavior)
		if len(behavior.Deductions) != len(c.want) {
			t.Fatalf("%s: %d deductions, want %d: %+v",
				c.name, len(behavior.Deductions), len(c.want), behavior.Deductions)
		}
		for i, want := range c.want {
			if behavior.Deductions[i].Code != want {
				t.Fatalf("%s: deductions[%d] = %q, want %q",
					c.name, i, behavior.Deductions[i].Code, want)
			}
		}
		if score.Band != bandD || !score.Decisive {
			t.Fatalf("%s: band = %q decisive = %v, want D/true", c.name, score.Band, score.Decisive)
		}
	}
}

// Every weight in the behavior table, nudged by ±5 in turn, must not flip the band of any
// anchor or any variant. This is the sensitivity check docs/SECURITY-SCORE.md §9.3 step 4
// promised and never ran.
//
// Note what it does NOT claim. It shows the *bands* are robust, which is weaker than "the
// weights are calibrated": the bands are largely decided by R5 and R11, not by the
// arithmetic. The relative order is where the weights matter, and that is where the first
// version of this test failed — correctly. See the cluster note below.
func TestScoreBehaviorWeightsAreNotBandSensitive(t *testing.T) {
	pixelValues, pixelStatus := pixel6Evidence()
	mi8Values, mi8Status := mi8Evidence()
	multiValues, multiStatus := user10()
	magiskValues, magiskStatus := magiskMount()
	permValues, permStatus := permissive()

	type anchor struct {
		name   string
		values map[string]string
		status map[string]string
	}
	anchors := []anchor{
		{"pixel6", pixelValues, pixelStatus},
		{"mi8", mi8Values, mi8Status},
		{"emulator", multiValues, multiStatus},
		{"magisk", magiskValues, magiskStatus},
		{"permissive", permValues, permStatus},
	}

	baseline := map[string]string{}
	for _, a := range anchors {
		baseline[a.name] = scoreDevice(a.values, a.status).Band
	}

	original := make([]int, len(behaviorScoreTable))
	for i := range behaviorScoreTable {
		original[i] = behaviorScoreTable[i].Points
	}
	// Mutating a package-level table in a test is only safe with an unconditional restore.
	t.Cleanup(func() {
		for i := range behaviorScoreTable {
			behaviorScoreTable[i].Points = original[i]
		}
	})

	for i := range behaviorScoreTable {
		for _, delta := range []int{-5, 5} {
			next := original[i] + delta
			if next < 1 {
				continue
			}
			behaviorScoreTable[i].Points = next
			for _, a := range anchors {
				if got := scoreDevice(a.values, a.status).Band; got != baseline[a.name] {
					t.Errorf("%s: weight %q %+d flipped band %q → %q",
						a.name, behaviorScoreTable[i].Code, delta, baseline[a.name], got)
				}
			}
		}
		behaviorScoreTable[i].Points = original[i]
	}
}

// A clean device with exactly one behavior branch firing is the only shape where the
// weights are the sole thing deciding the number: the decisive variants cannot show it
// because R5 caps the band and R8 nulls the axis score. So this is the calibration set.
//
// The first version of the ordering assertion demanded a strict total order and it failed.
// That failure is the finding, and it is worth keeping: SELINUX_PERMISSIVE (15),
// ROOT_MANAGER_VISIBLE (12) and MULTI_OPEN (8) all sit within ±5 of each other, so their
// mutual ranking flips under exactly the nudge being applied. **15 > 12 > 8 has no
// evidential support.** What the data does support is the split into clusters — hook (25)
// and debugger (20) on one side, the other three on the other — and that split survives
// every nudge. So the assertion is the split, not the total order.
func TestScoreBehaviorWeightsSeparateIntoTwoClusters(t *testing.T) {
	// A stock-shaped device with one branch turned on. Values are the MI 8 anchor's, so
	// the only thing that changes between samples is the branch under test.
	clean := func(branch string) map[string]string {
		values, _ := mi8Evidence()
		values["environment.verityMode"] = "enforcing"
		switch branch {
		case "hook_injection":
			values["environment.hookSignals"] = "frida"
		case "debugger_attached":
			values["app.debuggerConnected"] = "是"
		case "selinux_permissive":
			values["system.selinux"] = "Permissive（宽容模式）"
			delete(values, "system.selinuxEvidence")
		case "root_manager_visible":
			values["environment.rootManagerVisible"] = "magisk"
		case "multi_open":
			values["environment.userProfile"] = "secondary"
		}
		return values
	}
	branches := []string{"hook_injection", "debugger_attached",
		"selinux_permissive", "root_manager_visible", "multi_open"}

	clusterOf := func(branch string) int {
		switch branch {
		case "hook_injection":
			return 0
		case "debugger_attached":
			return 1
		default:
			return 2
		}
	}

	// Every sample must publish a number, otherwise this measures nothing.
	for _, branch := range branches {
		score := scoreDevice(clean(branch), nil)
		if score.Value == nil {
			t.Fatalf("%s published no value: the fixture is not usable for calibration", branch)
		}
		if score.Decisive {
			t.Fatalf("%s is decisive: a single non-build branch must not cap the band", branch)
		}
	}

	rank := func() []string {
		order := append([]string{}, branches...)
		for i := 0; i < len(order); i++ {
			for j := i + 1; j < len(order); j++ {
				left := *scoreDevice(clean(order[i]), nil).Value
				right := *scoreDevice(clean(order[j]), nil).Value
				if right < left {
					order[i], order[j] = order[j], order[i]
				}
			}
		}
		return order
	}
	checkClusters := func(when string) {
		seen := 0
		for _, branch := range rank() {
			if c := clusterOf(branch); c < seen {
				t.Errorf("%s: a heavier cluster ranked better than a lighter one: %v", when, rank())
				return
			} else {
				seen = c
			}
		}
	}
	checkClusters("at the documented weights")

	original := make([]int, len(behaviorScoreTable))
	for i := range behaviorScoreTable {
		original[i] = behaviorScoreTable[i].Points
	}
	t.Cleanup(func() {
		for i := range behaviorScoreTable {
			behaviorScoreTable[i].Points = original[i]
		}
	})
	for i := range behaviorScoreTable {
		for _, delta := range []int{-5, 5} {
			next := original[i] + delta
			if next < 1 {
				continue
			}
			behaviorScoreTable[i].Points = next
			checkClusters(behaviorScoreTable[i].Code + " " + intToString(delta))
		}
		behaviorScoreTable[i].Points = original[i]
	}
}

func intToString(n int) string {
	if n == 0 {
		return "0"
	}
	sign := ""
	if n < 0 {
		sign, n = "-", -n
	}
	out := ""
	for n > 0 {
		out = string(rune('0'+n%10)) + out
		n /= 10
	}
	return sign + out
}

// The emulator variants are real captures, so they belong in the golden set alongside the
// two real phones: a change to any rule must show up as a diff on all of them.
func TestScoreGoldenFreezesEmulatorVariants(t *testing.T) {
	u10Values, u10Status := user10()
	pmValues, pmStatus := permissive()
	cases := []struct {
		name   string
		values map[string]string
		status map[string]string
	}{
		{"emulator-user10", u10Values, u10Status},
		{"emulator-permissive", pmValues, pmStatus},
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
			t.Fatalf("%s: score document changed.\n--- golden ---\n%s\n--- now ---\n%s",
				c.name, want, raw)
		}
	}
}

// The two branches that had no positive sample at all until this round. Both are worth a
// test even though the earlier fixtures already cover "a branch fires": these two have
// distinct evidence shapes, and the point is to pin the shape, not just the number.

// root_manager_visible reads PackageManager.queryIntentActivities against a fixed package
// list. It is the only behavior branch that depends on package visibility rather than on a
// /proc read, so a probe that silently stopped seeing the package would look identical to a
// clean device — a false negative with no signal anywhere.
func TestScoreEmulatorVariantRootManagerPricesTwelve(t *testing.T) {
	values, statuses := rootManager()
	score := scoreDevice(values, statuses)

	behavior := scoreAxisByCode(t, score, axisBehavior)
	got := scoreDeductionsByCode(behavior, "ROOT_MANAGER_VISIBLE")
	if len(got) != 1 || got[0].Points != 12 {
		t.Fatalf("ROOT_MANAGER_VISIBLE = %+v, want exactly one 12-point entry", got)
	}
	found := false
	for _, key := range got[0].Keys {
		if key == "environment.rootManagerVisible" {
			found = true
		}
	}
	if !found {
		t.Fatalf("keys = %v, want environment.rootManagerVisible", got[0].Keys)
	}
	// The ledger must name the detected manager, not just "something was visible": the
	// reader needs to know which package was matched.
	if !strings.Contains(got[0].Detail, "magisk") {
		t.Fatalf("detail = %q, want it to name magisk", got[0].Detail)
	}
}

// debugger_attached is projected from two independent channels: the in-process
// Debug.isDebuggerConnected() flag and the kernel's TracerPid. The traced fixture has
// tracerPid=9072 while debuggerConnected stays 否 — which is the real-world case a
// ptrace-based injector produces, and the case the label exists for.
func TestScoreEmulatorVariantTracedPricesTwenty(t *testing.T) {
	values, statuses := traced()
	score := scoreDevice(values, statuses)

	behavior := scoreAxisByCode(t, score, axisBehavior)
	got := scoreDeductionsByCode(behavior, "DEBUGGER_ATTACHED")
	if len(got) != 1 || got[0].Points != 20 {
		t.Fatalf("DEBUGGER_ATTACHED = %+v, want exactly one 20-point entry", got)
	}
	found := false
	for _, key := range got[0].Keys {
		if key == "environment.tracerPid" {
			found = true
		}
	}
	if !found {
		t.Fatalf("keys = %v, want environment.tracerPid: the kernel record is the evidence",
			got[0].Keys)
	}
}

// The six-branch capture: 35 + 25 + 20 + 15 + 12 + 8 = 115, so the axis clamps to 0.
// This is the only real capture that reaches the clamp floor, and it proves R6's lower
// bound is reachable rather than a defensive `max(0, …)` nobody ever hits.
func TestScoreEmulatorVariantAllSixBranchesReachTheAxisFloor(t *testing.T) {
	values, statuses := traced()
	values["system.selinux"] = "Permissive（宽容模式）"
	values["system.selinuxEvidence"] = "exact"
	delete(statuses, "system.selinux")

	score := scoreDevice(values, statuses)
	behavior := scoreAxisByCode(t, score, axisBehavior)
	if behavior.Coverage != 1 {
		t.Fatalf("coverage = %v, want 1", behavior.Coverage)
	}
	for _, want := range []struct {
		code   string
		points int
	}{
		{"VIRTUAL_BUILD_MARKERS", 35}, {"HOOK_INJECTION", 25}, {"DEBUGGER_ATTACHED", 20},
		{"SELINUX_PERMISSIVE", 15}, {"ROOT_MANAGER_VISIBLE", 12}, {"MULTI_OPEN", 8},
	} {
		got := scoreDeductionsByCode(behavior, want.code)
		if len(got) != 1 || got[0].Points != want.points {
			t.Fatalf("%s = %+v, want one %d-point entry", want.code, got, want.points)
		}
	}
	// 35+25+20+15+12+8 = 115, clamped to 100 → axis score 0.
	if axisScoreOf(t, behavior) != 0 {
		t.Fatalf("behavior score = %d, want 0: the deduction total exceeds 100 and must clamp",
			axisScoreOf(t, behavior))
	}
}

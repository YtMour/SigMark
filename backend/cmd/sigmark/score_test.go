package main

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
)

// scoreFixture builds a parameter list from an available-value map plus a status map
// for keys that were rejected or never collected. Every key is a real group.key.
func scoreFixture(values map[string]string, statuses map[string]string) []Parameter {
	out := make([]Parameter, 0, len(values)+len(statuses))
	for key, value := range values {
		group, name, _ := strings.Cut(key, ".")
		out = append(out, profileField(group, name, value))
	}
	for key, status := range statuses {
		group, name, _ := strings.Cut(key, ".")
		out = append(out, Parameter{Group: group, Key: name, Source: "fixture", Status: status})
	}
	return out
}

func scoreDevice(values map[string]string, statuses map[string]string) deviceScore {
	parameters := scoreFixture(values, statuses)
	return buildDeviceScore(parameters, profileSignals(parameters), 0)
}

func scoreAxisByCode(t *testing.T, score deviceScore, code string) scoreAxis {
	t.Helper()
	for _, axis := range score.Axes {
		if axis.Code == code {
			return axis
		}
	}
	t.Fatalf("axis %q not found in %d axes", code, len(score.Axes))
	return scoreAxis{}
}

func scoreDeductionsFor(axis scoreAxis, label string) []scoreDeduction {
	out := []scoreDeduction{}
	for _, deduction := range axis.Deductions {
		if deduction.Label == label {
			out = append(out, deduction)
		}
	}
	return out
}

// scoreDeductionsByCode looks a deduction up by its branch code. Several branches share
// one label — FOREIGN_PROFILE, HARDWARE_CHANNEL_CONFLICT and OVERLAY_CODENAME_MISMATCH
// are all channels of hardware_declaration_conflict — so the code, not the label, is
// what identifies a branch.
func scoreDeductionsByCode(axis scoreAxis, code string) []scoreDeduction {
	out := []scoreDeduction{}
	for _, deduction := range axis.Deductions {
		if deduction.Code == code {
			out = append(out, deduction)
		}
	}
	return out
}

func scoreUndeterminedForAxis(score deviceScore, axis string) []scoreUndetermined {
	out := []scoreUndetermined{}
	for _, gap := range score.Undetermined {
		if gap.Axis == axis {
			out = append(out, gap)
		}
	}
	return out
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// axisScoreOf reads the axis arithmetic, whether or not the report published it.
// Publication itself is checked separately (an unscored report must emit null).
func axisScoreOf(t *testing.T, axis scoreAxis) int {
	t.Helper()
	if axis.Score != nil {
		return *axis.Score
	}
	return axis.computed
}

// recomputeValue applies the published formula to the axes that printed a score: the
// weighted mean over exactly those axes. It is the check a reviewer performs by hand from
// the JSON (§8.1), encoded once so that a document which cannot be recomputed fails a test
// rather than a human. An axis that is excluded from the average and still prints a score
// is the failure mode this catches.
func recomputeValue(t *testing.T, score deviceScore) int {
	t.Helper()
	weighted, weights := 0.0, 0.0
	for _, axis := range score.Axes {
		if axis.Score == nil {
			continue
		}
		weighted += float64(axis.Weight) * float64(*axis.Score)
		weights += float64(axis.Weight)
	}
	if weights == 0 {
		t.Fatal("no axis published a score, so there is nothing to recompute")
	}
	return int(math.Round(divide(weighted, weights)))
}

// pixel6Evidence is the archived evidence of report
// 745264e0-3227-452b-bb87-65f9bd314fe9 (Pixel 6 test unit, corot image behind an
// oriole overlay, declared as a Dimensity 9200+ phone). Values are copied from the
// archive, not invented; the test never touches the database.
func pixel6Evidence() (map[string]string, map[string]string) {
	values := map[string]string{
		"app.debuggerConnected":             "否",
		"environment.tracerPid":             "0",
		"environment.hookSignals":           "none",
		"environment.rootMountHints":        "none",
		"environment.rootManagerVisible":    "none",
		"environment.userProfile":           "owner",
		"system.selinuxEvidence":            "inferred_mac",
		"cpu.hardware":                      "mtk",
		"system.product":                    "corot_global",
		"system.device":                     "corot",
		"environment.verityMode":            "enforcing",
		"environment.drmSecurityLevel":      "L1",
		"system.model":                      "23078PND5G",
		"system.propertyModel":              "23078PND5G",
		"system.propertyDevice":             "corot",
		"system.sku":                        "23078PND5G",
		"system.hardwareSku":                "23078PND5G",
		"system.api":                        "34",
		"memory.totalRam":                   "12.00 GiB",
		"memory.physicalRam":                "12.00 GiB",
		"memory.kernelMemTotal":             "7.44 GiB",
		"cpu.cpuParts":                      "0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2",
		"system.socModel":                   "Dimensity 9200+",
		"runtime.glesRenderer":              "Immortalis-G715",
		"environment.overlayDeviceCodename": "oriole",
		"cpu.cpuCapacity":                   "160/498/1024",
		"memory.cmaTotal":                   "652 MiB",
		"system.board":                      "mt6985",
		"system.boardPlatform":              "mt6985",
		"system.bootHardware":               "mtk",
		"system.bootCount":                  "86",
		"system.initialSdk":                 "33",
		"system.partitionBuildDates": "system 2024-08-09 · vendor 2024-08-09 · product 2024-08-09 · " +
			"odm 2024-08-09 · system_ext 2024-08-09",
	}
	statuses := map[string]string{
		"system.selinux":              "RESTRICTED",
		"environment.buildDebuggable": "UNAVAILABLE",
	}
	return values, statuses
}

// mi8Evidence is the archived evidence of report
// 77e577c1-c84b-4c5e-bb53-a9fe882be7bf (stock Xiaomi MI 8, kernel 4.9, API 29).
func mi8Evidence() (map[string]string, map[string]string) {
	values := map[string]string{
		"app.debuggerConnected":          "否",
		"environment.tracerPid":          "0",
		"environment.hookSignals":        "none",
		"environment.rootMountHints":     "none",
		"environment.rootManagerVisible": "none",
		"environment.userProfile":        "owner",
		"system.selinuxEvidence":         "inferred_mac",
		"cpu.hardware":                   "qcom",
		"system.product":                 "dipper",
		"system.device":                  "dipper",
		"environment.verityMode":         "enforcing",
		"environment.buildDebuggable":    "关闭",
		"environment.drmSecurityLevel":   "L3",
		"system.model":                   "MI 8",
		"system.propertyModel":           "MI 8",
		"system.propertyDevice":          "dipper",
		"system.api":                     "29",
		"memory.totalRam":                "5.50 GiB",
		"memory.physicalRam":             "5.50 GiB",
		"memory.kernelMemTotal":          "5.50 GiB",
		"cpu.cpuParts":                   "0x51:0x802×4 / 0x51:0x803×4",
		"runtime.glesRenderer":           "Adreno (TM) 630",
		"memory.cmaTotal":                "200 MiB",
		"system.board":                   "sdm845",
		"system.boardPlatform":           "sdm845",
		"system.bootHardware":            "qcom",
		"system.bootCount":               "56",
		"system.initialSdk":              "27",
		"system.partitionBuildDates": "system 2021-10-28 · vendor 2021-10-28 · odm 2021-10-28 · " +
			"bootimage 2021-10-28",
	}
	statuses := map[string]string{
		"system.selinux":                    "RESTRICTED",
		"cpu.cpuCapacity":                   "UNAVAILABLE",
		"environment.overlayDeviceCodename": "UNAVAILABLE",
		"system.hardwareSku":                "UNAVAILABLE",
	}
	return values, statuses
}

// emulatorEvidence is the archived evidence of a real Android emulator run
// (`sigmark-emu34`, android-34 google_apis x86_64, report ff32a085-bc4a-42b0-88d0-ed13ce21f23b).
//
// This is the third anchor, and the only one that is a *deterministic positive*: the
// build markers always fire, so it can never be a clean device. What it uniquely pins is
// the composition the other two anchors cannot reach — a decisive hit landing on a report
// whose coverage is too low to publish a number. The pre-fix code emitted
// decisive=true + caps non-empty + band="?" here; this fixture is that shape, captured
// from a machine rather than imagined.
func emulatorEvidence() (map[string]string, map[string]string) {
	values := map[string]string{
		"app.debuggerConnected":          "否",
		"environment.tracerPid":          "0",
		"environment.hookSignals":        "none",
		"environment.rootMountHints":     "none",
		"environment.rootManagerVisible": "none",
		"environment.userProfile":        "owner",
		"environment.selinuxDomain":      "untrusted_app",
		"system.selinuxEvidence":         "inferred_mac",
		"environment.verityMode":         "enforcing",
		"environment.drmSecurityLevel":   "L3",
		// The three build markers, verbatim from the emulator.
		"cpu.hardware":           "ranchu",
		"system.product":         "sdk_gphone64_x86_64",
		"system.device":          "emu64xa",
		"system.model":           "sdk_gphone64_x86_64",
		"system.propertyModel":   "sdk_gphone64_x86_64",
		"system.propertyDevice":  "emu64xa",
		"system.api":             "34",
		"system.socModel":        "ranchu",
		"system.socManufacturer": "AOSP",
		"system.board":           "goldfish_x86_64",
		"system.bootHardware":    "ranchu",
		"system.bootCount":       "1",
		"system.initialSdk":      "34",
		"system.partitionBuildDates": "system 2024-07-11 · vendor 2024-07-11 · product 2024-07-11 · " +
			"odm 2024-07-11 · system_ext 2024-07-11",
		"memory.totalRam":       "2.42 GiB",
		"memory.physicalRam":    "2.42 GiB",
		"memory.kernelMemTotal": "2.42 GiB",
		"runtime.glesRenderer":  "Android Emulator OpenGL ES Translator (Google SwiftShader)",
	}
	statuses := map[string]string{
		"system.selinux":                    "RESTRICTED",
		"system.selinuxPolicy":              "RESTRICTED",
		"environment.buildDebuggable":       "UNAVAILABLE",
		"environment.overlayDeviceCodename": "UNAVAILABLE",
		"environment.overlayEvidence":       "UNAVAILABLE",
		"cpu.cpuCapacity":                   "UNAVAILABLE",
		"cpu.cpuParts":                      "UNAVAILABLE",
		"memory.cmaTotal":                   "UNAVAILABLE",
		"system.sku":                        "UNAVAILABLE",
		"system.hardwareSku":                "UNAVAILABLE",
		"system.boardPlatform":              "UNAVAILABLE",
	}
	return values, statuses
}

// §2.3 of docs/SECURITY-SCORE.md is the contract table: every deduction branch, its
// code, its label, its points and whether it is decisive. Nothing used to assert that
// table as a whole, which is exactly why four branch codes drifted out of sync with the
// document without a single test noticing. This is that assertion.
//
// It pins the wire names, not only the numbers: a rename is a contract change and must
// fail here before it reaches an operator's export.
func TestScoreDeductionTableMatchesTheDocumentedContract(t *testing.T) {
	type branch struct {
		label    string
		points   int
		axis     string
		decisive string // the cap code this branch must produce, "" when non-decisive
	}
	want := map[string]branch{
		"HOOK_INJECTION":            {"hook_injection", 25, axisBehavior, ""},
		"DEBUGGER_ATTACHED":         {"debugger_attached", 20, axisBehavior, ""},
		"SELINUX_PERMISSIVE":        {"selinux_permissive", 15, axisBehavior, ""},
		"ROOT_MANAGER_VISIBLE":      {"root_manager_visible", 12, axisBehavior, ""},
		"MULTI_OPEN":                {"multi_open", 8, axisBehavior, ""},
		"VIRTUAL_BUILD_MARKERS":     {"virtual_build_markers", 35, axisBehavior, "DECISIVE_VIRTUAL_BUILD"},
		"IDENTITY_APP_UID":          {"identity_conflict", 25, axisDeclaration, "DECISIVE_IDENTITY_APP_UID"},
		"IDENTITY_SKU":              {"identity_conflict", 15, axisDeclaration, ""},
		"FOREIGN_PROFILE":           {"hardware_declaration_conflict", 30, axisDeclaration, "DECISIVE_FOREIGN_PROFILE"},
		"HARDWARE_CHANNEL_CONFLICT": {"hardware_declaration_conflict", 30, axisDeclaration, ""},
		"OVERLAY_CODENAME_MISMATCH": {"hardware_declaration_conflict", 15, axisDeclaration, ""},
		"FRESH_BOOT_ON_AGED_ROM":    {"fresh_boot_on_aged_rom", 12, axisUsage, ""},
	}

	type seen struct {
		points int
		axis   string
		label  string
	}
	got := map[string]seen{}
	caps := map[string]bool{}
	record := func(score deviceScore) {
		for _, axis := range score.Axes {
			for _, deduction := range axis.Deductions {
				got[deduction.Code] = seen{deduction.Points, deduction.Axis, deduction.Label}
			}
		}
		for _, cap := range score.Caps {
			caps[cap.Code] = true
		}
	}

	// Every behavior branch at once, so one fixture covers all six.
	behavior := scoreDevice(map[string]string{
		"environment.hookSignals":        "magisk_mount",
		"environment.rootMountHints":     "none",
		"app.debuggerConnected":          "是",
		"environment.tracerPid":          "0",
		"system.selinux":                 "Permissive（宽容模式）",
		"environment.rootManagerVisible": "com.topjohnwu.magisk",
		"environment.userProfile":        "secondary",
		"cpu.hardware":                   "goldfish",
		"system.product":                 "sdk_gphone_x86",
		"system.device":                  "generic_x86",
	}, nil)
	record(behavior)

	// The two identity branches are mutually exclusive, so they need two fixtures.
	record(scoreDevice(map[string]string{
		"system.model":          "23078PND5G",
		"system.propertyModel":  "Pixel 6",
		"system.device":         "corot",
		"system.propertyDevice": "corot",
		"system.api":            "34",
	}, nil))
	record(scoreDevice(map[string]string{
		"system.model":          "23078PND5G",
		"system.propertyModel":  "23078PND5G",
		"system.device":         "corot",
		"system.propertyDevice": "corot",
		"system.sku":            "GR1YH",
		"system.hardwareSku":    "23078PND5G",
		"system.api":            "34",
	}, nil))

	// The three hardware branches. FOREIGN_PROFILE needs a *registered* SoC to have
	// declared: `qcom` is not in socProfiles, so only a real alias resolves. This mirrors
	// the Pixel 6 exactly — it declares a Dimensity 9200+ and then measures the Tensor
	// G1 capacity profile.
	record(scoreDevice(map[string]string{
		"cpu.hardware":    "mtk",
		"system.socModel": "Dimensity 9200+",
		"system.product":  "corot",
		"system.device":   "corot",
		"cpu.cpuCapacity": "160/498/1024",
		"memory.cmaTotal": "652 MiB",
	}, nil))
	record(scoreDevice(map[string]string{
		"memory.totalRam":       "12.00 GiB",
		"memory.physicalRam":    "5.50 GiB",
		"memory.kernelMemTotal": "7.44 GiB",
	}, nil))
	record(scoreDevice(map[string]string{
		"system.device":                     "corot",
		"environment.overlayDeviceCodename": "oriole",
	}, nil))

	// The usage branch.
	record(scoreDevice(map[string]string{
		"system.bootCount":           "2",
		"system.partitionBuildDates": "system 2021-10-28 · vendor 2021-10-28",
	}, nil))

	for code, expected := range want {
		actual, ok := got[code]
		if !ok {
			t.Errorf("%q is documented but no fixture emitted it", code)
			continue
		}
		if actual.points != expected.points {
			t.Errorf("%q: points = %d, want %d", code, actual.points, expected.points)
		}
		if actual.axis != expected.axis {
			t.Errorf("%q: axis = %q, want %q", code, actual.axis, expected.axis)
		}
		if actual.label != expected.label {
			t.Errorf("%q: label = %q, want %q", code, actual.label, expected.label)
		}
		if expected.decisive != "" && !caps[expected.decisive] {
			t.Errorf("%q is decisive but produced no %q cap", code, expected.decisive)
		}
		if expected.decisive == "" && len(caps) > 0 && code != "IDENTITY_APP_UID" {
			// Non-decisive branches must not be the reason a cap exists. The behavior
			// fixture does carry one (virtual build), so only assert per-branch where the
			// fixture isolates the branch — the overlay and conflict fixtures are clean.
			_ = expected
		}
	}
	// Nothing undocumented may appear: a new branch needs a row in §2.3 first.
	for code := range got {
		if _, ok := want[code]; !ok {
			t.Errorf("%q is emitted but absent from the §2.3 contract table", code)
		}
	}
	// The three isolated fixtures must not produce a cap at all — that is what makes
	// "non-decisive" mean something.
	for name, score := range map[string]deviceScore{
		"hardware-channel-conflict": scoreDevice(map[string]string{
			"memory.totalRam":       "12.00 GiB",
			"memory.physicalRam":    "5.50 GiB",
			"memory.kernelMemTotal": "7.44 GiB",
		}, nil),
		"overlay-codename": scoreDevice(map[string]string{
			"system.device":                     "corot",
			"environment.overlayDeviceCodename": "oriole",
		}, nil),
		"sku-only-identity": scoreDevice(map[string]string{
			"system.model":          "23078PND5G",
			"system.propertyModel":  "23078PND5G",
			"system.device":         "corot",
			"system.propertyDevice": "corot",
			"system.sku":            "GR1YH",
			"system.hardwareSku":    "23078PND5G",
			"system.api":            "34",
		}, nil),
	} {
		if len(score.Caps) != 0 {
			t.Errorf("%s: caps = %+v, want none (the branch is documented non-decisive)",
				name, score.Caps)
		}
	}
}

// The emulator anchor: a decisive hit on a report whose declaration axis is blind. Both
// facts must survive — the band is the conclusion, and the number is a sort key that no
// longer disappears just because the conclusion is already settled.
//
// This test used to assert `value == nil` here, on the reading that "coverage withholds the
// number". That was the *declaration* form of R10, and it was doing the withholding — not
// overall coverage, which is 0.67 on this capture. Replaying a real LDPlayer 9 report showed
// what that costs: `band=D, value=null` tells a reviewer nothing about how much was actually
// deducted, and two D-grade devices cannot be ordered against each other. R10 exists to stop
// a blind 40%-weight axis from publishing a comfortable A, and once a decisive cap has fixed
// the band at D there is no comfort left to protect (§13 F5). So the withhold now applies
// only when nothing else has decided the band.
func TestScoreEmulatorAnchorIsDecisiveUnderLowCoverage(t *testing.T) {
	values, statuses := emulatorEvidence()
	score := scoreDevice(values, statuses)
	if !score.Decisive {
		t.Fatalf("the emulator must be decisive: caps = %+v", score.Caps)
	}
	if len(score.Caps) != 1 || score.Caps[0].Code != "DECISIVE_VIRTUAL_BUILD" {
		t.Fatalf("caps = %+v, want exactly DECISIVE_VIRTUAL_BUILD", score.Caps)
	}
	if score.Band != bandD {
		t.Fatalf("band = %q, want D", score.Band)
	}
	if score.Value == nil {
		t.Fatal("value = null: a decisive hit keeps its number as a sort key, the band is " +
			"already the conclusion")
	}
	// The number must be recomputable from the axes that printed one. The declaration axis
	// is blind here (coverage 0.33, nothing found), so R7 keeps it out of the average and it
	// must therefore print no score — otherwise the three visible scores give 87.75 against
	// a published 80.
	declaration := scoreAxisByCode(t, score, axisDeclaration)
	if declaration.Score != nil {
		t.Fatalf("declaration score = %d at coverage %v: an axis R7 excluded from the "+
			"average must not publish a score", *declaration.Score, declaration.Coverage)
	}
	if got := recomputeValue(t, score); got != *score.Value {
		t.Fatalf("published value = %d, recomputed from the printed axes = %d", *score.Value, got)
	}
	// The marker is priced once, on behavior, and the declaration axis stays clean.
	behavior := scoreAxisByCode(t, score, axisBehavior)
	if got := scoreDeductionsFor(behavior, "virtual_build_markers"); len(got) != 1 {
		t.Fatalf("behavior virtual_build_markers = %+v", got)
	}
	if len(declaration.Deductions) != 0 {
		t.Fatalf("declaration must stay clean on a pure build-marker hit: %+v",
			declaration.Deductions)
	}
	// software_drm fires (L3) but is display-only, so it must not appear as a deduction.
	for _, axis := range score.Axes {
		for _, deduction := range axis.Deductions {
			if deduction.Label == "software_drm" || deduction.Label == "rom_verification" {
				t.Fatalf("%q is display-only but was priced: %+v", deduction.Label, deduction)
			}
		}
	}
}

// The Pixel 6 test unit is a rewritten description: the kernel answers for a Tensor
// G1 while the framework declares a Dimensity 9200+. The foreign-profile branch is a
// positive identification, so it caps the band at D instead of being averaged away.
func TestScorePixel6AnchorLandsAtD(t *testing.T) {
	values, statuses := pixel6Evidence()
	score := scoreDevice(values, statuses)

	// The literal is pinned here on purpose: this test is the one place that would catch a
	// verdict-changing edit landing without a version bump.
	if score.Version != scoreVersion {
		t.Fatalf("version = %q, want %q", score.Version, scoreVersion)
	}
	if score.Band != bandD || score.BandLabel != "高度可疑" {
		t.Fatalf("Pixel 6 band = %q/%q, want D/高度可疑", score.Band, score.BandLabel)
	}
	if !score.Decisive {
		t.Fatal("Pixel 6 must be decisive")
	}
	if score.Value == nil {
		t.Fatal("Pixel 6 must publish a value: its coverage is not thin")
	}
	found := false
	for _, cap := range score.Caps {
		if cap.Code == "DECISIVE_FOREIGN_PROFILE" && cap.Band == bandD {
			found = true
		}
	}
	if !found {
		t.Fatalf("Pixel 6 caps = %+v, want DECISIVE_FOREIGN_PROFILE", score.Caps)
	}
	declaration := scoreAxisByCode(t, score, axisDeclaration)
	foreign := scoreDeductionsByCode(declaration, "FOREIGN_PROFILE")
	if len(foreign) != 1 || foreign[0].Points != 30 {
		t.Fatalf("declaration hardware deduction = %+v", foreign)
	}
	// The overlay channel is a separate deduction with the *same* label: three channels
	// share hardware_declaration_conflict, so the code is what names the branch.
	if overlay := scoreDeductionsByCode(declaration, "OVERLAY_CODENAME_MISMATCH"); len(overlay) != 1 || overlay[0].Points != 15 {
		t.Fatalf("declaration overlay deduction = %+v", overlay)
	}
	if channel := scoreDeductionsByCode(declaration, "HARDWARE_CHANNEL_CONFLICT"); len(channel) != 0 {
		t.Fatalf("a foreign profile must not also price as a plain channel conflict: %+v", channel)
	}
	if !containsString(foreign[0].Keys, "cpu.cpuCapacity") && !containsString(foreign[0].Keys, "memory.cmaTotal") {
		t.Fatalf("foreign-profile keys = %v, want the measured kernel channel", foreign[0].Keys)
	}
	t.Logf("Pixel 6: value=%d band=%s coverage=%.2f axes=%+v", *score.Value, score.Band, score.Coverage, score.Axes)
}

// The stock MI 8 must stay clean: same rules, no false positive.
func TestScoreMI8AnchorStaysClean(t *testing.T) {
	values, statuses := mi8Evidence()
	score := scoreDevice(values, statuses)

	if score.Band != bandA && score.Band != bandB {
		t.Fatalf("MI 8 band = %q, want A or B", score.Band)
	}
	if score.Decisive {
		t.Fatalf("MI 8 must not be decisive: %+v", score.Caps)
	}
	if score.Value == nil {
		t.Fatal("MI 8 must publish a value")
	}
	for _, axis := range score.Axes {
		if len(axis.Deductions) != 0 {
			t.Fatalf("MI 8 axis %s must not deduct: %+v", axis.Code, axis.Deductions)
		}
	}
	if score.Band != bandA || *score.Value != 100 {
		t.Fatalf("MI 8 = %d/%s, want 100/A", *score.Value, score.Band)
	}
	// The unreadable side of the overlay comparison must be the one named, so a
	// reviewer knows which field to chase.
	overlayGap := false
	for _, gap := range scoreUndeterminedForAxis(score, axisDeclaration) {
		if containsString(gap.Keys, "environment.overlayDeviceCodename") && gap.Reason == "UNAVAILABLE" {
			overlayGap = true
		}
		if containsString(gap.Keys, "system.device") {
			t.Errorf("system.device answered and must not be reported as a gap: %+v", gap)
		}
	}
	if !overlayGap {
		t.Fatalf("missing overlay gap: %+v", score.Undetermined)
	}
	t.Logf("MI 8: value=%d band=%s coverage=%.2f", *score.Value, score.Band, score.Coverage)
}

// R1: no naked number. Every deduction names its reason code, its label, its axis, a
// point value, at least one real field key and a human-readable detail.
func TestScoreRule1EveryDeductionHasProvenance(t *testing.T) {
	values, statuses := pixel6Evidence()
	parameters := scoreFixture(values, statuses)
	labels := profileSignals(parameters)
	score := buildDeviceScore(parameters, labels, 0)

	realKeys := map[string]bool{}
	for _, parameter := range parameters {
		realKeys[parameter.Group+"."+parameter.Key] = true
	}
	labelsByCode := map[string]bool{}
	for _, label := range labels {
		labelsByCode[label.Code] = true
	}
	count := 0
	for _, axis := range score.Axes {
		for _, deduction := range axis.Deductions {
			count++
			if deduction.Code == "" || deduction.Label == "" || deduction.Detail == "" {
				t.Errorf("deduction lost provenance: %+v", deduction)
			}
			if deduction.Axis != axis.Code {
				t.Errorf("deduction axis = %q, want %q", deduction.Axis, axis.Code)
			}
			if deduction.Points <= 0 {
				t.Errorf("deduction %s has no points: %+v", deduction.Code, deduction)
			}
			if len(deduction.Keys) == 0 {
				t.Errorf("deduction %s cites no field: %+v", deduction.Code, deduction)
			}
			for _, key := range deduction.Keys {
				if !realKeys[key] {
					t.Errorf("deduction %s cites a key that is not in the report: %q", deduction.Code, key)
				}
			}
			if !labelsByCode[deduction.Label] && deduction.Label != "overlay_codename" {
				t.Errorf("deduction %s cites an unknown label %q", deduction.Code, deduction.Label)
			}
		}
	}
	if count == 0 {
		t.Fatal("the Pixel 6 sample must produce deductions")
	}
}

// R2: several hits inside one label take the max, never the sum. hook_injection has
// two evidence keys; both are positive here, and the axis still loses 25 once.
func TestScoreRule2SameLabelTakesMaxNotSum(t *testing.T) {
	values := map[string]string{
		"environment.hookSignals":    "magisk,frida",
		"environment.rootMountHints": "magisk_mount",
	}
	score := scoreDevice(values, nil)
	behavior := scoreAxisByCode(t, score, axisBehavior)
	hooks := scoreDeductionsFor(behavior, "hook_injection")
	if len(hooks) != 1 {
		t.Fatalf("hook_injection deductions = %d, want 1: %+v", len(hooks), hooks)
	}
	if hooks[0].Points != 25 {
		t.Fatalf("hook_injection points = %d, want 25 (max, not 50)", hooks[0].Points)
	}
	if axisScoreOf(t, behavior) != 75 {
		t.Fatalf("behavior score = %d, want 75", axisScoreOf(t, behavior))
	}
	if len(hooks[0].Keys) != 2 {
		t.Fatalf("both positive keys must stay traceable: %v", hooks[0].Keys)
	}
}

// R2 across labels: the overlay codename is one of the hardware label's own channels but
// is priced separately at 15. When the codename is the *only* thing that disagreed, it
// must cost 15 and not 30 + 15 for one fact under two identical field keys. Found by
// replaying the archive: the codename-only case was charging 45.
func TestScoreOverlayCodenameIsNotDoubleCounted(t *testing.T) {
	values := map[string]string{
		"cpu.hardware":                      "qcom",
		"system.product":                    "corot",
		"system.device":                     "corot",
		"environment.overlayDeviceCodename": "oriole",
		"system.selinux":                    "Enforcing（强制模式）",
		"app.debuggerConnected":             "否",
		"environment.tracerPid":             "0",
		"environment.hookSignals":           "none",
		"environment.rootMountHints":        "none",
		"environment.rootManagerVisible":    "none",
		"environment.userProfile":           "owner",
		"system.bootCount":                  "56",
		"system.partitionBuildDates":        "system 2021-10-28 · vendor 2021-10-28",
	}
	score := scoreDevice(values, nil)
	declaration := scoreAxisByCode(t, score, axisDeclaration)
	overlay := scoreDeductionsByCode(declaration, "OVERLAY_CODENAME_MISMATCH")
	if len(overlay) != 1 || overlay[0].Points != 15 {
		t.Fatalf("overlay deductions = %+v, want exactly one 15-point entry", overlay)
	}
	if channel := scoreDeductionsByCode(declaration, "HARDWARE_CHANNEL_CONFLICT"); len(channel) != 0 {
		t.Fatalf("the codename alone must not also price 30 as a channel conflict: %+v", channel)
	}
	// One disagreement, one price: the axis loses exactly 15 of its 100-point scale.
	if axisScoreOf(t, declaration) != 85 {
		t.Fatalf("declaration score = %d, want 85 (100 − 15)", axisScoreOf(t, declaration))
	}
	// And it is not decisive: a rewritten codename is suspicious, not proof.
	if score.Decisive {
		t.Fatalf("a codename-only mismatch must not cap the band: %+v", score.Caps)
	}
}

// The same codename channel next to a real foreign profile still yields both findings,
// because they are different facts: the chip was misdescribed *and* the codename was
// rewritten. Only the duplicate 30-point channel conflict is suppressed.
func TestScoreOverlayAndForeignProfileCoexist(t *testing.T) {
	values, statuses := pixel6Evidence()
	score := scoreDevice(values, statuses)
	declaration := scoreAxisByCode(t, score, axisDeclaration)
	if len(scoreDeductionsByCode(declaration, "FOREIGN_PROFILE")) != 1 {
		t.Fatalf("the foreign profile must still price: %+v", declaration.Deductions)
	}
	if len(scoreDeductionsByCode(declaration, "OVERLAY_CODENAME_MISMATCH")) != 1 {
		t.Fatalf("the codename must still price: %+v", declaration.Deductions)
	}
	if !score.Decisive || score.Band != bandD {
		t.Fatalf("Pixel 6 = %q decisive=%v", score.Band, score.Decisive)
	}
}

// R3: a clean label contributes no deduction but does fill the coverage numerator.
func TestScoreRule3NotObservedFillsCoverageWithoutDeduction(t *testing.T) {
	values := map[string]string{
		"cpu.hardware":                   "qcom",
		"system.product":                 "dipper",
		"system.device":                  "dipper",
		"system.selinux":                 "Enforcing（强制模式）",
		"app.debuggerConnected":          "否",
		"environment.tracerPid":          "0",
		"environment.hookSignals":        "none",
		"environment.rootMountHints":     "none",
		"environment.rootManagerVisible": "none",
		"environment.userProfile":        "owner",
	}
	score := scoreDevice(values, nil)
	behavior := scoreAxisByCode(t, score, axisBehavior)
	if len(behavior.Deductions) != 0 {
		t.Fatalf("clean labels must not deduct: %+v", behavior.Deductions)
	}
	if axisScoreOf(t, behavior) != 100 {
		t.Fatalf("behavior score = %d, want 100", axisScoreOf(t, behavior))
	}
	if behavior.Coverage != 1 {
		t.Fatalf("behavior coverage = %v, want 1 (six not_observed labels)", behavior.Coverage)
	}
	if len(scoreUndeterminedForAxis(score, axisBehavior)) != 0 {
		t.Fatalf("not_observed must not become undetermined: %+v", score.Undetermined)
	}
}

// R4: insufficient / NOT_ARCHIVED never deducts, but it does sit in the denominator
// and it must appear in undetermined with its axis, keys and reason.
func TestScoreRule4InsufficientGoesToUndetermined(t *testing.T) {
	values := map[string]string{
		"system.selinuxEvidence":     "inferred_mac",
		"environment.hookSignals":    "none",
		"environment.rootMountHints": "none",
	}
	statuses := map[string]string{"system.selinux": "RESTRICTED"}
	score := scoreDevice(values, statuses)
	behavior := scoreAxisByCode(t, score, axisBehavior)
	if len(behavior.Deductions) != 0 {
		t.Fatalf("insufficient must not deduct: %+v", behavior.Deductions)
	}
	if behavior.Coverage != 0.17 {
		t.Fatalf("behavior coverage = %v, want 1/6 = 0.17", behavior.Coverage)
	}
	gaps := scoreUndeterminedForAxis(score, axisBehavior)
	found := false
	for _, gap := range gaps {
		if containsString(gap.Keys, "system.selinux") && gap.Reason == "RESTRICTED" {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing undetermined entry for system.selinux: %+v", gaps)
	}
	// A key the client never sent is distinguishable from a rejected read.
	archived := false
	for _, gap := range gaps {
		if containsString(gap.Keys, "app.debuggerConnected") && gap.Reason == "NOT_ARCHIVED" {
			archived = true
		}
	}
	if !archived {
		t.Fatalf("missing NOT_ARCHIVED undetermined entry: %+v", gaps)
	}
}

// R5: a decisive hit caps the band at D. It is not averaged into a comfortable B.
func TestScoreRule5DecisiveCapsTheBand(t *testing.T) {
	values := map[string]string{
		"cpu.hardware":                      "ranchu",
		"system.product":                    "sdk_gphone64_x86_64",
		"system.device":                     "ranchu",
		"environment.hookSignals":           "none",
		"environment.rootMountHints":        "none",
		"environment.rootManagerVisible":    "none",
		"environment.userProfile":           "owner",
		"app.debuggerConnected":             "否",
		"environment.tracerPid":             "0",
		"system.selinux":                    "Enforcing（强制模式）",
		"environment.overlayDeviceCodename": "ranchu",
		"memory.totalRam":                   "4.00 GiB",
		"memory.physicalRam":                "4.00 GiB",
		"memory.kernelMemTotal":             "3.98 GiB",
		"system.bootCount":                  "9",
		"system.partitionBuildDates":        "system 2024-08-09 · vendor 2024-08-09",
	}
	score := scoreDevice(values, nil)
	behavior := scoreAxisByCode(t, score, axisBehavior)
	if axisScoreOf(t, behavior) != 65 {
		t.Fatalf("behavior score = %d, want 65 (100-35)", axisScoreOf(t, behavior))
	}
	if score.Value == nil {
		t.Fatal("this sample has enough coverage to publish a value")
	}
	// 40*100 + 35*65 + 25*100 = 87.75 -> 88 would be band A without the cap.
	if *score.Value < 85 {
		t.Fatalf("sample value = %d, the cap must be the only reason for D", *score.Value)
	}
	if score.Band != bandD || !score.Decisive {
		t.Fatalf("band = %q decisive=%v, want D/true", score.Band, score.Decisive)
	}
	found := false
	for _, cap := range score.Caps {
		if cap.Code == "DECISIVE_VIRTUAL_BUILD" && cap.Band == bandD {
			found = true
		}
	}
	if !found {
		t.Fatalf("caps = %+v, want DECISIVE_VIRTUAL_BUILD", score.Caps)
	}
}

// R6: the axis score is 100 minus the deductions, clamped into [0,100]. A deduction's
// points are on a 0–100 scale inside the axis; the axis weight is only its share of the
// cross-axis average, so it must not enter this arithmetic. Capping the sum at the weight
// would make the worst declaration axis 60 and the worst possible device 66, so an
// ordinary "everything disagrees" device could never reach D on its own.
func TestScoreRule6AxisScoreSpansTheFullRange(t *testing.T) {
	values := map[string]string{
		"memory.totalRam":                   "12.00 GiB",
		"memory.physicalRam":                "12.00 GiB",
		"memory.kernelMemTotal":             "7.44 GiB",
		"system.model":                      "23078PND5G",
		"system.propertyModel":              "MI 8",
		"system.api":                        "34",
		"system.device":                     "corot",
		"environment.overlayDeviceCodename": "oriole",
	}
	score := scoreDevice(values, nil)
	declaration := scoreAxisByCode(t, score, axisDeclaration)
	sum := 0
	for _, deduction := range declaration.Deductions {
		sum += deduction.Points
	}
	if sum != 70 {
		t.Fatalf("declaration deductions = %d, want 70 (30+25+15): %+v", sum, declaration.Deductions)
	}
	if axisScoreOf(t, declaration) != 30 {
		t.Fatalf("declaration score = %d, want 30 (100 - 70)", axisScoreOf(t, declaration))
	}
	if axisScoreOf(t, declaration) < 0 {
		t.Fatal("an axis score must never be negative")
	}
	// A budget-consuming set of deductions really is a zero, not a floor of 100−weight.
	zero := scoreDevice(map[string]string{
		"environment.hookSignals":        "magisk",
		"environment.rootMountHints":     "magisk_mount",
		"environment.rootManagerVisible": "magisk",
		"system.selinux":                 "Permissive",
		"app.debuggerConnected":          "是",
		"environment.tracerPid":          "1234",
		"cpu.hardware":                   "ranchu",
		"system.product":                 "sdk_gphone64_x86_64",
		"system.device":                  "sdk_gphone64_x86_64",
	}, nil)
	behavior := scoreAxisByCode(t, zero, axisBehavior)
	if axisScoreOf(t, behavior) != 0 {
		t.Fatalf("a fully-disagreeing behavior axis = %d, want 0: %+v", axisScoreOf(t, behavior), behavior.Deductions)
	}
}

// R7: an axis that was barely read must not water down a real finding with its
// unearned 100. usage here read neither of its two channels, so it stays out of the
// total and the two fully-read axes decide the number.
func TestScoreRule7ThinAxisDoesNotDilute(t *testing.T) {
	values := map[string]string{
		"system.model":                      "dipper",
		"system.propertyModel":              "dipper",
		"system.device":                     "dipper",
		"system.propertyDevice":             "dipper",
		"system.api":                        "29",
		"environment.overlayDeviceCodename": "dipper",
		"cpu.hardware":                      "qcom",
		"system.product":                    "dipper",
		"system.selinux":                    "Enforcing（强制模式）",
		"app.debuggerConnected":             "否",
		"environment.tracerPid":             "0",
		"environment.hookSignals":           "none",
		"environment.rootMountHints":        "none",
		"environment.rootManagerVisible":    "none",
		"environment.userProfile":           "owner",
		// no system.bootCount and no system.partitionBuildDates: the usage axis is
		// thin and carries no finding, so it must not be averaged in.
	}
	score := scoreDevice(values, nil)
	usage := scoreAxisByCode(t, score, axisUsage)
	if usage.Coverage >= 0.5 {
		t.Fatalf("usage coverage = %v, this sample needs a thin axis", usage.Coverage)
	}
	if len(usage.Deductions) != 0 {
		t.Fatalf("the thin axis must carry no deduction here: %+v", usage.Deductions)
	}
	// The thin axis must not be averaged in — but since R10 was extended to all three axes,
	// a blind axis withholds the number instead of quietly renormalising the weights onto the
	// readable ones. Both outcomes keep the 100 out of the document; the difference is that
	// withholding is visible, whereas renormalising looked like a clean 100. A red-team test
	// proved the renormalising form was exploitable: delete the usage inputs and the score
	// went *up* from 97/B to 100/A.
	// The thin axis must not be averaged in. Since R10 was extended to all three axes, a
	// blind axis forbids "一致": the number still publishes (the readable axes renormalise),
	// but it cannot wear the top band. Before the extension this fixture scored a clean
	// 100/A — a red-team test showed the same shape on a real MI 8 where deleting the usage
	// inputs *raised* the score from 97/B to 100/A.
	if score.Band == bandA {
		t.Fatalf("band = %s: a blind axis must forbid the top band", bandA)
	}
	if score.Value == nil || *score.Value != 100 {
		t.Fatalf("value = %v, want 100: the readable axes are clean and renormalise", derefScore(score.Value))
	}
	// Each read axis must still be clean for this fixture, so the withholding is caused by
	// the blind axis and not by some unrelated deduction.
	for _, code := range []string{axisDeclaration, axisBehavior} {
		if axisScoreOf(t, scoreAxisByCode(t, score, code)) != 100 {
			t.Fatalf("%s axis is not clean, this fixture needs clean readable axes", code)
		}
	}
}

// R7 refinement (found by replaying the archive): the exception to R7 is an axis that
// carries a deduction. A recorded inconsistency is a fact even when its siblings were
// unreadable, and dropping the axis because its coverage is thin would hide the very
// finding the axis exists to price. Two of the archived reports were the proof: their
// declaration axis was thin AND carried a conflict, and the old rule dropped the axis
// entirely, publishing a comfortable 100 for a confirmed disguise.
func TestScoreRule7ThinAxisWithDeductionStillCounts(t *testing.T) {
	values := map[string]string{
		// Only the app-uid model pair is readable on the declaration axis, so coverage
		// stays below the floor while the disagreement still prices its points.
		"system.model":                   "corot",
		"system.propertyModel":           "oriole",
		"cpu.hardware":                   "qcom",
		"system.product":                 "dipper",
		"system.device":                  "dipper",
		"system.selinux":                 "Enforcing（强制模式）",
		"app.debuggerConnected":          "否",
		"environment.tracerPid":          "0",
		"environment.hookSignals":        "none",
		"environment.rootMountHints":     "none",
		"environment.rootManagerVisible": "none",
		"environment.userProfile":        "owner",
		"system.bootCount":               "56",
		"system.partitionBuildDates":     "system 2021-10-28 · vendor 2021-10-28",
	}
	score := scoreDevice(values, nil)
	declaration := scoreAxisByCode(t, score, axisDeclaration)
	if declaration.Coverage >= 0.5 {
		t.Fatalf("declaration coverage = %v, this sample needs a thin axis", declaration.Coverage)
	}
	if len(declaration.Deductions) == 0 {
		t.Fatal("this sample needs a deduction inside the thin axis")
	}
	if score.Value == nil {
		t.Fatalf("a thin axis that carries a finding must not withhold the number (coverage %.2f)", score.Coverage)
	}
	if *score.Value >= 100 {
		t.Fatalf("value = %d: the thin axis deduction was dropped from the total", *score.Value)
	}
	if score.Band == bandA {
		t.Fatalf("band = %q: a report with a deduction can never wear %q", score.Band, bandA)
	}
}

// R10: a blind declaration axis withholds the number. The declaration axis answers
// "does this device tell the truth about itself"; reading nothing there is not a
// clean bill of health, it is an unanswered question. Archived field-set-20 reports
// proved the need: their declaration axis had coverage 0 and the total came out 100/A.
func TestScoreRule10BlindDeclarationAxisPublishesNothing(t *testing.T) {
	values := map[string]string{
		"cpu.hardware":                   "qcom",
		"system.product":                 "dipper",
		"system.device":                  "dipper",
		"system.selinux":                 "Enforcing（强制模式）",
		"app.debuggerConnected":          "否",
		"environment.tracerPid":          "0",
		"environment.hookSignals":        "none",
		"environment.rootMountHints":     "none",
		"environment.rootManagerVisible": "none",
		"environment.userProfile":        "owner",
		"system.bootCount":               "56",
		"system.partitionBuildDates":     "system 2021-10-28 · vendor 2021-10-28",
	}
	score := scoreDevice(values, nil)
	declaration := scoreAxisByCode(t, score, axisDeclaration)
	if declaration.Coverage >= scoreCoverageFloor {
		t.Fatalf("declaration coverage = %v, this sample needs a blind declaration axis", declaration.Coverage)
	}
	if len(declaration.Deductions) != 0 {
		t.Fatal("a blind axis must carry no deduction, otherwise it is thin and R7 applies")
	}
	if score.Coverage < scoreCoverageFloor {
		t.Fatalf("overall coverage = %.2f: this fixture must isolate R10, not R8", score.Coverage)
	}
	if score.Value != nil {
		t.Fatalf("value = %d: a blind declaration axis must not publish a number", *score.Value)
	}
	if score.Band != bandUnknown {
		t.Fatalf("band = %q, want %q", score.Band, bandUnknown)
	}
}

// R11: "一致" means nothing disagreed. Any deduction, however small, has something
// that disagreed, so the band drops to B while the number stays as a sort key. The
// 12-point usage deduction here cannot pull a 97 under 85, so only R11 explains why
// this report is not band A.
func TestScoreRule11BandANeedsNoDeductions(t *testing.T) {
	values := map[string]string{
		"system.model":                      "dipper",
		"system.propertyModel":              "dipper",
		"system.device":                     "dipper",
		"system.propertyDevice":             "dipper",
		"system.api":                        "29",
		"environment.overlayDeviceCodename": "dipper",
		"cpu.hardware":                      "qcom",
		"system.product":                    "dipper",
		"system.selinux":                    "Enforcing（强制模式）",
		"app.debuggerConnected":             "否",
		"environment.tracerPid":             "0",
		"environment.hookSignals":           "none",
		"environment.rootMountHints":        "none",
		"environment.rootManagerVisible":    "none",
		"environment.userProfile":           "owner",
		"system.bootCount":                  "2",
		"system.partitionBuildDates":        "system 2021-10-28 · vendor 2021-10-28",
	}
	score := scoreDevice(values, nil)
	dirty := false
	for _, axis := range score.Axes {
		dirty = dirty || len(axis.Deductions) > 0
	}
	if !dirty {
		t.Fatal("this fixture needs at least one deduction")
	}
	if score.Value == nil {
		t.Fatalf("a value is expected, coverage is %.2f", score.Coverage)
	}
	if *score.Value < 85 {
		t.Fatalf("value = %d: this fixture needs a value that would otherwise reach A", *score.Value)
	}
	if score.Band != bandB {
		t.Fatalf("band = %q, want %q: value %d is A-range but a deduction forbids A", score.Band, bandB, *score.Value)
	}
}

// R8: when the archive cannot decide the device, no number is published. An old
// kernel with seven insufficient labels must not be rewarded with 100.
func TestScoreRule8LowCoveragePublishesNothing(t *testing.T) {
	values := map[string]string{
		"cpu.hardware":               "qcom",
		"system.product":             "dipper",
		"system.device":              "dipper",
		"app.debuggerConnected":      "否",
		"environment.tracerPid":      "0",
		"environment.hookSignals":    "none",
		"environment.rootMountHints": "none",
	}
	parameters := scoreFixture(values, nil)
	labels := profileSignals(parameters)
	insufficient := 0
	for _, label := range labels {
		if label.State == "insufficient" {
			insufficient++
		}
	}
	if insufficient != 7 {
		t.Fatalf("fixture has %d insufficient labels, want 7", insufficient)
	}
	score := buildDeviceScore(parameters, labels, 0)
	if score.Value != nil {
		t.Fatalf("value = %d, want null: coverage is %.2f", *score.Value, score.Coverage)
	}
	if score.Band != bandUnknown || score.BandLabel != "未知" {
		t.Fatalf("band = %q/%q, want ?/未知", score.Band, score.BandLabel)
	}
	raw, err := json.Marshal(score)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"value":null`) {
		t.Fatalf("value must serialise as null: %s", raw)
	}
	if !strings.Contains(string(raw), `"band":"?"`) {
		t.Fatalf("band must serialise as ?: %s", raw)
	}
	// The frontend contract is pinned: when band is "?", every axes[].score is JSON
	// null, while coverage keeps the real number that explains the missing score.
	for _, axis := range score.Axes {
		if axis.Score != nil {
			t.Fatalf("axis %s published a score on an unscored report: %d", axis.Code, *axis.Score)
		}
	}
	if !strings.Contains(string(raw), `"score":null`) {
		t.Fatalf("axes[].score must serialise as null: %s", raw)
	}
	if score.Axes[1].Coverage == 0 && score.Axes[1].computed == 0 {
		t.Fatalf("behavior axis lost its coverage: %+v", score.Axes[1])
	}
}

// R9: the value only orders reports; the band is the conclusion. Five bands.
func TestScoreRule9BandMapping(t *testing.T) {
	cases := []struct {
		value int
		band  string
		label string
	}{
		{100, bandA, "一致"},
		{85, bandA, "一致"},
		{84, bandB, "有疑点"},
		{70, bandB, "有疑点"},
		{69, bandC, "可疑"},
		{50, bandC, "可疑"},
		{49, bandD, "高度可疑"},
		{0, bandD, "高度可疑"},
	}
	for _, c := range cases {
		if got := scoreBandOf(c.value); got != c.band {
			t.Errorf("scoreBandOf(%d) = %q, want %q", c.value, got, c.band)
		}
		if got := scoreBandLabels[c.band]; got != c.label {
			t.Errorf("band label %q = %q, want %q", c.band, got, c.label)
		}
	}
	if scoreBandLabels[bandUnknown] != "未知" {
		t.Fatalf("unknown band label = %q", scoreBandLabels[bandUnknown])
	}
	// A band is not a re-derivation of the value: the cap moves the band only.
	values, statuses := pixel6Evidence()
	score := scoreDevice(values, statuses)
	if score.Value == nil || *score.Value < 50 {
		t.Fatalf("Pixel 6 value = %v, the cap must not rewrite the number", score.Value)
	}
	if score.Band != bandD {
		t.Fatalf("Pixel 6 band = %q, want D from the cap", score.Band)
	}
}

// virtual_build_markers is a behavior signal. It must never be deducted twice: the
// declaration axis never touches it, and the marker never appears in that axis's
// deductions. It is also not smuggled into undetermined as a fifth reason code,
// because the frontend pins that enum to the four field states.
func TestScoreVirtualBuildMarkersIsNotDeductedTwice(t *testing.T) {
	values := map[string]string{
		"cpu.hardware":               "goldfish",
		"system.product":             "sdk_gphone_x86",
		"system.device":              "generic_x86",
		"system.bootCount":           "12",
		"system.partitionBuildDates": "system 2024-08-09 · vendor 2024-08-09",
	}
	score := scoreDevice(values, nil)
	behavior := scoreAxisByCode(t, score, axisBehavior)
	declaration := scoreAxisByCode(t, score, axisDeclaration)
	if got := scoreDeductionsFor(behavior, "virtual_build_markers"); len(got) != 1 || got[0].Points != 35 {
		t.Fatalf("behavior virtual_build_markers = %+v", got)
	}
	if got := scoreDeductionsFor(declaration, "virtual_build_markers"); len(got) != 0 {
		t.Fatalf("declaration must not deduct virtual_build_markers again: %+v", got)
	}
	// The marker's field keys may only appear under the behavior axis.
	for _, gap := range scoreUndeterminedForAxis(score, axisDeclaration) {
		for _, key := range gap.Keys {
			if key == "cpu.hardware" || key == "system.product" || key == "system.device" {
				t.Fatalf("marker key %q leaked into the declaration axis: %+v", key, gap)
			}
		}
	}
	// Every undetermined reason must stay inside the four field states.
	for _, gap := range score.Undetermined {
		if !oneOf(gap.Reason, "UNAVAILABLE", "RESTRICTED", "NOT_ARCHIVED", "ERROR") {
			t.Fatalf("undetermined reason %q is outside the four field states", gap.Reason)
		}
	}
	// The two axes must not both lose points for the same root cause: the marker is
	// deducted exactly once, in behavior, across the whole report.
	markerDeductions := 0
	for _, axis := range score.Axes {
		for _, deduction := range axis.Deductions {
			if deduction.Label == "virtual_build_markers" {
				markerDeductions++
				if axis.Code != axisBehavior {
					t.Fatalf("marker deducted on %s, want behavior only", axis.Code)
				}
			}
		}
	}
	if markerDeductions != 1 {
		t.Fatalf("marker deductions = %d, want exactly 1", markerDeductions)
	}
	// P0 regression: this fixture is decisive (an emulator build) but its coverage is
	// only 0.31, so it takes the low-coverage early return. That branch used to publish
	// band "?" and skip R5 entirely, producing decisive=true + caps non-empty + band "?"
	// in one document. A decisive hit is proof that does not need coverage to be true.
	if !score.Decisive {
		t.Fatalf("the emulator build must be decisive: %+v", score.Caps)
	}
	if score.Band != bandD {
		t.Fatalf("band = %q, want D: a decisive hit must cap the band even at low coverage",
			score.Band)
	}
	if score.Value != nil {
		t.Fatalf("value = %d, want null: low coverage still withholds the number", *score.Value)
	}
}

// The same rule at the other early return: a blind declaration axis withholds the number
// but must not withhold a decisive conclusion.
func TestScoreDecisiveSurvivesABlindDeclarationAxis(t *testing.T) {
	values := map[string]string{
		// Nothing on the declaration axis at all, so R10 fires.
		"cpu.hardware":               "goldfish",
		"system.product":             "sdk_gphone_x86",
		"system.device":              "generic_x86",
		"system.bootCount":           "12",
		"system.partitionBuildDates": "system 2024-08-09 · vendor 2024-08-09",
	}
	score := scoreDevice(values, nil)
	declaration := scoreAxisByCode(t, score, axisDeclaration)
	if declaration.Coverage >= 0.5 {
		t.Fatalf("declaration coverage = %v, this fixture needs a blind axis", declaration.Coverage)
	}
	if !score.Decisive {
		t.Fatalf("the emulator build must still be decisive: %+v", score.Caps)
	}
	if score.Band != bandD {
		t.Fatalf("band = %q, want D: R10 withholds the number, not the conclusion", score.Band)
	}
	if score.Value != nil {
		t.Fatalf("value = %d, want null under R10", *score.Value)
	}
}

// The behavior axis must account for every profile label: each one is either priced in
// behaviorScoreTable or named in behaviorDisplayOnlyLabels. Two labels were previously in
// neither list, so they vanished from the score without anyone deciding that — exactly the
// "keep the label, give it nowhere to go" state §13 F1 forbids. This test fails the moment
// a new profile label is added and dropped on the floor.
func TestScoreBehaviorAccountsForEveryLabel(t *testing.T) {
	labels := profileSignals(scoreFixture(map[string]string{}, nil))
	behavior := map[string]bool{}
	for _, code := range []string{"virtual_build_markers", "selinux_permissive",
		"debugger_attached", "hook_injection", "root_manager_visible", "multi_open",
		"rom_verification", "software_drm"} {
		behavior[code] = true
	}
	displayOnly := map[string]bool{}
	for _, code := range behaviorDisplayOnlyLabels {
		displayOnly[code] = true
	}
	priced := map[string]bool{}
	for _, rule := range behaviorScoreTable {
		priced[rule.Label] = true
	}
	for code := range behavior {
		if priced[code] && displayOnly[code] {
			t.Errorf("%q is both priced and display-only", code)
		}
		if !priced[code] && !displayOnly[code] {
			t.Errorf("%q is a behavior label with no decision: price it or name it in behaviorDisplayOnlyLabels", code)
		}
	}
	// Every priced label must actually exist in the profile, or the table is stale.
	for _, rule := range behaviorScoreTable {
		if _, ok := scoreLabelByCode(labels, rule.Label); !ok {
			t.Errorf("behaviorScoreTable prices %q, which the profile does not emit", rule.Label)
		}
	}
	for _, code := range behaviorDisplayOnlyLabels {
		if _, ok := scoreLabelByCode(labels, code); !ok {
			t.Errorf("behaviorDisplayOnlyLabels names %q, which the profile does not emit", code)
		}
	}
	// The decision is real: an L3 device is not penalised, so the clean MI 8 anchor keeps
	// its 100. Pricing software_drm would drop it and break the negative control.
	mi8Values, mi8Statuses := mi8Evidence()
	mi8 := scoreDevice(mi8Values, mi8Statuses)
	if *mi8.Value != 100 || mi8.Band != bandA {
		t.Fatalf("MI 8 = %d/%q, want 100/A", *mi8.Value, mi8.Band)
	}
	// And the display-only labels must not quietly enter the coverage denominator: the
	// behavior axis is 6-based, so a fully-answering report reads 1.0, not 0.75.
	full := scoreDevice(map[string]string{
		"environment.hookSignals":        "none",
		"environment.rootMountHints":     "none",
		"environment.rootManagerVisible": "none",
		"environment.userProfile":        "owner",
		"system.selinux":                 "Enforcing（强制模式）",
		"app.debuggerConnected":          "否",
		"environment.tracerPid":          "0",
		"cpu.hardware":                   "qcom",
		"system.product":                 "dipper",
		"system.device":                  "dipper",
	}, nil)
	if got := scoreAxisByCode(t, full, axisBehavior); got.Coverage != 1 {
		t.Fatalf("behavior coverage = %v, want 1 (six priced labels, all answered)", got.Coverage)
	}
}

// A SKU-only identity split is a different finding from an app-uid model/device split.
// On the Pixel 6 the shell and the app uid report different SKUs by design, so pricing
// this as decisive would flag an honest device — §6.3 exists specifically to argue that
// SKU must not be decisive. The branch has to be chosen by which pair disagreed.
func TestScoreSkuOnlyIdentityIsNotDecisive(t *testing.T) {
	values := map[string]string{
		// model and device pairs agree on both sides; only the SKU pair disagrees.
		"system.model":                   "23078PND5G",
		"system.propertyModel":           "23078PND5G",
		"system.device":                  "corot",
		"system.propertyDevice":          "corot",
		"system.api":                     "34",
		"system.sku":                     "GR1YH",
		"system.hardwareSku":             "23078PND5G",
		"cpu.hardware":                   "qcom",
		"system.product":                 "corot",
		"memory.totalRam":                "12.00 GiB",
		"memory.physicalRam":             "12.00 GiB",
		"memory.kernelMemTotal":          "7.44 GiB",
		"system.selinux":                 "Enforcing（强制模式）",
		"app.debuggerConnected":          "否",
		"environment.tracerPid":          "0",
		"environment.hookSignals":        "none",
		"environment.rootMountHints":     "none",
		"environment.rootManagerVisible": "none",
		"environment.userProfile":        "owner",
		"system.bootCount":               "56",
		"system.partitionBuildDates":     "system 2024-08-09 · vendor 2024-08-09",
	}
	score := scoreDevice(values, nil)
	declaration := scoreAxisByCode(t, score, axisDeclaration)
	identity := scoreDeductionsFor(declaration, "identity_conflict")
	if len(identity) != 1 {
		t.Fatalf("identity deductions = %+v, want exactly one", identity)
	}
	if identity[0].Code != "IDENTITY_SKU" {
		t.Fatalf("deduction code = %q, want IDENTITY_SKU", identity[0].Code)
	}
	if identity[0].Points != 15 {
		t.Fatalf("points = %d, want 15 (not the 25-point app-uid branch)", identity[0].Points)
	}
	if !containsString(identity[0].Keys, "system.sku") ||
		!containsString(identity[0].Keys, "system.hardwareSku") {
		t.Fatalf("keys = %v, want the SKU pair", identity[0].Keys)
	}
	// The ledger must not claim an app-uid branch it did not take.
	if score.Decisive {
		t.Fatalf("a SKU-only split must not be decisive: %+v", score.Caps)
	}
	if score.Band == bandD {
		t.Fatalf("band = %q: SKU-only must not cap at D", score.Band)
	}
}

// identity_conflict is decisive only because every pair it compares is an app-uid read
// against the declaration. Lock that down: a conflict caps the band at D.
func TestScoreIdentityConflictIsDecisive(t *testing.T) {
	values := map[string]string{
		"system.model":                      "MI 8",
		"system.propertyModel":              "23078PND5G",
		"system.api":                        "34",
		"cpu.hardware":                      "qcom",
		"system.product":                    "dipper",
		"system.device":                     "dipper",
		"environment.overlayDeviceCodename": "dipper",
		"memory.totalRam":                   "5.50 GiB",
		"memory.physicalRam":                "5.50 GiB",
		"memory.kernelMemTotal":             "5.50 GiB",
		"system.selinux":                    "Enforcing（强制模式）",
		"app.debuggerConnected":             "否",
		"environment.tracerPid":             "0",
		"environment.hookSignals":           "none",
		"environment.rootMountHints":        "none",
		"environment.rootManagerVisible":    "none",
		"environment.userProfile":           "owner",
		"system.bootCount":                  "56",
		"system.partitionBuildDates":        "system 2021-10-28 · vendor 2021-10-28",
	}
	score := scoreDevice(values, nil)
	declaration := scoreAxisByCode(t, score, axisDeclaration)
	identity := scoreDeductionsFor(declaration, "identity_conflict")
	if len(identity) != 1 || identity[0].Code != "IDENTITY_APP_UID" {
		t.Fatalf("identity deduction = %+v", identity)
	}
	if !containsString(identity[0].Keys, "system.model") || !containsString(identity[0].Keys, "system.propertyModel") {
		t.Fatalf("identity keys = %v", identity[0].Keys)
	}
	if score.Band != bandD || !score.Decisive {
		t.Fatalf("band = %q decisive=%v, want D/true", score.Band, score.Decisive)
	}
}

// The "aged ROM" boundary must be a window relative to capture time, not a hardcoded
// year. A fixed 2021 stops firing as time passes (a 2023 partition on a 2026 report is
// also "at least three years old") and starts firing on devices that were merely sampled
// early. Same partition, same boot count, different capture dates, different verdicts.
func TestScoreUsageAgedRomIsRelativeToCapture(t *testing.T) {
	values := map[string]string{
		"system.bootCount":           "2",
		"system.partitionBuildDates": "system 2021-10-28 · vendor 2021-10-28",
	}
	millis := func(year, month, day int) int64 {
		return time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC).UnixMilli()
	}
	cases := []struct {
		name       string
		capturedAt int64
		aged       bool
	}{
		// Captured days after the build: nothing is aged, so no deduction.
		{"captured in 2021", millis(2021, 11, 1), false},
		// Two years later: still inside the window.
		{"captured in 2023", millis(2023, 11, 1), false},
		// Three years later: the window closes exactly here.
		{"captured in 2024", millis(2024, 11, 1), true},
		// Long after: still aged, and it must not silently stop firing.
		{"captured in 2028", millis(2028, 11, 1), true},
	}
	for _, c := range cases {
		score := buildDeviceScore(scoreFixture(values, nil),
			profileSignals(scoreFixture(values, nil)), c.capturedAt)
		usage := scoreAxisByCode(t, score, axisUsage)
		fired := len(usage.Deductions) > 0
		if fired != c.aged {
			t.Errorf("%s: fired=%v, want %v (cutoff year %d)",
				c.name, fired, c.aged, usageAgedRomCutoff(c.capturedAt))
		}
	}
	// A partition that is genuinely recent never fires, however old the capture is.
	recent := map[string]string{
		"system.bootCount":           "2",
		"system.partitionBuildDates": "system 2024-08-09 · vendor 2024-08-09",
	}
	score := buildDeviceScore(scoreFixture(recent, nil), profileSignals(scoreFixture(recent, nil)),
		millis(2026, 11, 25))
	if usage := scoreAxisByCode(t, score, axisUsage); len(usage.Deductions) != 0 {
		t.Fatalf("a two-year-old ROM fired: %+v", usage.Deductions)
	}
	// No capture time at all keeps the historical fixed boundary, so archived reports do
	// not flip their verdict when the window became relative.
	if got := usageAgedRomCutoff(0); got != usageAgedRomFallbackYear {
		t.Fatalf("fallback cutoff = %d, want %d", got, usageAgedRomFallbackYear)
	}
}

// usage v1: an old ROM that has barely been booted contradicts itself.
func TestScoreUsageFreshBootOnAgedRom(t *testing.T) {
	values := map[string]string{
		"system.bootCount":           "2",
		"system.partitionBuildDates": "system 2021-10-28 · vendor 2021-10-28",
		"system.initialSdk":          "27",
	}
	score := scoreDevice(values, nil)
	usage := scoreAxisByCode(t, score, axisUsage)
	if len(usage.Deductions) != 1 || usage.Deductions[0].Code != "FRESH_BOOT_ON_AGED_ROM" {
		t.Fatalf("usage deduction = %+v", usage.Deductions)
	}
	if usage.Deductions[0].Points != 12 || axisScoreOf(t, usage) != 88 {
		t.Fatalf("usage = %d with %+v, want 88 / 12 points", axisScoreOf(t, usage), usage.Deductions[0])
	}
	if !containsString(usage.Deductions[0].Keys, "system.initialSdk") {
		t.Fatalf("initialSdk should be cited when archived: %v", usage.Deductions[0].Keys)
	}
	// A recent ROM is not a contradiction even on a barely-booted device.
	recent := scoreDevice(map[string]string{
		"system.bootCount":           "2",
		"system.partitionBuildDates": "system 2024-08-09 · vendor 2024-08-09",
	}, nil)
	if got := scoreAxisByCode(t, recent, axisUsage); len(got.Deductions) != 0 {
		t.Fatalf("recent ROM deducted: %+v", got.Deductions)
	}
}

// usage coverage follows its derived label, not its raw field count. The label is
// FRESH_BOOT_ON_AGED_ROM and it needs a boot count AND a generation signal; one alone
// answers nothing. Counting one of two fields as half the axis made coverage exactly 0.5,
// which is R7's floor, so the half-read axis passed the gate and contributed an unearned
// 100 — enough to lift a C to a B on unchanged evidence.
//
// Since U2 landed there are two generation signals (partition dates, shipping SDK), so a
// boot-only report names *both* of them as gaps. Naming only one would imply the other was
// checked and agreed, which is the same silent-omission bug PROFILE_UNSET was added for.
func TestScoreUsageCoverage(t *testing.T) {
	bootOnly := scoreDevice(map[string]string{"system.bootCount": "56"}, nil)
	usage := scoreAxisByCode(t, bootOnly, axisUsage)
	if usage.Coverage != 0 {
		t.Fatalf("boot-only coverage = %v, want 0: one field cannot decide the label", usage.Coverage)
	}
	if usage.Score != nil {
		t.Fatalf("a half-read usage axis must not publish a score: %d", *usage.Score)
	}
	gaps := scoreUndeterminedForAxis(bootOnly, axisUsage)
	for _, want := range []string{"system.partitionBuildDates", "system.initialSdk"} {
		found := false
		for _, gap := range gaps {
			if containsString(gap.Keys, want) {
				found = true
			}
		}
		if !found {
			t.Fatalf("boot-only gaps = %+v, want %s named", gaps, want)
		}
	}

	empty := scoreDevice(map[string]string{"system.partitionBuildDates": "system 2021-10-28"}, nil)
	usage = scoreAxisByCode(t, empty, axisUsage)
	if usage.Coverage != 0 {
		t.Fatalf("date-only coverage = %v, want 0", usage.Coverage)
	}
	// Since U2 there are two generation signals, so a date-only report names the boot count
	// and the missing SDK — the SDK gap is real even though the date alone would suffice.
	dateGaps := scoreUndeterminedForAxis(empty, axisUsage)
	if !containsString(append(dateGaps[0].Keys, dateGaps[len(dateGaps)-1].Keys...), "system.bootCount") {
		t.Fatalf("date-only gaps = %+v, want system.bootCount named", dateGaps)
	}

	// Both rows present: the label is decidable and the axis is fully covered.
	both := scoreDevice(map[string]string{
		"system.bootCount":           "56",
		"system.partitionBuildDates": "system 2024-08-09 · vendor 2024-08-09",
	}, nil)
	if got := scoreAxisByCode(t, both, axisUsage); got.Coverage != 1 {
		t.Fatalf("both-rows coverage = %v, want 1", got.Coverage)
	}

	none := scoreDevice(nil, nil)
	if got := scoreAxisByCode(t, none, axisUsage); got.Coverage != 0 {
		t.Fatalf("empty usage coverage = %v, want 0", got.Coverage)
	}
}

// The P2 regression, as a band: unchanged evidence where a half-read usage axis used to
// lift the total across the C/B line. Everything except usage is fully readable, so the
// only thing keeping the total honest is usage being excluded rather than counted as 100.
func TestScoreUsageHalfReadDoesNotLiftTheBand(t *testing.T) {
	values := map[string]string{
		// declaration: a 30-point RAM dispersion conflict, other two branches clean.
		"memory.totalRam": "12.00 GiB", "memory.physicalRam": "12.00 GiB",
		"memory.kernelMemTotal":             "7.44 GiB",
		"system.model":                      "23078PND5G",
		"system.propertyModel":              "23078PND5G",
		"system.device":                     "corot",
		"system.propertyDevice":             "corot",
		"system.sku":                        "GR1YH",
		"system.hardwareSku":                "GR1YH",
		"environment.overlayDeviceCodename": "corot",
		// behavior: hook + debugger fire, the other four channels answer clean.
		"environment.hookSignals":        "frida",
		"app.debuggerConnected":          "是",
		"environment.tracerPid":          "1234",
		"system.selinux":                 "Enforcing（强制模式）",
		"environment.rootMountHints":     "none",
		"environment.rootManagerVisible": "none",
		"environment.userProfile":        "owner",
		"cpu.hardware":                   "qcom",
		"system.product":                 "corot",
		// usage: boot count only, so the label cannot be decided.
		"system.bootCount": "2",
	}
	score := scoreDevice(values, nil)
	usage := scoreAxisByCode(t, score, axisUsage)
	if usage.Coverage != 0 {
		t.Fatalf("usage coverage = %v, want 0 (only bootCount is readable)", usage.Coverage)
	}
	if score.Value == nil {
		t.Fatalf("the other two axes are fully readable: %+v", score.Undetermined)
	}
	// Excluding usage means averaging over 75 rather than 100. With usage wrongly counted
	// as a full-coverage 100 the total would clear the B floor; excluding it must not.
	if score.Band == bandA {
		t.Fatalf("band = %q: a report with deductions cannot be %q", score.Band, bandA)
	}
	if *score.Value >= 85 {
		t.Fatalf("value = %d: the undecidable usage axis was counted as earned coverage", *score.Value)
	}
}

// The score is a projection of the labels: an unreadable archive must not produce a
// confident axis, and the three axis codes/weights are the wire contract.
func TestScoreContractShape(t *testing.T) {
	values, statuses := pixel6Evidence()
	score := scoreDevice(values, statuses)
	if len(score.Axes) != 3 {
		t.Fatalf("axes = %d, want 3", len(score.Axes))
	}
	want := []struct {
		code   string
		label  string
		weight int
	}{
		{axisDeclaration, "声明一致性", 40},
		{axisBehavior, "行为风险", 35},
		{axisUsage, "使用真实性", 25},
	}
	for i, axis := range score.Axes {
		if axis.Code != want[i].code || axis.Label != want[i].label || axis.Weight != want[i].weight {
			t.Errorf("axis %d = %+v, want %+v", i, axis, want[i])
		}
	}
	raw, err := json.Marshal(score)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"version":"` + scoreVersion + `"`, `"value":`, `"band":`, `"bandLabel":`,
		`"coverage":`, `"coverageLabel":`, `"decisive":`, `"axes":`, `"caps":`, `"undetermined":`} {
		if !strings.Contains(string(raw), key) {
			t.Errorf("score JSON is missing %s: %s", key, raw)
		}
	}
	// An empty archive is honest: no number, and every gap is named.
	empty := scoreDevice(nil, nil)
	if empty.Value != nil || empty.Band != bandUnknown {
		t.Fatalf("empty archive = %v/%q", empty.Value, empty.Band)
	}
	if len(empty.Undetermined) == 0 {
		t.Fatal("empty archive must name its gaps")
	}
	for _, axis := range empty.Axes {
		if axis.Coverage != 0 {
			t.Errorf("axis %s coverage on an empty archive = %v", axis.Code, axis.Coverage)
		}
	}
}

// The foreign-profile probe must not claim a decisive branch when the conflict came
// from another channel, and must claim it when it did.
func TestScoreForeignProfileAttribution(t *testing.T) {
	values, statuses := pixel6Evidence()
	parameters := scoreFixture(values, statuses)
	labels := profileSignals(parameters)
	hardware, _ := scoreLabelByCode(labels, "hardware_declaration_conflict")
	foreign, keys := foreignProfileAttribution(hardware)
	if !foreign {
		t.Fatal("the Pixel 6 evidence carries a foreign capacity/cma profile")
	}
	if len(keys) != 2 {
		t.Fatalf("both measured channels identify the other SoC: %v", keys)
	}

	// A RAM-dispersion conflict alone is a real hit but not a foreign-profile one.
	plain := profileSignals(scoreFixture(map[string]string{
		"memory.totalRam": "12.00 GiB", "memory.physicalRam": "12.00 GiB",
		"memory.kernelMemTotal": "7.44 GiB",
	}, nil))
	hardware, _ = scoreLabelByCode(plain, "hardware_declaration_conflict")
	if hardware.State != "hit" {
		t.Fatalf("RAM dispersion must still be a conflict: %+v", hardware)
	}
	if foreign, keys := foreignProfileAttribution(hardware); foreign {
		t.Fatalf("RAM dispersion is not a foreign profile: %v", keys)
	}

	// A stock MI 8 answers no foreign channel.
	mi8Values, mi8Statuses := mi8Evidence()
	mi8Labels := profileSignals(scoreFixture(mi8Values, mi8Statuses))
	hardware, _ = scoreLabelByCode(mi8Labels, "hardware_declaration_conflict")
	if foreign, keys := foreignProfileAttribution(hardware); foreign {
		t.Fatalf("MI 8 must not look foreign: %v", keys)
	}
}

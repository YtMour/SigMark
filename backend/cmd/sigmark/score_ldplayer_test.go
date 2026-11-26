package main

import (
	"strings"
	"testing"
)

// The LDPlayer 9 capture that exposed the two defects this file locks down.
//
// Report 6642e350-389d-4d5d-8371-663bb5eb9e54, field set 25, collector 1.21.2, captured
// 2026-11-26T07:29:40Z. Every value below is copied from the archive — nothing is invented,
// because the whole point is that the *measured* shape is what broke:
//
//	band D, decisive, coverage 0.73, value null
//	declaration 0.33 (blind, nothing found), behavior 1.00 (35 + 15), usage 1.00 (12)
//
// The declaration axis is blind because none of its three units could answer: no
// `system.socModel`, no `cpu.cpuCapacity`, no `memory.cmaTotal` (so the hardware label never
// completes), no SKU pair, and no overlay codename. It is *not* below the coverage floor
// overall, which is why the missing `value` was a bug rather than R8 doing its job.
//
// Keys the label layer cannot read (display, battery, network, media, sensors, cellular,
// runtime) are omitted: they feed no label, so they cannot move the score. The groups that
// do feed labels are complete, including the UNAVAILABLE rows, because a missing row and a
// rejected read are different evidence.
func ldPlayerCapture() (map[string]string, map[string]string) {
	values := map[string]string{
		// --- declaration: a realme shape the emulator chose for itself ---
		"system.model":           "RMX5010",
		"system.propertyModel":   "RMX5010",
		"system.device":          "unicorn",
		"system.propertyDevice":  "unicorn",
		"system.product":         "RMX5010",
		"system.board":           "RMX5010",
		"system.brand":           "realme",
		"system.manufacturer":    "realme",
		"system.boardPlatform":   "aosp-user",
		"system.bootHardware":    "qcom",
		"system.socManufacturer": "AOSP",
		"system.api":             "34",
		"system.release":         "14",
		"system.patch":           "2024-02-05",
		"system.buildId":         "UQ1A.240205.06151050",
		"system.display":         "UQ1A.240205.06151050 release-keys",
		"system.type":            "user",
		"system.tags":            "release-keys",
		// --- behavior ---
		"cpu.hardware":        "qcom",
		"cpu.cores":           "2",
		"cpu.coresConfigured": "2",
		// The host CPU, passed through verbatim: this is a /proc read, not a property the
		// emulator chose to rewrite.
		"cpu.cpuInfo": "AMD Ryzen 9 9950X 16-Core Processor",
		"cpu.arch":    "x86_64",
		// The hardware label's own readable channels. These are why the declaration axis
		// reaches 1/3 rather than 0/3: the label can answer "no conflict" on the strength of
		// the RAM dispersion and the GL renderer, even with no SoC profile to compare.
		"memory.totalRam":                "1.94 GiB",
		"memory.physicalRam":             "1.94 GiB",
		"memory.kernelMemTotal":          "1.94 GiB",
		"runtime.glesRenderer":           "Adreno (TM) 750",
		"system.selinux":                 "Permissive（宽容模式）",
		"system.selinuxEvidence":         "exact",
		"system.selinuxPolicy":           "可打开（未读取内容）",
		"system.selinuxBootHint":         "permissive",
		"app.debuggerConnected":          "否",
		"environment.tracerPid":          "0",
		"environment.hookSignals":        "none",
		"environment.rootMountHints":     "none",
		"environment.rootManagerVisible": "none",
		"environment.userProfile":        "owner",
		"environment.selinuxDomain":      "untrusted_app",
		"environment.buildDebuggable":    "开启",
		"environment.buildSignals":       "user · release-keys",
		"environment.systemDebuggable":   "user / release-keys（标准量产构建类型）",
		"environment.drmSecurityLevel":   "L3",
		"environment.keyguardSecure":     "否",
		// --- usage: the second defect ---
		"system.bootCount": "2",
		// Android 9 generation on an android-14 image. On a phone that is the U2 shape; on
		// an emulator it is how `ro.product.first_api_level` is defined to behave.
		"system.initialSdk": "28",
		"system.partitionBuildDates": "system 2026-06-15 · vendor 2026-06-15 · " +
			"odm 2026-06-15 · system_ext 2026-06-15 · bootimage 2026-06-15",
		"system.uptime": "0 天 0 小时 39 分钟",
	}
	statuses := map[string]string{
		// The three unreadable declaration units.
		"system.socModel":                   "UNAVAILABLE",
		"cpu.cpuCapacity":                   "UNAVAILABLE",
		"cpu.cpuParts":                      "UNAVAILABLE",
		"cpu.features":                      "UNAVAILABLE",
		"memory.cmaTotal":                   "UNAVAILABLE",
		"system.hardwareSku":                "UNAVAILABLE",
		"system.sku":                        "UNAVAILABLE",
		"environment.overlayDeviceCodename": "UNAVAILABLE",
		"environment.overlayEvidence":       "UNAVAILABLE",
		// Unreadable behavior rows: they must not complete a negative.
		"environment.verityMode":   "UNAVAILABLE",
		"environment.verifiedBoot": "UNAVAILABLE",
		"environment.vbmetaState":  "UNAVAILABLE",
		"environment.flashLock":    "UNAVAILABLE",
		"system.selinuxBuildHint":  "UNAVAILABLE",
		"system.romHint":           "UNAVAILABLE",
		"system.baseOs":            "UNAVAILABLE",
		"system.bootloader":        "UNAVAILABLE",
		"system.vendorSpl":         "UNAVAILABLE",
	}
	return values, statuses
}

// ldPlayerCapturedAt is the archive's own capture time. Kept exact so the three-year window
// is computed the way the live run computed it (cutoff 2023, SDK 28 → 2018), rather than
// hardcoded into the fixture.
const ldPlayerCapturedAt = int64(1795678180782)

func scoreFixtureAt(values, statuses map[string]string, capturedAt int64) deviceScore {
	parameters := scoreFixture(values, statuses)
	return buildDeviceScore(parameters, profileSignals(parameters), capturedAt)
}

func scoreLdPlayer() deviceScore {
	values, statuses := ldPlayerCapture()
	return scoreFixtureAt(values, statuses, ldPlayerCapturedAt)
}

// Defect 1, as measured: the report was decisive *and* its declaration axis was blind, and
// the two together dropped `value` even though overall coverage was 0.73. `band=D` already
// carries the conclusion, so the number is the only thing left that a reviewer can use —
// "how much was deducted", and which of two D devices is worse.
//
// The number must also be recomputable from what is printed, which is why the blind axis
// publishes no score: R7 kept it out of the average, so leaving a 100 on it would make the
// three visible axis scores disagree with the published value (82.75 vs 71 here).
func TestScoreDecisiveKeepsItsValueWhenTheDeclarationAxisIsBlind(t *testing.T) {
	score := scoreLdPlayer()
	if !score.Decisive {
		t.Fatalf("the LDPlayer capture must stay decisive: caps = %+v", score.Caps)
	}
	if score.Band != bandD {
		t.Fatalf("band = %q, want D", score.Band)
	}
	if score.Coverage < scoreCoverageFloor {
		t.Fatalf("coverage = %v: this fixture is meant to be above the floor, so R8 is not "+
			"what withholds anything here", score.Coverage)
	}
	declaration := scoreAxisByCode(t, score, axisDeclaration)
	if declaration.Coverage >= scoreCoverageFloor || len(declaration.Deductions) > 0 {
		t.Fatalf("declaration coverage = %v with %d deductions: the premise of this test is "+
			"a blind declaration axis", declaration.Coverage, len(declaration.Deductions))
	}
	if score.Value == nil {
		t.Fatal("value = null on a decisive report above the coverage floor: the band is " +
			"already the conclusion, and withholding the number leaves a reviewer unable to " +
			"see how much was deducted")
	}
	// 35×(100−50) + 25×(100−0), over the two axes that were counted.
	if got, want := *score.Value, 71; got != want {
		t.Fatalf("value = %d, want %d", got, want)
	}
	if declaration.Score != nil {
		t.Fatalf("declaration score = %d at coverage %v: an axis R7 excluded from the "+
			"average must not publish a score", *declaration.Score, declaration.Coverage)
	}
	if got := recomputeValue(t, score); got != *score.Value {
		t.Fatalf("published value = %d, recomputed from the printed axes = %d", *score.Value, got)
	}
}

// The other side of the same boundary: when the *whole* report is thin, R8 still withholds
// the number even though a decisive cap has fixed the band. Nothing above may be read as
// "decisive reports always publish a number".
func TestScoreDecisiveStillWithholdsTheNumberUnderTheCoverageFloor(t *testing.T) {
	// Only the two structural channels: decisive, and nothing else readable.
	values := map[string]string{
		"cpu.cpuInfo":          "AMD Ryzen 9 9950X 16-Core Processor",
		"system.boardPlatform": "aosp-user",
	}
	score := scoreFixtureAt(values, nil, ldPlayerCapturedAt)
	if !score.Decisive {
		t.Fatalf("structural virtual evidence must be decisive: caps = %+v", score.Caps)
	}
	if score.Coverage >= scoreCoverageFloor {
		t.Fatalf("coverage = %v, this fixture needs to be under the floor", score.Coverage)
	}
	if score.Band != bandD {
		t.Fatalf("band = %q, want D: the conclusion does not need coverage to be true", score.Band)
	}
	if score.Value != nil {
		t.Fatalf("value = %d, want null: R8 still withholds the number when the report is "+
			"too thin to have earned one", *score.Value)
	}
}

// A published value must be reproducible from the published axes, for every fixture this
// package ships. This is the property that made the fix non-optional: the old document
// printed `value: null` next to three computed axis scores, so a reviewer could neither
// recompute the number nor explain its absence.
func TestScoreDecisiveValueIsRecomputableFromThePrintedAxes(t *testing.T) {
	pixelValues, pixelStatus := pixel6Evidence()
	mi8Values, mi8Status := mi8Evidence()
	emulatorValues, emulatorStatus := emulatorEvidence()
	ldValues, ldStatus := ldPlayerCapture()
	for _, c := range []struct {
		name       string
		values     map[string]string
		status     map[string]string
		capturedAt int64
	}{
		{"pixel6", pixelValues, pixelStatus, 0},
		{"mi8", mi8Values, mi8Status, 0},
		{"emulator", emulatorValues, emulatorStatus, 0},
		{"ldplayer", ldValues, ldStatus, ldPlayerCapturedAt},
	} {
		score := scoreFixtureAt(c.values, c.status, c.capturedAt)
		for _, axis := range score.Axes {
			// A published score and an entered average are the same set. The only axes
			// allowed to print nothing are the ones R7 dropped.
			excluded := axis.Coverage < scoreCoverageFloor && len(axis.Deductions) == 0
			if (axis.Score == nil) != excluded {
				t.Errorf("%s/%s: score published = %v, excluded from the average = %v "+
					"(coverage %v, %d deductions)", c.name, axis.Code,
					axis.Score != nil, excluded, axis.Coverage, len(axis.Deductions))
			}
		}
		if score.Value == nil {
			continue
		}
		if got := recomputeValue(t, score); got != *score.Value {
			t.Errorf("%s: published value = %d, recomputed from the printed axes = %d",
				c.name, *score.Value, got)
		}
	}
}

// Every axis score must equal its own ledger: clamp(100 − Σpoints, 0, 100). This caught the
// third defect the replay exposed — the structural channel appended its 35-point deduction
// *after* the axis had been finalized, so the LDPlayer report printed a 35-point deduction
// next to an axis score of 85 (= 100 − 15) and a total of 91 that matched neither.
//
// It is written as a sweep over every fixture rather than a single case because the failure
// mode is "some branch appends after the sum", which is invisible from any one branch.
func TestScoreDecisiveAxisScoreMatchesItsOwnLedger(t *testing.T) {
	pixelValues, pixelStatus := pixel6Evidence()
	mi8Values, mi8Status := mi8Evidence()
	emulatorValues, emulatorStatus := emulatorEvidence()
	ldValues, ldStatus := ldPlayerCapture()
	for _, c := range []struct {
		name       string
		values     map[string]string
		status     map[string]string
		capturedAt int64
	}{
		{"pixel6", pixelValues, pixelStatus, 0},
		{"mi8", mi8Values, mi8Status, 0},
		{"emulator", emulatorValues, emulatorStatus, 0},
		{"ldplayer", ldValues, ldStatus, ldPlayerCapturedAt},
	} {
		score := scoreFixtureAt(c.values, c.status, c.capturedAt)
		for _, axis := range score.Axes {
			sum := 0
			for _, deduction := range axis.Deductions {
				sum += deduction.Points
			}
			want := 100 - sum
			if want < 0 {
				want = 0
			}
			if got := axisScoreOf(t, axis); got != want {
				t.Errorf("%s/%s: score = %d but its ledger sums to %d points, so it should be "+
					"%d; deductions = %+v", c.name, axis.Code, got, sum, want, axis.Deductions)
			}
		}
	}
}

// Defect 2, as measured: `initialSdk` 28 against an android-14 image with bootCount 2.
//
// On a phone that is the U2 shape — a new boot on an old-generation device, which is what a
// ROM flash looks like. On an emulator it is the documented definition of the field: an AVD
// carries `ro.product.first_api_level` from the system image it was built from, and a fresh
// instance starts at bootCount 1–2. Charging 12 points for it prices the emulator twice for
// one fact, since the behaviour axis already charges 35 decisively for the same discovery.
func TestUsageFreshBootIsSuppressedOnAConfirmedVirtualDevice(t *testing.T) {
	score := scoreLdPlayer()
	usage := scoreAxisByCode(t, score, axisUsage)
	if got := scoreDeductionsByCode(usage, "FRESH_BOOT_ON_AGED_ROM"); len(got) != 0 {
		t.Fatalf("the emulator was charged for its own image: %+v", got)
	}
	// Suppressing the *price* must not suppress the *reading*: the axis was decidable, and
	// saying otherwise would turn a known emulator into a report we claim we could not read.
	if usage.Coverage != 1 {
		t.Fatalf("usage coverage = %v, want 1: the signal was readable, it just was not "+
			"charged", usage.Coverage)
	}
	if got := axisScoreOf(t, usage); got != 100 {
		t.Fatalf("usage score = %d, want 100: nothing was deducted", got)
	}
	if len(usage.Deductions) != 0 {
		t.Fatalf("usage deductions = %+v, want none", usage.Deductions)
	}
	// The device is still D, and still for the reason it was: the 35-point structural
	// channel plus the decisive cap. The suppression removed noise, not the finding.
	if !score.Decisive || score.Band != bandD {
		t.Fatalf("band = %q decisive = %v, want D/true", score.Band, score.Decisive)
	}
	behavior := scoreAxisByCode(t, score, axisBehavior)
	if got := scoreDeductionsByCode(behavior, "STRUCTURAL_VIRTUAL_EVIDENCE"); len(got) != 1 {
		t.Fatalf("structural evidence = %+v, want exactly one deduction", got)
	}
}

// The suppression is one-way. Identical usage readings on real hardware must be charged:
// this is the case U2 exists for, and a blanket "skip FRESH_BOOT on anything unusual" would
// have deleted it.
func TestUsageFreshBootStillFiresOnRealHardware(t *testing.T) {
	values := map[string]string{
		// A genuine handset: real SoC codename, real /proc cpuinfo.
		"cpu.cpuInfo":          "implementer 0x41 · part 0xd05 · architecture 8",
		"system.boardPlatform": "gs101",
		"cpu.hardware":         "tensor",
		"system.product":       "oriole",
		"system.device":        "oriole",
		// Exactly the LDPlayer usage readings.
		"system.bootCount":           "2",
		"system.initialSdk":          "28",
		"system.partitionBuildDates": "system 2026-06-15 · vendor 2026-06-15",
	}
	score := scoreFixtureAt(values, nil, ldPlayerCapturedAt)
	usage := scoreAxisByCode(t, score, axisUsage)
	deductions := scoreDeductionsByCode(usage, "FRESH_BOOT_ON_AGED_ROM")
	if len(deductions) != 1 {
		t.Fatalf("a real device with these usage readings must still be charged: %+v",
			usage.Deductions)
	}
	if deductions[0].Points != usageFreshBootPoints {
		t.Fatalf("points = %d, want %d", deductions[0].Points, usageFreshBootPoints)
	}
	if score.Decisive {
		t.Fatalf("this fixture must not be decisive, or it would not prove the usage rule "+
			"survives on its own: %+v", score.Caps)
	}
}

// The other virtual channel: the blocklist marker, not the structural contradiction. The
// suppression must key off "this device is known to be virtual", not off one particular
// way of discovering it.
func TestUsageFreshBootIsSuppressedByTheBuildMarkerChannelToo(t *testing.T) {
	values := map[string]string{
		"cpu.hardware":               "ranchu",
		"system.product":             "sdk_gphone64_x86_64",
		"system.device":              "emu64xa",
		"cpu.cpuInfo":                "implementer 0x41 · part 0xd05 · architecture 8",
		"system.boardPlatform":       "gs101",
		"system.bootCount":           "2",
		"system.initialSdk":          "28",
		"system.partitionBuildDates": "system 2026-06-15 · vendor 2026-06-15",
	}
	score := scoreFixtureAt(values, nil, ldPlayerCapturedAt)
	usage := scoreAxisByCode(t, score, axisUsage)
	if got := scoreDeductionsByCode(usage, "FRESH_BOOT_ON_AGED_ROM"); len(got) != 0 {
		t.Fatalf("a confirmed emulator was charged for its own image: %+v", got)
	}
	behavior := scoreAxisByCode(t, score, axisBehavior)
	if got := scoreDeductionsByCode(behavior, "VIRTUAL_BUILD_MARKERS"); len(got) != 1 {
		t.Fatalf("the marker channel must still price the emulator: %+v", behavior.Deductions)
	}
}

// Suppression is a pricing decision, not a decidability one: with and without virtual
// evidence, the usage axis must report the same coverage and the same gaps. If the
// suppression leaked into coverage it would quietly lower the overall coverage of every
// emulator and could push a report under the floor — a shape change dressed as a fix.
func TestUsageFreshBootSuppressionLeavesCoverageAndGapsAlone(t *testing.T) {
	real := map[string]string{
		"cpu.cpuInfo":                "implementer 0x41 · part 0xd05 · architecture 8",
		"system.boardPlatform":       "gs101",
		"system.bootCount":           "2",
		"system.initialSdk":          "28",
		"system.partitionBuildDates": "system 2026-06-15 · vendor 2026-06-15",
	}
	virtual := map[string]string{
		"cpu.cpuInfo":                "AMD Ryzen 9 9950X 16-Core Processor",
		"system.boardPlatform":       "aosp-user",
		"system.bootCount":           "2",
		"system.initialSdk":          "28",
		"system.partitionBuildDates": "system 2026-06-15 · vendor 2026-06-15",
	}
	realScore := scoreFixtureAt(real, nil, ldPlayerCapturedAt)
	virtualScore := scoreFixtureAt(virtual, nil, ldPlayerCapturedAt)
	realUsage := scoreAxisByCode(t, realScore, axisUsage)
	virtualUsage := scoreAxisByCode(t, virtualScore, axisUsage)
	if realUsage.Coverage != virtualUsage.Coverage {
		t.Fatalf("usage coverage moved with the suppression: %v vs %v",
			realUsage.Coverage, virtualUsage.Coverage)
	}
	realGaps, virtualGaps := scoreUndeterminedForAxis(realScore, axisUsage),
		scoreUndeterminedForAxis(virtualScore, axisUsage)
	if len(realGaps) != len(virtualGaps) {
		t.Fatalf("usage gaps moved with the suppression: %+v vs %+v", realGaps, virtualGaps)
	}
	for i := range realGaps {
		if realGaps[i].Reason != virtualGaps[i].Reason ||
			len(realGaps[i].Keys) != len(virtualGaps[i].Keys) {
			t.Fatalf("usage gap %d moved with the suppression: %+v vs %+v",
				i, realGaps[i], virtualGaps[i])
		}
	}
	// And the only thing that *did* change is the price.
	if len(scoreDeductionsByCode(realUsage, "FRESH_BOOT_ON_AGED_ROM")) != 1 {
		t.Fatalf("the real fixture lost its deduction: %+v", realUsage.Deductions)
	}
	if len(scoreDeductionsByCode(virtualUsage, "FRESH_BOOT_ON_AGED_ROM")) != 0 {
		t.Fatalf("the virtual fixture kept its deduction: %+v", virtualUsage.Deductions)
	}
}

// A gap with no keys is unreadable in the console: it says "something could not be read"
// and refuses to say what. The LDPlayer replay was reported as producing two of them, and
// they are worth locking down either way — the fallback in scoreUndeterminedFor is
// `scoreAvailableKeys(label)`, which returns an empty slice when a label archived no
// evidence at all, so the guard is one refactor away from being reachable.
//
// This sweeps every fixture in the package rather than the one report: the contract is
// "every gap names at least one key", not "this capture happened to".
func TestScoreUndeterminedAlwaysNamesAtLeastOneKey(t *testing.T) {
	pixelValues, pixelStatus := pixel6Evidence()
	mi8Values, mi8Status := mi8Evidence()
	emulatorValues, emulatorStatus := emulatorEvidence()
	ldValues, ldStatus := ldPlayerCapture()
	// A capture with almost nothing archived, which is where the fallback is thinnest.
	empty := map[string]string{}
	for _, c := range []struct {
		name       string
		values     map[string]string
		status     map[string]string
		capturedAt int64
	}{
		{"pixel6", pixelValues, pixelStatus, 0},
		{"mi8", mi8Values, mi8Status, 0},
		{"emulator", emulatorValues, emulatorStatus, 0},
		{"ldplayer", ldValues, ldStatus, ldPlayerCapturedAt},
		{"empty", empty, nil, ldPlayerCapturedAt},
		{"empty-no-clock", empty, nil, 0},
	} {
		score := scoreFixtureAt(c.values, c.status, c.capturedAt)
		for _, gap := range score.Undetermined {
			if len(gap.Keys) == 0 {
				t.Errorf("%s: undetermined gap with no keys: %+v — the console cannot render "+
					"this, and the reader cannot tell which channel was missing", c.name, gap)
			}
			for _, key := range gap.Keys {
				if strings.TrimSpace(key) == "" {
					t.Errorf("%s: undetermined gap names an empty key: %+v", c.name, gap)
				}
			}
			if gap.Reason == "" {
				t.Errorf("%s: undetermined gap has no reason: %+v", c.name, gap)
			}
		}
	}
}

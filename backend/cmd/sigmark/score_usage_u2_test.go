package main

import (
	"strings"
	"testing"
	"time"
)

// U2: the shipping SDK level as a generation signal (sigmark-score/2).
//
// Why this rule exists at all, given U1 already reads partition dates:
// `partitionBuildDates` describes the *image*. An attacker who flashes a current ROM makes
// it current. `initialSdk` describes the *device* — it is written at manufacture and
// reports the API level the hardware shipped with. A 2017 phone running a 2024 image still
// reports sdk 27. So U1 is spoofable by flashing and U2 is not, which is exactly why the
// two are separate paths rather than one averaged signal.

// scoreAt projects a fixture with an explicit capture time, so the three-year window is
// computed rather than hardcoded and these tests do not rot as the calendar advances.
func scoreAt(values map[string]string, capturedYear int) deviceScore {
	parameters := scoreFixture(values, nil)
	capturedAt := time.Date(capturedYear, 6, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	return buildDeviceScore(parameters, profileSignals(parameters), capturedAt)
}

func TestUsageSdkYearTable(t *testing.T) {
	// Every level the table claims must resolve to a year, and the table must be
	// monotonic: a higher SDK can never map to an earlier year.
	previous := 0
	for sdk := 26; sdk <= 35; sdk++ {
		year, ok := usageSdkYear(intToString(sdk))
		if !ok {
			t.Fatalf("sdk %d is missing from usageSdkYears", sdk)
		}
		if year < previous {
			t.Fatalf("sdk %d maps to %d, earlier than sdk %d's %d", sdk, year, sdk-1, previous)
		}
		previous = year
	}
	// Levels outside the table must be reported as unknown, not as "new" and not as zero.
	for _, raw := range []string{"25", "36", "99", "", "abc", "unknown"} {
		if year, ok := usageSdkYear(raw); ok {
			t.Fatalf("usageSdkYear(%q) = %d, want not-ok", raw, year)
		}
	}
}

// The core U2 case: a device whose *image* is current but whose *device generation* is old,
// with almost no boots. This is the exact shape U1 cannot see — and the shape a ROM-flashing
// attacker produces.
func TestScoreUsageU2CatchesOldDeviceOnFreshImage(t *testing.T) {
	values := map[string]string{
		// A 2026 image: U1 sees nothing wrong.
		"system.partitionBuildDates": "system 2026-01-15 · vendor 2026-01-15",
		// A 2017-generation device.
		"system.initialSdk": "27",
		// Two boots on a decade-old phone.
		"system.bootCount": "2",
	}
	score := scoreAt(values, 2026)
	usage := scoreAxisByCode(t, score, axisUsage)

	got := scoreDeductionsByCode(usage, "FRESH_BOOT_ON_AGED_ROM")
	if len(got) != 1 {
		t.Fatalf("deductions = %+v, want one FRESH_BOOT_ON_AGED_ROM", got)
	}
	if got[0].Points != usageFreshBootPoints {
		t.Fatalf("points = %d, want %d", got[0].Points, usageFreshBootPoints)
	}
	// The detail must say *why*: a reader who sees "old" needs to know it came from the
	// device generation, not the image.
	if !strings.Contains(got[0].Detail, "出厂 SDK") || !strings.Contains(got[0].Detail, "2017") {
		t.Fatalf("detail = %q, want it to name the shipping SDK year", got[0].Detail)
	}
}

// U1 must keep working unchanged. A fresh device generation with an old image date is still
// a hit, and when both signals are available U1's explanation wins because the partition
// date is the more direct evidence.
func TestScoreUsageU1StillFiresWhenTheImageIsOld(t *testing.T) {
	values := map[string]string{
		"system.partitionBuildDates": "system 2019-10-28",
		"system.initialSdk":          "33", // a 2022 device with an old image
		"system.bootCount":           "1",
	}
	usage := scoreAxisByCode(t, scoreAt(values, 2026), axisUsage)
	got := scoreDeductionsByCode(usage, "FRESH_BOOT_ON_AGED_ROM")
	if len(got) != 1 {
		t.Fatalf("deductions = %+v, want one", got)
	}
	if !strings.Contains(got[0].Detail, "分区最早建于") {
		t.Fatalf("detail = %q, want the partition-date explanation", got[0].Detail)
	}
}

// R2: one root cause, one hit. A device that is old in *both* senses must not be priced
// twice — the two signals describe the same contradiction (a near-unused device that is
// nonetheless old), so they share one deduction code and one price.
func TestScoreUsageU1AndU2DoNotDoubleCount(t *testing.T) {
	values := map[string]string{
		"system.partitionBuildDates": "system 2019-03-01",
		"system.initialSdk":          "27",
		"system.bootCount":           "0",
	}
	usage := scoreAxisByCode(t, scoreAt(values, 2026), axisUsage)
	got := scoreDeductionsByCode(usage, "FRESH_BOOT_ON_AGED_ROM")
	if len(got) != 1 {
		t.Fatalf("deductions = %+v, want exactly one: both signals are the same contradiction", got)
	}
	if got[0].Points != usageFreshBootPoints {
		t.Fatalf("points = %d, want %d (not doubled)", got[0].Points, usageFreshBootPoints)
	}
}

// A busy old device is not a contradiction. bootCount > 2 means the phone is in real use,
// which is the *opposite* of the signal — so U2 must not fire just because the SDK is old.
// This is the false-positive guard that matters most: most old phones in a fleet have a low
// SDK and a high boot count, and pricing them would make the whole score untrustworthy.
func TestScoreUsageU2RequiresFewBoots(t *testing.T) {
	values := map[string]string{
		"system.partitionBuildDates": "system 2026-01-15",
		"system.initialSdk":          "27", // 2017 generation
		"system.bootCount":           "56", // but heavily used
	}
	usage := scoreAxisByCode(t, scoreAt(values, 2026), axisUsage)
	if got := scoreDeductionsByCode(usage, "FRESH_BOOT_ON_AGED_ROM"); len(got) != 0 {
		t.Fatalf("a heavily used old device must not be priced: %+v", got)
	}
	// And it must still be decidable and clean, not gated out.
	if usage.Coverage != 1 {
		t.Fatalf("coverage = %v, want 1: both signals were readable", usage.Coverage)
	}
	if axisScoreOf(t, usage) != 100 {
		t.Fatalf("score = %d, want 100", axisScoreOf(t, usage))
	}
}

// A recent-generation device must not be priced either, however few boots it has. This is
// the "brand new phone, set up and barely used" case, which is completely normal.
//
// The capture year is 2024 here on purpose: the cutoff is captureYear−3 = 2021, so all of
// sdk 33/34/35 (2022/2023/2024) are recent. Sampling them in 2026 would legitimately price
// sdk 33 — that is the *point* of a relative window, and TestScoreUsageU2WindowIsRelative
// covers it. A test that pinned them as "never priced" would be asserting the window is
// broken.
func TestScoreUsageU2IgnoresRecentGenerations(t *testing.T) {
	for _, sdk := range []string{"33", "34", "35"} {
		values := map[string]string{
			"system.partitionBuildDates": "system 2024-01-15",
			"system.initialSdk":          sdk,
			"system.bootCount":           "1",
		}
		usage := scoreAxisByCode(t, scoreAt(values, 2024), axisUsage)
		if got := scoreDeductionsByCode(usage, "FRESH_BOOT_ON_AGED_ROM"); len(got) != 0 {
			t.Fatalf("sdk %s: a recent device with few boots must not be priced: %+v", sdk, got)
		}
	}
}

// The window is relative, not a fixed year. The same device must flip as the capture year
// advances: sdk 33 (2022) is current in 2024 but aged in 2026. A hardcoded boundary would
// pass one of these and fail the other.
func TestScoreUsageU2WindowIsRelativeToCapture(t *testing.T) {
	values := map[string]string{
		"system.partitionBuildDates": "system 2026-01-15",
		"system.initialSdk":          "33", // 2022
		"system.bootCount":           "1",
	}
	if got := scoreDeductionsByCode(scoreAxisByCode(t, scoreAt(values, 2024), axisUsage),
		"FRESH_BOOT_ON_AGED_ROM"); len(got) != 0 {
		t.Fatalf("2022 generation sampled in 2024 is not aged yet: %+v", got)
	}
	if got := scoreDeductionsByCode(scoreAxisByCode(t, scoreAt(values, 2026), axisUsage),
		"FRESH_BOOT_ON_AGED_ROM"); len(got) != 1 {
		t.Fatalf("2022 generation sampled in 2026 is aged: %+v", got)
	}
}

// An SDK level outside the table is *unknown generation*, which is not the same as "new".
// It must be named as its own gap rather than silently treated as a clean signal — the
// whole point of the reason enum is that "we do not know" never renders as "fine".
func TestScoreUsageU2UnmappedSdkIsNamedNotAssumed(t *testing.T) {
	values := map[string]string{
		"system.partitionBuildDates": "system 2026-01-15",
		"system.initialSdk":          "36", // beyond the table
		"system.bootCount":           "1",
	}
	score := scoreAt(values, 2026)
	usage := scoreAxisByCode(t, score, axisUsage)
	if got := scoreDeductionsByCode(usage, "FRESH_BOOT_ON_AGED_ROM"); len(got) != 0 {
		t.Fatalf("an unmapped SDK must not produce a deduction: %+v", got)
	}
	// The partition date is still readable, so the axis stays decidable — but the SDK gap
	// must be published rather than dropped.
	found := false
	for _, gap := range score.Undetermined {
		if gap.Axis == axisUsage && gap.Reason == "UNMAPPED_SDK_LEVEL" &&
			containsString(gap.Keys, "system.initialSdk") {
			found = true
		}
	}
	if !found {
		t.Fatalf("an unmapped SDK level must be named in undetermined: %+v", score.Undetermined)
	}
}

// The version bump is itself a contract: a stale frontend must be able to tell that the
// thresholds it knows do not apply. This asserts the bump happened, so nobody can land a
// verdict change while leaving the version behind.
//
// It has been named after each bump so far (/2 U2, /3 one-sided identity, /4 structural
// virtual evidence, /5 the LDPlayer replay fixes) and it now carries the whole chain: the
// literal below is the *current* version, not the one the name remembers. Renaming it again
// on every bump would be noise; what matters is that changing the literal is a deliberate
// act that shows up in review next to the rule change that forced it.
func TestScoreVersionTracksVerdictChanges(t *testing.T) {
	if scoreVersion != "sigmark-score/5" {
		t.Fatalf("scoreVersion = %q, want sigmark-score/5: a decisive hit now publishes its "+
			"value, and FRESH_BOOT_ON_AGED_ROM is suppressed on a confirmed virtual device. "+
			"Both move archived reports", scoreVersion)
	}
	values, statuses := pixel6Evidence()
	score := scoreDevice(values, statuses)
	if score.Version != scoreVersion {
		t.Fatalf("projected version = %q, want %q", score.Version, scoreVersion)
	}
}

package main

import (
	"strings"
	"testing"
)

// PROFILE_UNSET (§13 F12) is the fifth undetermined reason and the only one that is not a
// field state. The other four answer "why could the app not read this"; this one answers
// "the app read it fine and our registry has nothing to compare it to".
//
// The distinction is not cosmetic. UNAVAILABLE tells an operator to go re-sample the
// device. PROFILE_UNSET tells them the capture is fine and the fix is to fill in
// `socProfiles`. Reporting the first when the second is true sends someone to re-run a
// test that will fail identically every time.

// unsetFixture is a registered SoC with a readable cpu.cpuCapacity, on a device whose
// registry entry deliberately has no capacities value. `sdm845` is the natural choice: it
// is registered (so `known` is true) and its capacities are empty by design, because the
// stock Mi 8 kernel exposes no cpu_capacity at all.
func unsetFixture() (map[string]string, map[string]string) {
	values := map[string]string{
		"app.debuggerConnected":          "否",
		"environment.tracerPid":          "0",
		"environment.hookSignals":        "none",
		"environment.rootMountHints":     "none",
		"environment.rootManagerVisible": "none",
		"environment.userProfile":        "owner",
		"system.selinux":                 "Enforcing（强制模式）",
		"environment.verityMode":         "enforcing",
		"environment.drmSecurityLevel":   "L1",
		// Declares Snapdragon 845 — registered, but with no capacities/cmaMiB.
		"cpu.hardware":               "qcom",
		"system.socModel":            "Snapdragon 845",
		"system.product":             "dipper",
		"system.device":              "dipper",
		"system.model":               "MI 8",
		"system.propertyModel":       "MI 8",
		"system.propertyDevice":      "dipper",
		"system.api":                 "29",
		"memory.totalRam":            "5.50 GiB",
		"memory.physicalRam":         "5.50 GiB",
		"memory.kernelMemTotal":      "5.50 GiB",
		"system.bootCount":           "56",
		"system.partitionBuildDates": "system 2021-10-28 · vendor 2021-10-28",
		// The two readings the registry has no expectation for. The values must match no
		// registered SoC: `160/498/1024` and `652 MiB` are gs101's, so using them here
		// would fire FOREIGN_PROFILE (correctly!) instead of reaching the unset arm.
		"cpu.cpuCapacity": "200/600/1000",
		"memory.cmaTotal": "300 MiB",
	}
	return values, nil
}

func TestScoreProfileUnsetIsItsOwnReason(t *testing.T) {
	values, statuses := unsetFixture()
	score := scoreDevice(values, statuses)

	reasons := map[string]bool{}
	for _, gap := range score.Undetermined {
		reasons[gap.Reason] = true
	}
	if !reasons[scoreReasonProfileUnset] {
		t.Fatalf("undetermined has no PROFILE_UNSET reason: %+v", score.Undetermined)
	}
	// It must not be filed under a field state: nothing was rejected or missing.
	for _, gap := range score.Undetermined {
		if gap.Reason == "UNAVAILABLE" || gap.Reason == "RESTRICTED" {
			t.Fatalf("a readable-but-unregistered value was reported as %q: %+v", gap.Reason, gap)
		}
	}
	// The keys must name the exact rows, not the whole label.
	var keys []string
	for _, gap := range score.Undetermined {
		if gap.Reason == scoreReasonProfileUnset {
			keys = gap.Keys
		}
	}
	want := map[string]bool{"cpu.cpuCapacity": true, "memory.cmaTotal": true}
	if len(keys) != len(want) {
		t.Fatalf("PROFILE_UNSET keys = %v, want exactly %v", keys, want)
	}
	for _, key := range keys {
		if !want[key] {
			t.Fatalf("PROFILE_UNSET keys = %v, want only %v", keys, want)
		}
	}
}

// The label state stays `insufficient`: an unset expectation really does mean the question
// was not answered. What changes is that the reason is now nameable.
func TestScoreProfileUnsetKeepsTheLabelInsufficient(t *testing.T) {
	values, statuses := unsetFixture()
	parameters := scoreFixture(values, statuses)
	labels := profileSignals(parameters)
	hardware, ok := scoreLabelByCode(labels, "hardware_declaration_conflict")
	if !ok {
		t.Fatal("hardware label missing")
	}
	// The state is `not_observed` here because ram_dispersion confirmed: the label's job is
	// to answer "is there a conflict?", and one confirming channel answers it. The unset
	// channel is a *separate* gap and is published separately — see the reason test.
	if hardware.State != "not_observed" {
		t.Fatalf("state = %q, want not_observed (ram_dispersion confirmed)", hardware.State)
	}
	// The basis must carry the unset channels *alongside* whatever settled the state.
	// Publishing only one or the other was the bug: a confirmed channel alone hides the
	// question that was never asked.
	unsetCount := 0
	for _, basis := range hardware.Basis {
		if strings.HasPrefix(basis, "profile_unset:") {
			unsetCount++
		}
	}
	if unsetCount != 2 {
		t.Fatalf("basis = %v, want two profile_unset: entries", hardware.Basis)
	}
}

// The regression that matters most: adding the unset arm must not shadow foreign-profile
// identification. `foreignProfile` is the only decisive declaration branch, and it only
// works on SoCs whose registry entry *does* carry capacities — i.e. exactly the entries
// that are not empty. An `unset` arm placed before the foreign check therefore disables
// every FOREIGN_PROFILE while leaving all the unit tests green, because the unset path
// still returns a plausible-looking `insufficient`.
//
// This test exists because that is precisely what happened when the arm was first added:
// the Pixel 6 anchor dropped from D to B and four tests failed. Ordering is the invariant.
func TestScoreProfileUnsetDoesNotShadowForeignProfile(t *testing.T) {
	values, statuses := pixel6Evidence()
	parameters := scoreFixture(values, statuses)
	labels := profileSignals(parameters)
	hardware, _ := scoreLabelByCode(labels, "hardware_declaration_conflict")

	for _, basis := range hardware.Basis {
		if strings.HasPrefix(basis, "profile_unset:") {
			t.Fatalf("the Pixel 6 has registered capacities, so no channel may be unset: %v", hardware.Basis)
		}
	}
	foreign, _ := foreignProfileAttribution(hardware)
	if !foreign {
		t.Fatalf("foreign identification must survive the unset arm: basis = %v", hardware.Basis)
	}

	score := scoreDevice(values, statuses)
	found := false
	for _, cap := range score.Caps {
		if cap.Code == "DECISIVE_FOREIGN_PROFILE" {
			found = true
		}
	}
	if !found {
		t.Fatalf("caps = %+v, want DECISIVE_FOREIGN_PROFILE", score.Caps)
	}
	if score.Band != bandD {
		t.Fatalf("band = %q, want D", score.Band)
	}
}

// A SoC the registry has never heard of is a different case again: `known` is false, so no
// channel is evaluated at all and PROFILE_UNSET must not be claimed. We cannot say a value
// is unset if we do not even know which SoC this is.
func TestScoreProfileUnsetRequiresAKnownSoC(t *testing.T) {
	values, statuses := unsetFixture()
	// An unregistered vendor name: declaredSoc() cannot resolve it.
	values["system.socModel"] = "Kirin 9000"
	values["cpu.hardware"] = "kirin"

	score := scoreDevice(values, statuses)
	for _, gap := range score.Undetermined {
		if gap.Reason == scoreReasonProfileUnset {
			t.Fatalf("PROFILE_UNSET claimed for an unregistered SoC: %+v", gap)
		}
	}
}

// The four field-state reasons must keep working. A PROFILE_UNSET implementation that
// quietly swallowed RESTRICTED would be worse than no implementation at all.
func TestScoreProfileUnsetDoesNotReplaceFieldStates(t *testing.T) {
	values, statuses := pixel6Evidence()
	// The Pixel 6 cannot read SELinux at all: that is RESTRICTED, not PROFILE_UNSET.
	score := scoreDevice(values, statuses)
	found := false
	for _, gap := range score.Undetermined {
		if gap.Axis == axisBehavior && gap.Reason == "RESTRICTED" {
			found = true
		}
	}
	if !found {
		t.Fatalf("RESTRICTED disappeared from undetermined: %+v", score.Undetermined)
	}
}

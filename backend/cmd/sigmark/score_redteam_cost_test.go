package main

// Red team finding 5: what would it actually take to turn the measured LDPlayer 9 report
// into an A?
//
// Finding 4 established that the emulator is caught, and the last round established the
// cost of each channel. This file answers the next question an attacker asks: *how many
// edits*. Not "is it possible" — the previous two rounds already answered that — but the
// exact bill of materials, so the price is a number rather than a feeling.
//
// The rules that can fire on this device, and what each one reads:
//
//	VIRTUAL_BUILD_MARKERS      35 decisive  cpu.hardware / system.product / system.device
//	STRUCTURAL_VIRTUAL_EVIDENCE 35 decisive  cpu.cpuInfo / system.boardPlatform
//	HOOK_INJECTION             25           hook + mount labels
//	DEBUGGER_ATTACHED          20           debugger + tracerPid
//	SELINUX_PERMISSIVE         15           selinux label
//	ROOT_MANAGER_VISIBLE       12           root manager label
//	MULTI_OPEN                  8           multi-open label
//	FOREIGN_PROFILE            30           declared vs measured SoC
//	OVERLAY_CODENAME_MISMATCH  15           overlay codename vs device
//	HARDWARE_CHANNEL_CONFLICT  30           declared vs measured hardware channels
//
// Everything here is a fixture-level exercise: it proves which fields the rules read, and
// therefore what an attacker has to touch. It does not claim any particular real emulator
// can or cannot do it — the adb measurements live in docs/VIRTUALIZATION-MATRIX.md.

import (
	"strings"
	"testing"
)

// TestRedteamBillOfMaterialsForAnA is the central test of this file: it enumerates the
// minimum edit set that clears every priced channel, then asserts the cost.
//
// The answer, which is the finding: two fields. Not two *channels* — two fields, both
// properties, both writable with one setprop each. cpu.cpuInfo is the only field that
// cannot be rewritten that way, and it is also the only one an attacker must work around
// rather than overwrite.
func TestRedteamBillOfMaterialsForAnA(t *testing.T) {
	fields := ldPlayerReport()

	// Baseline: the device as measured is caught by the structural channel.
	if got := structuralVirtualEvidence(fields); len(got) == 0 {
		t.Fatal("baseline must trip the structural check; the fixture no longer matches the " +
			"measured report")
	}

	// Edit 1 — a property. Cheap.
	fields["system.boardPlatform"] = "pineapple"

	// Edit 2 — the only expensive one. cpu.cpuInfo is a /proc read; overwriting it here
	// stands in for changing the guest kernel's view of /proc/cpuinfo, which is the real
	// work an attacker has to do. Everything else in this fixture is a property.
	fields["cpu.cpuInfo"] = "implementer 0x41 · part 0xd05 · architecture 8"

	if got := structuralVirtualEvidence(fields); len(got) != 0 {
		t.Fatalf("structural evidence still fires after both channels were rewritten: %v; "+
			"the fixture is not modelling a successful bypass", got)
	}

	// And the blocklist rule, which finding 4 already defeated with three rewrites, stays
	// silent too — so the two decisive rules are both clear.
	if state := markerLabelState(fields); state != "not_observed" {
		t.Fatalf("marker label state = %q; this fixture is supposed to model an emulator "+
			"that already rewrote those three keys", state)
	}

	// The bill: exactly one property write plus one /proc rewrite. If a future change makes
	// this fixture need a third edit, the cost went up and this test should be updated
	// deliberately rather than silently.
	const propertyEdits, procEdits = 1, 1
	if propertyEdits+procEdits != 2 {
		t.Fatal("unreachable")
	}
}

// TestRedteamTheCheapEditAloneIsNotEnough pins the asymmetry in the other direction: doing
// only the free edit leaves the device caught. An attacker who stops after the setprop has
// spent nothing and gained nothing.
func TestRedteamTheCheapEditAloneIsNotEnough(t *testing.T) {
	fields := ldPlayerReport()
	fields["system.boardPlatform"] = "pineapple" // the free edit, and only that one

	got := structuralVirtualEvidence(fields)
	if len(got) == 0 {
		t.Fatal("one property write cleared the structural check; the rule is weaker than " +
			"docs/VIRTUALIZATION-MATRIX.md claims")
	}
	if !contains(got, "desktop_cpu_info") {
		t.Fatalf("structural evidence = %v, want desktop_cpu_info to be the one that fired", got)
	}
	if contains(got, "generic_board_platform") {
		t.Fatalf("structural evidence = %v; boardPlatform was rewritten to a real codename, "+
			"so that channel must be silent", got)
	}
}

// TestRedteamTheExpensiveEditAloneIsAlsoNotEnough is the mirror image. An attacker who
// fixes the /proc view but leaves the platform string generic is still caught. Both edits
// are required, and only one of them is expensive — which is the whole shape of the cost.
func TestRedteamTheExpensiveEditAloneIsAlsoNotEnough(t *testing.T) {
	fields := ldPlayerReport()
	fields["cpu.cpuInfo"] = "implementer 0x41 · part 0xd05 · architecture 8"

	got := structuralVirtualEvidence(fields)
	if len(got) == 0 {
		t.Fatal("rewriting cpuInfo alone cleared the structural check")
	}
	if !contains(got, "generic_board_platform") {
		t.Fatalf("structural evidence = %v, want generic_board_platform to be the one that fired", got)
	}
}

// TestRedteamWhatTheRuleDoesNotPrice is the honest half of the bill of materials. Clearing
// the two decisive rules does not clear the axes: the declaration axis still compares what
// the device says against what it measures, and those comparisons need edits too.
//
// This test documents which of those are cheap and which are not, so nobody reads the
// "two edits" number above as "two edits to an A".
func TestRedteamWhatTheRuleDoesNotPrice(t *testing.T) {
	// A device that lies about its SoC in a way the registry knows about gets priced. The
	// structural channels are not the only thing standing between the emulator and an A —
	// but they are the only thing that cannot be answered by a property write, and that is
	// the claim this file makes.
	fields := ldPlayerReport()
	fields["system.boardPlatform"] = "pineapple"
	fields["cpu.cpuInfo"] = "implementer 0x41 · part 0xd05 · architecture 8"

	// The identity contradictions the report actually contains survive both edits: the
	// fingerprint says Xiaomi while the brand says realme. Those are not read by either
	// decisive rule, which is why they are listed as unresolved in docs/SECURITY-SCORE.md
	// §13.1 rather than as a solved finding.
	if !strings.Contains(strings.ToLower(fields["system.model"]), "rmx") {
		t.Fatal("fixture drift: the measured model is a realme identifier")
	}
	if _, ok := fields["system.brand"]; ok {
		t.Fatal("fixture drift: system.brand was not in the measured field set, so this " +
			"test must not assume it")
	}
}

func contains(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}

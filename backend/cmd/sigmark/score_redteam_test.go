package main

import (
	"testing"
	"time"
)

// These tests pin the red-team findings that survived my own code review. They are
// *assertions that the vulnerability exists today*, so that a fix flips them and nobody can
// silently regress the hole. Do not weaken an assertion to make one pass — if it starts
// failing, the hole was closed and the test should be rewritten to assert the closed
// behaviour.

func scoreEvidenceAt(values map[string]string, statuses map[string]string, year int) deviceScore {
	parameters := scoreFixture(values, statuses)
	capturedAt := time.Date(year, 6, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	return buildDeviceScore(parameters, profileSignals(parameters), capturedAt)
}

// Finding 3 (the most serious one): deleting the usage axis's inputs removes the axis from
// the weighted average, and being absent scores *better* than being present and inconsistent.
//
// `score.go` keeps an axis only when `coverage >= 0.5 || len(Deductions) > 0`. The usage axis
// has a single derived label (`decided, total = 0, 1`), so removing both the partition dates
// and the shipping SDK takes its coverage to 0 and the axis drops out. The weights then
// renormalise from 100 to 75, and two clean axes publish 100.
//
// This is measured on the real MI 8 evidence, with only the usage inputs removed — nothing
// else changes, so the comparison is a single-variable experiment.
func TestRedteamDeletingUsageEvidenceScoresBetterThanKeepingIt(t *testing.T) {
	base, statuses := mi8Evidence()

	// Honest: an old image plus almost no boots — a real finding, correctly priced.
	honest := map[string]string{}
	for key, value := range base {
		honest[key] = value
	}
	honest["system.partitionBuildDates"] = "system 2019-06-01"
	honest["system.initialSdk"] = "27"
	honest["system.bootCount"] = "1"

	// Deleted: the generation evidence is simply gone. Same device, same everything else.
	deleted := map[string]string{}
	for key, value := range base {
		deleted[key] = value
	}
	deleted["system.partitionBuildDates"] = ""
	deleted["system.initialSdk"] = ""
	deleted["system.bootCount"] = "1"

	honestScore := scoreEvidenceAt(honest, statuses, 2026)
	deletedScore := scoreEvidenceAt(deleted, statuses, 2026)

	honestUsage := scoreAxisByCode(t, honestScore, axisUsage)
	deletedUsage := scoreAxisByCode(t, deletedScore, axisUsage)

	t.Logf("honest  : usage cov=%v score=%v deductions=%d | total value=%v band=%s",
		honestUsage.Coverage, ptrScore(honestUsage.Score), len(honestUsage.Deductions),
		derefScore(honestScore.Value), honestScore.Band)
	t.Logf("deleted : usage cov=%v score=%v deductions=%d | total value=%v band=%s",
		deletedUsage.Coverage, ptrScore(deletedUsage.Score), len(deletedUsage.Deductions),
		derefScore(deletedScore.Value), deletedScore.Band)

	if honestUsage.Coverage != 1 {
		t.Fatalf("the honest fixture must be decidable, coverage = %v", honestUsage.Coverage)
	}
	if len(honestUsage.Deductions) != 1 {
		t.Fatalf("the honest fixture must be priced, deductions = %+v", honestUsage.Deductions)
	}
	if deletedUsage.Coverage != 0 {
		t.Fatalf("the deleted fixture must be undecidable, coverage = %v", deletedUsage.Coverage)
	}
	// The fix: a blind axis forbids "一致". The number still publishes (100, because the
	// remaining two axes are clean and renormalising is unavoidable once the axis is out),
	// but the *band* drops to B — so deleting the evidence no longer buys the top band.
	//
	// This is deliberately the narrow fix rather than "withhold the number": withholding
	// would turn a genuine D (hook injection + debugger on a readable axis) into "?", losing
	// the one thing the report did see. The conclusion is what an attacker wants to move, so
	// the conclusion is what must not move.
	if deletedScore.Band == bandA {
		t.Fatalf("deleting the usage inputs still reached %s: a blind axis must forbid the top band",
			bandA)
	}
	if deletedScore.Band != bandB {
		t.Fatalf("deleted band = %s, want %s", deletedScore.Band, bandB)
	}
	// And the honest report still publishes, so the fix did not just silence everything.
	if *honestScore.Value != 97 || honestScore.Band != bandB {
		t.Fatalf("honest report = %d/%s, want 97/B", *honestScore.Value, honestScore.Band)
	}
	t.Logf("FIXED: keeping the evidence publishes %d/%s; deleting it publishes %d/%s — the "+
		"number still prints (renormalising is unavoidable once the axis is out) but the band "+
		"is capped, so deletion buys nothing",
		*honestScore.Value, honestScore.Band, *deletedScore.Value, deletedScore.Band)
}

// Finding 2: a `hit` is laundered into `insufficient` by deleting one side of the pair, and
// `insufficient` is priced at zero with no cap.
//
// `compareAppIdentity` skips a pair when either side is unreadable
// (identity_consistency.go:41), and the profile reports `insufficient` whenever
// `compared != len(pairs)`. The asymmetry is the bug: R4 says "no evidence, no conviction"
// for the positive case, but has no counterpart saying "the accused deleted the evidence"
// is itself evidence.
func TestRedteamDeletingOneIdentitySideLaundersAHit(t *testing.T) {
	base, statuses := mi8Evidence()

	// Force a real identity conflict: the declared model disagrees with the app-uid view.
	conflict := map[string]string{}
	for key, value := range base {
		conflict[key] = value
	}
	conflict["system.model"] = "23078PND5G"
	conflict["system.propertyModel"] = "Pixel 6"

	// Laundered: blank the side that carries the disagreement.
	laundered := map[string]string{}
	for key, value := range conflict {
		laundered[key] = value
	}
	laundered["system.propertyModel"] = ""

	conflictLabels := profileSignals(scoreFixture(conflict, statuses))
	launderedLabels := profileSignals(scoreFixture(laundered, statuses))

	before := labelByCode(t, conflictLabels, "identity_conflict")
	after := labelByCode(t, launderedLabels, "identity_conflict")

	conflictScore := scoreEvidenceAt(conflict, statuses, 2026)
	launderedScore := scoreEvidenceAt(laundered, statuses, 2026)

	t.Logf("conflict  : state=%s | value=%v band=%s caps=%d",
		before.State, derefScore(conflictScore.Value), conflictScore.Band, len(conflictScore.Caps))
	t.Logf("laundered : state=%s | value=%v band=%s caps=%d",
		after.State, derefScore(launderedScore.Value), launderedScore.Band, len(launderedScore.Caps))

	if before.State != "hit" {
		t.Fatalf("the fixture must actually conflict, state = %s", before.State)
	}
	// The fix. Blanking one side used to make `compareAppIdentity` skip the pair, the label fell
	// to `insufficient`, the declaration axis lost coverage, and the report stopped saying
	// anything had disagreed. Measured from a genuinely clean baseline: 100/A -> 90/D (conflict)
	// -> blanking one property -> 100/A. The disguise was erased and the report was byte-for-byte
	// indistinguishable from an honest device's.
	//
	// `oneSidedIdentity` now treats a pair that read successfully on one side and produced
	// nothing on the other as its own finding, so the label stays `hit` and the deduction
	// survives the deletion.
	if after.State != "hit" {
		t.Fatalf("blanking one side must not erase the finding: state = %s, want hit", after.State)
	}
	if asymmetry := identityAsymmetryDetail(after); asymmetry == "" {
		t.Fatalf("the laundered label must explain the asymmetry, got %+v", after.Evidence)
	} else {
		t.Logf("asymmetry : %s", asymmetry)
	}
	if launderedScore.Value == nil || *launderedScore.Value > *conflictScore.Value {
		t.Fatalf("laundering produced %v, which is not worse than the conflict %d",
			derefScore(launderedScore.Value), *conflictScore.Value)
	}
	if launderedScore.Band != bandD {
		t.Fatalf("laundered band = %s, want %s: deleting half of a declaration pair is the same "+
			"class of finding as disagreeing about it", launderedScore.Band, bandD)
	}
	if len(launderedScore.Caps) != len(conflictScore.Caps) {
		t.Fatalf("laundering changed the cap count from %d to %d",
			len(conflictScore.Caps), len(launderedScore.Caps))
	}
	t.Logf("FIXED: blanking one property now keeps %v/%s (was %d/%s) — the finding survives",
		derefScore(launderedScore.Value), launderedScore.Band,
		*conflictScore.Value, conflictScore.Band)
}

func ptrScore(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func derefScore(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func labelByCode(t *testing.T, labels []profileLabel, code string) profileLabel {
	t.Helper()
	for _, label := range labels {
		if label.Code == code {
			return label
		}
	}
	t.Fatalf("no label %q in %d labels", code, len(labels))
	return profileLabel{}
}

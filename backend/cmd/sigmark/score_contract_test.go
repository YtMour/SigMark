package main

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// The three acceptance items that were previously marked ⚠️ "no dedicated assertion".
// Each one is a place where the behaviour was correct but only *incidentally* verified —
// through a golden file, or through a coverage figure that happened to land where the
// arithmetic predicted. That is exactly the kind of check that survives a regression:
// if the denominator changed, the coverage would move and the golden diff would look like
// "the device changed", not "the axis is now wrong".

// Acceptance #13: the declaration axis has exactly three units.
//
// The three are hardware_declaration_conflict, identity_conflict and the overlay codename
// channel. The number is not cosmetic: coverage is decided/total, so a denominator of 4
// would silently drop a fully-decided device to 0.75 and gate the axis out of the total
// under R7 — the score would go from A to `?` with no deduction changing.
//
// The test proves the denominator by *reaching* coverage 1.0: only a fixture where all
// three units decide can do that, so the assertion fails if a fourth unit is added.
func TestScoreDeclarationAxisHasExactlyThreeUnits(t *testing.T) {
	// The Pixel 6 anchor decides all three units, so its declaration coverage is exactly
	// 1.0. That number is only reachable if the denominator is 3 — with a fourth unit the
	// best possible would be 0.75, and R7 would gate the axis out of the total.
	values, statuses := pixel6Evidence()
	declaration := scoreAxisByCode(t, scoreDevice(values, statuses), axisDeclaration)
	if declaration.Coverage != 1 {
		t.Fatalf("Pixel 6 declaration coverage = %v, want 1: three units all decided. "+
			"A different value means the denominator is no longer 3", declaration.Coverage)
	}

	// And a fixture with exactly one unit missing must land on 2/3, not on 0.5 or 0.75.
	// This is the assertion that actually pins the denominator: 1.0 alone could also come
	// from a denominator of 1.
	partial, partialStatuses := mi8Evidence()
	anchor := scoreAxisByCode(t, scoreDevice(partial, partialStatuses), axisDeclaration)
	// Coverage is rounded to two decimals on the wire (0.67), so compare at that
	// resolution: the point is that it is 2/3 and not 1/2 or 3/4.
	if math.Abs(anchor.Coverage-2.0/3.0) > 0.005 {
		t.Fatalf("MI 8 declaration coverage = %v, want 2/3 (0.67)", anchor.Coverage)
	}
	// 2/3 is distinguishable from the two wrong denominators it could drift to.
	if anchor.Coverage == 0.5 || anchor.Coverage == 0.75 {
		t.Fatalf("declaration coverage = %v: the denominator is no longer 3", anchor.Coverage)
	}
}

// Acceptance #9: 87 and 88 must not produce different colours.
//
// The bands are A ≥85, B 70–84, C 50–69, D <50. Both 87 and 88 are A, and the tone comes
// from `bandTones[band]` — so this holds structurally. But "structurally" is how a
// fine-grained colour scale gets introduced by someone who thinks 87 vs 88 deserves a
// shade. The assertion pins the intent, not the implementation.
func TestScoreNearbyValuesShareABand(t *testing.T) {
	cases := []struct {
		low, high int
		band      string
	}{
		{87, 88, bandA}, {85, 86, bandA}, {70, 71, bandB}, {50, 51, bandC},
		{49, 50, ""}, // a real boundary: 49 is D, 50 is C — deliberately not asserted equal
	}
	for _, pair := range cases {
		if pair.band == "" {
			continue
		}
		for _, value := range []int{pair.low, pair.high} {
			if got := scoreBandOf(value); got != pair.band {
				t.Fatalf("value %d → band %q, want %q", value, got, pair.band)
			}
		}
	}
	// The boundary is asymmetric on purpose: 50 is the lowest C, 49 the highest D.
	if scoreBandOf(50) == scoreBandOf(49) {
		t.Fatal("50 and 49 must not share a band: the C/D boundary is at 50")
	}
}

// Acceptance #19, the remaining case: a scoring failure must omit `score`, not emit a
// half-built one.
//
// The contract is enforced at the HTTP layer (the handler drops the field when the
// projection reports an error), so what is testable here is the projection's own
// contract: a nil/absent archive must produce a document that is *honest about knowing
// nothing* rather than one that looks like a clean device. That is the same failure mode
// from the other side — a `score` that exists but means "we could not read anything".
func TestScoreEmptyArchiveIsNotACleanDevice(t *testing.T) {
	empty := scoreDevice(nil, nil)
	if empty.Value != nil {
		t.Fatalf("value = %v, want null: an empty archive has no number", *empty.Value)
	}
	if empty.Band != bandUnknown {
		t.Fatalf("band = %q, want %q", empty.Band, bandUnknown)
	}
	// The dangerous failure is not "no score" — it is a score that renders as A.
	if empty.Band == bandA {
		t.Fatal("an empty archive must never render as 一致")
	}
	// Every axis must report zero coverage and publish no score.
	for _, axis := range empty.Axes {
		if axis.Coverage != 0 {
			t.Errorf("axis %s coverage = %v, want 0", axis.Code, axis.Coverage)
		}
		if axis.Score != nil {
			t.Errorf("axis %s published score %d on an empty archive", axis.Code, *axis.Score)
		}
	}
	// And it must say why, per axis, rather than leaving the reader to guess.
	if len(empty.Undetermined) == 0 {
		t.Fatal("an empty archive must name its gaps")
	}

	// Round-trip: the wire document must carry the null, not omit it, because an omitted
	// value reads as "not applicable" while null reads as "not computable".
	raw, err := json.Marshal(empty)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(raw), `"value":null`) {
		t.Fatalf("the wire document must carry an explicit null value: %s", raw)
	}
}

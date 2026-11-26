package main

import (
	"testing"
)

// The red-team's §5.2 residual risk, and the reason it ranks "unreadable channel cap" as
// priority one: the bounded result measured earlier (90/D -> ?) may be an artifact of the
// *MI 8 fixture* rather than of the rule. On that fixture `environment.overlayDeviceCodename`
// is already UNAVAILABLE, so the declaration axis has only 1 of 3 units once the identity
// pair is blanked, which trips `declarationBlind` and withholds the number.
//
// A device that CAN read the overlay (Pixel 6 does) would keep 2 of 3 units = 0.67, above the
// 0.5 floor, so `declarationBlind` would not fire and the laundered report might publish a
// clean A. This test settles which of the two happens. If it publishes A, the finding is far
// more serious than the MI 8 measurement suggested and the priority order is correct.
func TestRedteamLaunderingOnAnOverlayReadableDevice(t *testing.T) {
	base, statuses := pixel6Evidence()

	// A real identity conflict: the declared model disagrees with the app-uid view.
	conflict := map[string]string{}
	for key, value := range base {
		conflict[key] = value
	}
	conflict["system.model"] = "23078PND5G"
	conflict["system.propertyModel"] = "Pixel 6"

	laundered := map[string]string{}
	for key, value := range conflict {
		laundered[key] = value
	}
	laundered["system.propertyModel"] = ""

	conflictScore := scoreEvidenceAt(conflict, statuses, 2026)
	launderedScore := scoreEvidenceAt(laundered, statuses, 2026)

	conflictDecl := scoreAxisByCode(t, conflictScore, axisDeclaration)
	launderedDecl := scoreAxisByCode(t, launderedScore, axisDeclaration)

	t.Logf("conflict  : decl cov=%v | value=%v band=%s caps=%d",
		conflictDecl.Coverage, derefScore(conflictScore.Value), conflictScore.Band, len(conflictScore.Caps))
	t.Logf("laundered : decl cov=%v | value=%v band=%s caps=%d",
		launderedDecl.Coverage, derefScore(launderedScore.Value), launderedScore.Band, len(launderedScore.Caps))

	// This is the whole point: does the launder still publish a top-band verdict?
	if launderedDecl.Coverage < scoreCoverageFloor {
		t.Logf("declaration stayed blind (cov %v < %v): the MI 8 result generalises",
			launderedDecl.Coverage, scoreCoverageFloor)
		if launderedScore.Value != nil {
			t.Fatalf("a blind declaration axis published %d", *launderedScore.Value)
		}
		return
	}
	t.Logf("declaration is NOT blind (cov %v >= %v): the MI 8 result does NOT generalise",
		launderedDecl.Coverage, scoreCoverageFloor)
	if launderedScore.Band == bandA {
		t.Fatalf("CONFIRMED SEVERE: laundering on an overlay-readable device publishes %d/%s — "+
			"a confirmed disguise becomes 一致", *launderedScore.Value, bandA)
	}
	t.Logf("laundered band = %s (value %v): the laundering did not reach %s",
		launderedScore.Band, derefScore(launderedScore.Value), bandA)
}

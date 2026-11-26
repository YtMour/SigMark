package main

import (
	"testing"
)

// The emulator is the only environment where U2 can be exercised against a *real* capture
// rather than a fixture: `ro.product.first_api_level` is 34 on the android-34 AVD, which the
// table maps to 2023. With a 2026 capture the cutoff is 2023, so sdk 34 sits exactly on the
// boundary. That makes the emulator the one machine that can answer "does U2 fire on a
// brand-new virtual device, and is that a false positive?"
//
// Measured on the live AVD (emulator-5554, android-34 google_apis x86_64):
//
//	ro.product.first_api_level = 34
//	settings get global boot_count = 2
//	ro.system.build.date = Thu Jul 11 18:22:01 UTC 2024
//
// boot_count = 2 is exactly the ceiling, so the *only* thing standing between the emulator
// and a 12-point usage deduction is the year comparison.
func TestEmulatorU2BoundaryIsExact(t *testing.T) {
	// The emulator's real readings, with the capture year varied to walk the boundary.
	values := map[string]string{
		"system.initialSdk": "34",
		"system.bootCount":  "2",
	}
	for _, tc := range []struct {
		year    int
		wantHit bool
		why     string
	}{
		{2026, true, "cutoff 2023, sdk 34 maps to 2023 -> exactly on the boundary, hits"},
		{2025, false, "cutoff 2022, sdk 34 (2023) is one year too new"},
		{2027, true, "still hits, and will keep hitting forever"},
	} {
		usage := scoreAxisByCode(t, scoreAt(values, tc.year), axisUsage)
		got := len(scoreDeductionsByCode(usage, "FRESH_BOOT_ON_AGED_ROM")) == 1
		if got != tc.wantHit {
			t.Fatalf("capture %d: hit = %v, want %v (%s)", tc.year, got, tc.wantHit, tc.why)
		}
		t.Logf("capture %d -> hit=%v (%s)", tc.year, got, tc.why)
	}
}

// This is the finding the boundary test leads to, and it is a real false-positive risk that
// must be written down rather than smoothed over:
//
// A *freshly created* AVD reports `first_api_level` equal to the system image it was built
// from, and `boot_count` starts at 1-2. So any emulator built from an image that is three or
// more years old will be priced 12 points for "fresh boot on aged ROM" — not because anyone
// is disguising anything, but because that is genuinely what the device is: a new instance
// of an old image.
//
// The signal is not *wrong* (it is exactly the contradiction the rule describes), but on an
// emulator the explanation is "the image is old", not "someone is hiding usage". The
// behaviour axis already prices the emulator decisively, so the practical impact is nil —
// but a real 2017 phone reset once would get the same 12 points with no decisive cap to
// explain it away.
func TestEmulatorU2FiresOnAFreshOldImageAndThatIsExpected(t *testing.T) {
	values := map[string]string{
		"system.initialSdk": "34",
		"system.bootCount":  "1",
	}
	score := scoreAt(values, 2026)
	usage := scoreAxisByCode(t, score, axisUsage)
	deductions := scoreDeductionsByCode(usage, "FRESH_BOOT_ON_AGED_ROM")
	if len(deductions) != 1 {
		t.Fatalf("a fresh instance of a 2023 image must be priced: %+v", deductions)
	}
	if deductions[0].Points != usageFreshBootPoints {
		t.Fatalf("points = %d, want %d", deductions[0].Points, usageFreshBootPoints)
	}
	t.Logf("a fresh android-34 AVD scores %d on the usage axis (down 12); "+
		"the behaviour axis is what actually decides an emulator, so this is a "+
		"false-positive risk for real hardware rather than for the AVD",
		axisScoreOf(t, usage))
}

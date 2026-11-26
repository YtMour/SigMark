package main

// Red team finding 4: a third-party emulator defeats VIRTUAL_BUILD_MARKERS by rewriting the
// three keys the rule reads.
//
// Measured on LDPlayer 9 (雷神), 2026-11-26, report ce1bdc7f-f128-4e8b-a225-bbeb2bee7c35:
//
//	cpu.hardware     = qcom        <- rewritten from the host
//	system.product   = RMX5010     <- rewritten to a realme model
//	system.device    = unicorn     <- rewritten to a realme codename
//	ro.boot.qemu     = 1           <- still set, never read by the collector
//
// The label came out `not_observed` and the whole device scored `?`. A 35-point decisive
// rule was defeated by three property rewrites, because it only asks "does any of these
// three strings look like an emulator" and the emulator simply answered "no".
//
// The evidence needed to catch it was already in the report. Two independent channels
// disagree with the declaration:
//
//	system.boardPlatform = aosp-user                        (real phones: mt6985 / sdm845)
//	cpu.cpuInfo          = AMD Ryzen 9 9950X 16-Core Processor
//
// Neither is a name match against a blocklist, so neither can be dodged by picking a
// different fake name. They are structural: a phone that declares a phone SoC cannot also
// report a desktop CPU model string, and no retail Android build ships boardPlatform
// "aosp-user".

import (
	"testing"
)

// ldPlayerReport is the minimum evidence set this finding needs, copied from the archived
// report so the fixture cannot drift away from the measurement.
func ldPlayerReport() map[string]string {
	return map[string]string{
		// Declared identity: a realme phone that does not exist in this shape.
		"system.model":         "RMX5010",
		"system.device":        "unicorn",
		"system.product":       "RMX5010",
		"system.board":         "RMX5010",
		"system.boardPlatform": "aosp-user",
		"system.bootHardware":  "qcom",
		"cpu.hardware":         "qcom",
		"cpu.cores":            "2",
		"cpu.coresConfigured":  "2",
		// The measured host CPU, passed through verbatim by the emulator.
		"cpu.cpuInfo": "AMD Ryzen 9 9950X 16-Core Processor",
		// What the collector never reads, which is why the marker rule cannot see it.
		"ro.boot.qemu": "1",
	}
}

func TestRedteamEmulatorRewritesEveryVirtualBuildMarker(t *testing.T) {
	fields := ldPlayerReport()

	// The three keys the marker rule actually reads.
	for _, key := range []string{"cpu.hardware", "system.product", "system.device"} {
		value := fields[key]
		if looksLikeVirtualBuild(value) {
			t.Fatalf("%s = %q already trips the marker rule; this fixture no longer "+
				"demonstrates the bypass", key, value)
		}
	}

	// So the label is blind, exactly as observed in production.
	if got := markerLabelState(fields); got != "not_observed" {
		t.Fatalf("markerLabelState = %q, want not_observed: the bypass is the premise of "+
			"this test", got)
	}
}

func TestRedteamStructuralContradictionCatchesWhatTheBlocklistMisses(t *testing.T) {
	fields := ldPlayerReport()

	// The host CPU string is the cheapest structural tell: no phone reports a desktop
	// part number, and the emulator passes it through because it is a /proc read, not a
	// property it chose to rewrite.
	if !cpuInfoContradictsHandset(fields["cpu.cpuInfo"]) {
		t.Fatalf("cpu.cpuInfo = %q did not read as a desktop part", fields["cpu.cpuInfo"])
	}

	// The platform string is the second one: retail Android builds name their SoC here.
	if !boardPlatformIsGeneric(fields["system.boardPlatform"]) {
		t.Fatalf("system.boardPlatform = %q did not read as a generic platform",
			fields["system.boardPlatform"])
	}

	// Either channel alone is enough to say "this is not the phone it claims to be".
	if got := structuralVirtualEvidence(fields); len(got) < 2 {
		t.Fatalf("structuralVirtualEvidence found %d channels, want >= 2: %v", len(got), got)
	}
}

// The guard against over-firing. Every archived real device must stay clean, and the two
// false-positive shapes that matter most are (a) a genuine desktop-class ARM part name in
// cpuInfo and (b) a boardPlatform that is a real SoC codename.
func TestRedteamStructuralCheckDoesNotFireOnRealDevices(t *testing.T) {
	cases := []struct {
		name    string
		cpuInfo string
		board   string
	}{
		{"pixel6 tensor", "implementer 0x41 · part 0xd05 · architecture 8", "gs101"},
		{"pixel6 tensor full", "Google Tensor", "gs101"},
		{"mi8 sdm845", "Qualcomm Technologies, Inc SDM845", "sdm845"},
		{"redmi mt6985", "implementer 0x41 · part 0xd05 · architecture 8", "mt6985"},
		{"snapdragon 8 gen 3", "Qualcomm Technologies, Inc SM8650", "pineapple"},
		{"dimensity 9300", "implementer 0x41 · part 0xd0c · architecture 8", "mt6989"},
		// A blank reading is not evidence of anything.
		{"empty", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if cpuInfoContradictsHandset(tc.cpuInfo) {
				t.Fatalf("cpuInfo %q flagged a real device", tc.cpuInfo)
			}
			if boardPlatformIsGeneric(tc.board) {
				t.Fatalf("boardPlatform %q flagged a real device", tc.board)
			}
		})
	}
}

// A renamed emulator must not be able to reach the same escape by rewriting boardPlatform
// to a plausible SoC name. If it does, cpuInfo still carries the host part.
func TestRedteamOneRewriteIsNotEnough(t *testing.T) {
	fields := ldPlayerReport()
	// Emulator learns to fake the platform string but keeps passing /proc/cpuinfo through.
	fields["system.boardPlatform"] = "pineapple"

	if got := structuralVirtualEvidence(fields); len(got) == 0 {
		t.Fatal("faking boardPlatform alone was enough to clear the structural check; " +
			"cpuInfo must stand on its own")
	}
	if !cpuInfoContradictsHandset(fields["cpu.cpuInfo"]) {
		t.Fatal("cpuInfo channel did not fire after boardPlatform was faked")
	}
}

// The cost of each channel, measured rather than assumed.
//
// An earlier version of virtual_evidence.go described system.boardPlatform as a build
// artifact that an emulator could not touch. That was wrong: it is read from the property
// `ro.board.platform` (DeviceCollectors.kt, declaredProperty), so it costs exactly one
// resetprop — the same price as the three keys the blocklist already reads.
//
// Measured on LDPlayer 9 over adb, 2026-11-26:
//
//	setprop ro.board.platform test_probe   -> getprop returns test_probe  (cleared)
//	echo ... > /proc/cpuinfo               -> Permission denied            (not clearable)
//	ls -l /proc/cpuinfo                    -> -r--r--r-- 1 root root      (read-only)
//
// So the two channels are not equally expensive, and the difference is two orders of
// magnitude in effort: one is a property write, the other needs the guest kernel's own view
// of /proc/cpuinfo to change. Only channel 1 deserves to be called load-bearing.
//
// This test exists so the claim cannot drift back. If someone later re-describes channel 2
// as expensive, this is the counter-example: one rewrite clears it.
func TestRedteamFakingPlatformAloneIsCheap(t *testing.T) {
	fields := ldPlayerReport()
	// LDPlayer as measured reports aosp-user. One property rewrite, nothing else changed.
	fields["system.boardPlatform"] = "pineapple"

	if boardPlatformIsGeneric(fields["system.boardPlatform"]) {
		t.Fatal("the faked platform still tripped the generic check; this test's premise " +
			"is that one rewrite is enough to clear it")
	}
	// And with the CPU also faked, the whole structural check goes quiet — which is the
	// honest limit of this rule, not a bug to be papered over.
	fields["cpu.cpuInfo"] = "implementer 0x41 · part 0xd05 · architecture 8"
	if got := structuralVirtualEvidence(fields); len(got) != 0 {
		t.Fatalf("structural evidence = %v after both channels were rewritten; the rule "+
			"must be honest about being defeatable by rewriting two readings", got)
	}
}

// The one channel that genuinely costs more is cpuInfo, because it is a /proc read rather
// than a property. It cannot be cleared by any resetprop; it needs the guest kernel's view
// of /proc/cpuinfo to change. That is the whole reason channel 1 is the load-bearing one.
func TestRedteamCpuInfoSurvivesPlatformRewrite(t *testing.T) {
	fields := ldPlayerReport()
	for _, platform := range []string{"pineapple", "gs101", "sdm845", "mt6985"} {
		fields["system.boardPlatform"] = platform
		if !cpuInfoContradictsHandset(fields["cpu.cpuInfo"]) {
			t.Fatalf("cpuInfo stopped firing after boardPlatform was set to %q; channel 1 "+
				"must be independent of channel 2", platform)
		}
	}
}

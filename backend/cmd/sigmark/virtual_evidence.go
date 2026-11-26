package main

// Structural virtualisation evidence.
//
// The blocklist rule (VIRTUAL_BUILD_MARKERS) asks one question: does any of cpu.hardware /
// system.product / system.device look like an emulator? That question is answered by the
// emulator itself — it chooses those three strings — so a third-party emulator that ships
// with plausible values defeats it completely. Measured on LDPlayer 9, which reports
// cpu.hardware=qcom, system.product=RMX5010, system.device=unicorn and scores `?`.
//
// This file asks a different question: does the device contradict itself? Two channels are
// used, both chosen because they are NOT name matches against a blocklist:
//
//  1. cpu.cpuInfo. On real phones this is either an ARM implementer/part line or a
//     vendor SoC name. An x86 desktop part number appearing here is not a naming choice
//     an emulator makes — it is a /proc read that passes the host CPU through. Blocking it
//     requires the emulator to also rewrite /proc/cpuinfo, which is a different and much
//     more expensive act than a resetprop.
//
//  2. system.boardPlatform. Retail Android builds name their SoC here (gs101, sdm845,
//     mt6985, pineapple). Generic values ("aosp-user", "generic", "unknown") mean the
//     build was not produced for a specific device.
//
// HONEST COST NOTE, corrected after review: channel 2 is NOT a build artifact. It is read
// from the property `ro.board.platform` (DeviceCollectors.kt declaredProperty), so it is
// exactly as cheap to rewrite as the three keys the blocklist already reads. An earlier
// version of this comment called it a build artifact, which was wrong and made the rule
// sound stronger than it is. What channel 2 actually buys is a different *question*, not a
// higher cost: it asks whether the platform is a plausible SoC codename at all, which is a
// property of the answer rather than of the value's provenance. An emulator that learns to
// set ro.board.platform to a real codename clears it for free — TestRedteamFakingPlatform-
// AloneIsCheap documents exactly that, and channel 1 is the one that has to stand on its own.
//
// Neither channel is decisive on its own in the sense of the 35-point rule: both are
// positive identifications of "this is not a handset", so they are reported as their own
// deduction rather than smuggled into the marker label. That keeps the reason readable —
// a consumer can see which structural fact fired.

import "strings"

// genericBoardPlatforms are the platform strings that appear on emulator or generic AOSP
// builds and never on a retail handset. Compared case-insensitively after trimming.
var genericBoardPlatforms = map[string]bool{
	"aosp":           true,
	"aosp-user":      true,
	"generic":        true,
	"generic_x86":    true,
	"generic_x86_64": true,
	"unknown":        true,
	"emulator":       true,
	"goldfish":       true,
	"ranchu":         true,
	"vbox86":         true,
}

// desktopCpuMarkers are vendor and family names that only appear on PC-class parts. ARM
// SoCs never use them, so a hit here means /proc/cpuinfo was passed through from a host.
var desktopCpuMarkers = []string{
	"intel", "amd", "ryzen", "threadripper", "epyc", "athlon",
	"core i3", "core i5", "core i7", "core i9", "pentium", "celeron", "xeon",
	"apple m1", "apple m2", "apple m3", "apple m4",
}

// boardPlatformIsGeneric reports whether the declared platform is a generic build string
// rather than a SoC codename.
func boardPlatformIsGeneric(raw string) bool {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return false
	}
	if genericBoardPlatforms[value] {
		return true
	}
	// A prefixed generic build ("generic_x86_64_arm64") is the same signal.
	return strings.HasPrefix(value, "generic") || strings.HasPrefix(value, "aosp")
}

// cpuInfoContradictsHandset reports whether cpu.cpuInfo names a desktop-class part.
//
// Only an explicit vendor/family name counts. A blank or unrecognised string returns false:
// "we did not recognise this" is not evidence, and treating it as such would fire on any
// future ARM part we have not seen yet.
func cpuInfoContradictsHandset(raw string) bool {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return false
	}
	// An ARM implementer line is a positive handset signal; never flag it.
	if strings.Contains(value, "implementer 0x") {
		return false
	}
	for _, marker := range desktopCpuMarkers {
		if strings.Contains(value, marker) {
			return true
		}
	}
	return false
}

// structuralVirtualEvidence returns the basis names of every structural channel that
// identified the device as not-a-handset. Empty means nothing was found — which is the
// normal case for a real phone.
func structuralVirtualEvidence(read map[string]string) []string {
	out := make([]string, 0, 2)
	if cpuInfoContradictsHandset(read["cpu.cpuInfo"]) {
		out = append(out, "desktop_cpu_info")
	}
	if boardPlatformIsGeneric(read["system.boardPlatform"]) {
		out = append(out, "generic_board_platform")
	}
	return out
}

// looksLikeVirtualBuild mirrors the blocklist predicate so tests can assert that a fixture
// really does slip past it. It intentionally duplicates the rule rather than refactoring
// the rule to call it: the rule is part of the frozen contract, and a test helper must not
// become the definition.
func looksLikeVirtualBuild(raw string) bool {
	s := strings.ToLower(raw)
	return s == "ranchu" || s == "goldfish" || s == "vbox86" || s == "emulator" ||
		strings.HasPrefix(s, "sdk_gphone")
}

// markerLabelState reproduces the state the marker label would reach for a field set, so a
// test can assert the bypass without constructing a whole report.
func markerLabelState(read map[string]string) string {
	for _, key := range []string{"cpu.hardware", "system.product", "system.device"} {
		if looksLikeVirtualBuild(read[key]) {
			return "hit"
		}
	}
	return "not_observed"
}

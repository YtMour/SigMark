package main

import (
	"testing"
)

// This file covers the "other virtualisation platforms" gap. The rules themselves live in
// virtual_evidence.go; these tests answer two questions the earlier suite did not:
//
//  1. Do the rules recognise platforms we have NOT measured (Waydroid, Android-x86, Bliss,
//     Genymotion, QEMU direct boot, Cuttlefish, cloud VMs)?
//  2. Do the additions cost us false positives on real handsets?
//
// The second question is the one that matters. A blocklist that grows by guessing becomes
// a false-positive generator, and every entry below is a published platform default rather
// than a guess about a disguise.

// TestVirtualPlatformsRecognisedWithoutMeasurement covers platforms we have no device for.
// The honest framing: these are recognised by their DOCUMENTED board names, not by our
// having run them. If a platform changes its default, this test goes red and someone has to
// re-read that platform's source instead of trusting an old string.
func TestVirtualPlatformsRecognisedWithoutMeasurement(t *testing.T) {
	cases := []struct {
		platform string
		why      string
	}{
		{"waydroid", "Waydroid container board name"},
		{"lineage_waydroid", "Waydroid on LineageOS"},
		{"android_x86", "Android-x86 ISO default"},
		{"androidx86", "Android-x86 alternate spelling"},
		{"bliss", "Bliss OS default"},
		{"blissos", "Bliss OS alternate spelling"},
		{"genymotion", "Genymotion VirtualBox board"},
		{"qemu", "QEMU direct boot (-kernel) default"},
		{"qemu64", "QEMU 64-bit CPU model name"},
		{"qemu_arm64", "QEMU arm64 direct boot"},
		{"cuttlefish", "Cuttlefish (Android cloud emulator)"},
		{"cf_x86_64_phone", "Cuttlefish phone target"},
	}
	for _, c := range cases {
		if !boardPlatformIsGeneric(c.platform) {
			t.Errorf("boardPlatformIsGeneric(%q) = false, want true (%s)", c.platform, c.why)
		}
	}
}

// TestVirtualPlatformsDoNotFireOnRealHandsetSocs is the false-positive guard. Every string
// here is a real SoC codename taken from the two handsets we measured plus the six SoCs in
// socProfiles. If a future edit to the platform list ever swallows one of these, this fails.
func TestVirtualPlatformsDoNotFireOnRealHandsetSocs(t *testing.T) {
	real := []string{
		"gs101",     // Pixel 6 (oriole) — measured
		"sdm845",    // MI 8 (dipper) — measured
		"mt6985",    // MediaTek Dimensity
		"sm8550",    // Snapdragon 8 Gen 2
		"sm8450",    // Snapdragon 8 Gen 1
		"sm8250",    // Snapdragon 865
		"pineapple", // Snapdragon 8 Gen 3 codename
		"tensor",    // Pixel Tensor
		"exynos",    // Samsung
		"kirin",     // HiSilicon
	}
	for _, soc := range real {
		if boardPlatformIsGeneric(soc) {
			t.Errorf("boardPlatformIsGeneric(%q) = true, but that is a real handset SoC codename", soc)
		}
	}
}

// TestVirtualPlatformsServerCpuIsNotAHandset covers the cloud/ARM-server case. Ampere Altra
// is an ARM part, so the `implementer 0x` guard would normally short-circuit and let it
// through as a handset. It must not: an Altra is a server CPU, and a phone reporting it is
// reporting a host.
func TestVirtualPlatformsServerCpuIsNotAHandset(t *testing.T) {
	cases := []struct {
		cpuInfo string
		why     string
	}{
		{"Ampere Altra Q80-30", "ARM server part"},
		{"Ampere Altra Max M128-30", "ARM server part"},
		{"ARM Neoverse-N1", "ARM server core"},
		{"AWS Graviton2", "cloud ARM instance"},
		{"Intel Xeon Platinum 8375C", "cloud x86 instance"},
		{"AMD EPYC 7R32", "cloud x86 instance"},
		{"QEMU Virtual CPU version 2.5+", "QEMU without KVM"},
		{"Common KVM processor", "KVM guest"},
	}
	for _, c := range cases {
		if !cpuInfoContradictsHandset(c.cpuInfo) {
			t.Errorf("cpuInfoContradictsHandset(%q) = false, want true (%s)", c.cpuInfo, c.why)
		}
	}
}

// TestVirtualPlatformsArmImplementerStillWins is the guard on the guard. A real ARM cpuinfo
// carries an `implementer 0x41` line. Some real devices ALSO mention a host string in a
// different line (rare, but a vendor comment or a "hardware" line can). The implementer
// line is a positive handset signal and must short-circuit before any marker match.
//
// This is the difference between "we found a suspicious word" and "this is definitely not a
// phone". Only the latter is allowed to cost 35 decisive points.
func TestVirtualPlatformsArmImplementerStillWins(t *testing.T) {
	cases := []string{
		"implementer 0x41 · part 0xd05 · architecture 8",      // arm64 handset
		"implementer 0x51 · part 0x804 · architecture 8",      // Qualcomm handset
		"CPU implementer 0x41\nCPU part 0xd0b\nqemu detected", // handset + a stray word
	}
	for _, c := range cases {
		if cpuInfoContradictsHandset(c) {
			t.Errorf("cpuInfoContradictsHandset(%q) = true, but the implementer line says handset", c)
		}
	}
}

// TestVirtualPlatformsUnknownIsNotEvidence is the deliberate non-decision. An unlisted
// platform string must return false. "I do not recognise this" is not the same as "this is
// a VM", and treating the two as equal is how a blocklist starts punishing new hardware.
func TestVirtualPlatformsUnknownIsNotEvidence(t *testing.T) {
	unknown := []string{
		"",                     // not archived
		"   ",                  // blank
		"some_future_platform", // a codename we have never seen
		"rk3588",               // Rockchip — a real SBC/tablet SoC, not in our list
		"mt6893",               // MediaTek we do not profile
	}
	for _, s := range unknown {
		if boardPlatformIsGeneric(s) {
			t.Errorf("boardPlatformIsGeneric(%q) = true, but an unrecognised string is not evidence", s)
		}
		if cpuInfoContradictsHandset(s) {
			t.Errorf("cpuInfoContradictsHandset(%q) = true, but an unrecognised string is not evidence", s)
		}
	}
}

// TestVirtualPlatformsPrefixStillWorks checks that the prefix rule survived the map
// expansion. AOSP ships strings like "generic_x86_64_arm64" that will never be listed
// literally, so the prefix path has to keep carrying them.
func TestVirtualPlatformsPrefixStillWorks(t *testing.T) {
	for _, s := range []string{
		"generic_x86_64_arm64",
		"generic_arm64",
		"aosp_arm64",
		"aosp_x86_64",
	} {
		if !boardPlatformIsGeneric(s) {
			t.Errorf("boardPlatformIsGeneric(%q) = false, want true via prefix", s)
		}
	}
}

// TestVirtualPlatformsStructuralEvidenceNamesTheChannel confirms the new coverage actually
// reaches the scored rule, not just the helper. A platform that only the helper knew about
// would be dead code.
func TestVirtualPlatformsStructuralEvidenceNamesTheChannel(t *testing.T) {
	// Waydroid: generic board, handset-looking cpuinfo. Only the board channel should fire.
	read := map[string]string{
		"system.boardPlatform": "waydroid",
		"cpu.cpuInfo":          "implementer 0x41 · part 0xd05 · architecture 8",
	}
	got := structuralVirtualEvidence(read)
	if len(got) != 1 || got[0] != "generic_board_platform" {
		t.Fatalf("structuralVirtualEvidence(waydroid) = %v, want [generic_board_platform]", got)
	}

	// Cloud VM: handset-looking board, host cpuinfo. Only the cpu channel should fire.
	read = map[string]string{
		"system.boardPlatform": "gs101",
		"cpu.cpuInfo":          "Ampere Altra Q80-30",
	}
	got = structuralVirtualEvidence(read)
	if len(got) != 1 || got[0] != "desktop_cpu_info" {
		t.Fatalf("structuralVirtualEvidence(ampere) = %v, want [desktop_cpu_info]", got)
	}
}

// TestVirtualPlatformsMeasuredDevicesStillClean re-runs the two handsets we actually have
// through the expanded rules. This is the regression that matters most: if the platform
// expansion ever costs a real phone 35 points, the whole scoring system is worthless.
func TestVirtualPlatformsMeasuredDevicesStillClean(t *testing.T) {
	cases := []struct {
		name string
		read map[string]string
	}{
		{
			name: "Pixel 6 oriole (measured 2026-11-26)",
			read: map[string]string{
				"system.boardPlatform": "gs101",
				"cpu.cpuInfo":          "implementer 0x41 · part 0xd0b · architecture 8",
			},
		},
		{
			name: "MI 8 dipper (measured 2026-11-26)",
			read: map[string]string{
				"system.boardPlatform": "sdm845",
				"cpu.cpuInfo":          "implementer 0x51 · part 0x800 · architecture 8",
			},
		},
	}
	for _, c := range cases {
		if got := structuralVirtualEvidence(c.read); len(got) != 0 {
			t.Errorf("%s: structuralVirtualEvidence = %v, want empty (no false positive)", c.name, got)
		}
	}
}

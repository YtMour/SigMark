package main

// Red team finding 1: an unregistered SoC silently skips four channels.
//
// Every SoC-conditional branch in hardwareFactsLabel is gated on `known &&`:
//
//	hardware_facts.go  cpu_core_set    (cpu.cpuParts)
//	                   gpu_family      (runtime.glesRenderer)
//	                   cpu_capacity    (cpu.cpuCapacity)
//	                   cma_total       (memory.cmaTotal)
//
// When declaredSoc cannot resolve the declaration to an entry in socProfiles, all four are
// skipped and nothing is written down. The label then aggregates only the channels that did
// run — ram_dispersion and overlay_codename — and reports `not_observed` if they agreed.
//
// That is the same shape of error as F12: "we never compared anything" is rendered
// identically to "we compared it and it agreed". A device whose SoC is not in the registry
// (six entries: gs101, mt6985, sm8550, sm8450, sm8250, sdm845) gets a clean hardware verdict
// for free, and the only way to notice is to know the registry by heart.
//
// The fix is not to guess expected values for unknown SoCs — that would invent facts. It is
// to publish the omission: each skipped channel records an `unregistered_soc:` basis so a
// reviewer can see exactly which questions were never asked.

import "testing"

// unregisteredFixture is a coherent-looking device whose SoC is deliberately absent from
// socProfiles. The RAM and overlay channels agree, so before the fix the label came out
// not_observed — a clean bill of health from a comparison that never happened.
func unregisteredFixture() map[string]string {
	return map[string]string{
		"memory.totalRam":       "11.20 GiB",
		"memory.physicalRam":    "11.20 GiB",
		"memory.kernelMemTotal": "11.20 GiB",
		// A real SoC that this repository has never registered.
		"system.socModel":                   "Snapdragon 8 Gen 3",
		"cpu.cpuParts":                      "0x41:0xd4e×1 / 0x41:0xd4d×3 / 0x41:0xd46×4",
		"runtime.glesRenderer":              "Adreno (TM) 750",
		"system.device":                     "aurora",
		"environment.overlayDeviceCodename": "aurora",
		"cpu.cpuCapacity":                   "178/422/1024",
		"memory.cmaTotal":                   "1024 MiB",
	}
}

func TestRedteamUnregisteredSocNamesTheChannelsItSkipped(t *testing.T) {
	label := factsFrom(unregisteredFixture())

	// The premise: the SoC really is unregistered, so every gated branch is dead.
	if _, _, known := declaredSoc(func(key string) string {
		return unregisteredFixture()[key]
	}); known {
		t.Fatal("fixture SoC is registered; it no longer demonstrates the gap")
	}

	want := []string{
		"unregistered_soc:cpu_core_set",
		"unregistered_soc:gpu_family",
		"unregistered_soc:cpu_capacity",
		"unregistered_soc:cma_total",
	}
	for _, basis := range want {
		if !containsString(label.Basis, basis) {
			t.Errorf("basis = %v, missing %q: a skipped channel must be named, not "+
				"silently dropped", label.Basis, basis)
		}
	}
}

// The aggregate state must not move. Naming an omission is an audit improvement, not a new
// verdict: a device that agreed on the channels that did run is still not_observed, and
// inventing `insufficient` here would downgrade every unregistered device in the archive.
func TestRedteamUnregisteredSocKeepsTheAggregateState(t *testing.T) {
	label := factsFrom(unregisteredFixture())
	if label.State != "not_observed" {
		t.Fatalf("state = %q, want not_observed: naming an omission must not change the "+
			"verdict", label.State)
	}
}

// The dangerous half of the fix. `unregistered_soc:` entries live in the same Basis slice
// as real conflict bases, and declarationAxis prices a non-overlay basis at 30 points. If
// the prefix is not excluded there, every unregistered device starts paying 30 points for
// a channel that was never compared — the exact opposite of the bug being fixed.
func TestRedteamUnregisteredSocDoesNotPayTheChannelConflictPrice(t *testing.T) {
	// A real conflict on a device whose SoC is also unregistered. The label is `hit`, so its
	// Basis holds conflicts followed by unset entries — both kinds present at once, which is
	// exactly the collision this test exists for.
	conflicting := unregisteredFixture()
	conflicting["memory.kernelMemTotal"] = "7.44 GiB" // disagrees with totalRam/physicalRam
	label := factsFrom(conflicting)
	if label.State != "hit" {
		t.Fatalf("state = %q, want hit: fixture must produce a real conflict", label.State)
	}

	priced := nonOverlayBasis(label.Basis)
	for _, basis := range priced {
		if hasPrefix(basis, "unregistered_soc:") {
			t.Fatalf("nonOverlayBasis = %v kept %q: an unregistered channel is not a "+
				"conflict and must never reach the 30-point deduction", priced, basis)
		}
	}
	// The genuine conflict must survive the exclusion, or it is too broad.
	if !containsString(priced, "ram_dispersion") {
		t.Fatalf("nonOverlayBasis = %v dropped the real conflict ram_dispersion", priced)
	}

	// The same exclusion on a registered device, where no gap marker exists at all.
	real := factsFrom(map[string]string{
		"memory.totalRam": "12.00 GiB", "memory.physicalRam": "12.00 GiB",
		"memory.kernelMemTotal":             "7.44 GiB",
		"system.socModel":                   "Tensor",
		"cpu.cpuParts":                      "0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2",
		"runtime.glesRenderer":              "Immortalis-G715",
		"system.device":                     "corot",
		"environment.overlayDeviceCodename": "oriole",
	})
	if got := nonOverlayBasis(real.Basis); !containsString(got, "ram_dispersion") {
		t.Fatalf("nonOverlayBasis dropped a real conflict: basis = %v", real.Basis)
	}
}

// A registered SoC must be untouched by this change: its branches all ran, so no
// unregistered_soc: entry may appear.
func TestRedteamRegisteredSocPublishesNoUnregisteredBasis(t *testing.T) {
	label := factsFrom(map[string]string{
		"memory.totalRam": "7.44 GiB", "memory.physicalRam": "7.43 GiB", "memory.kernelMemTotal": "7.44 GiB",
		"system.socModel": "Tensor", "cpu.cpuParts": "0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2",
		"runtime.glesRenderer": "Mali-G78", "system.device": "oriole",
		"environment.overlayDeviceCodename": "oriole",
		"cpu.cpuCapacity":                   "160/498/1024", "memory.cmaTotal": "652 MiB",
	})
	for _, basis := range label.Basis {
		if hasPrefix(basis, "unregistered_soc:") {
			t.Fatalf("registered SoC published %q; the gap marker must only appear when "+
				"the SoC is unknown", basis)
		}
	}
}

func hasPrefix(value, prefix string) bool {
	return len(value) >= len(prefix) && value[:len(prefix)] == prefix
}

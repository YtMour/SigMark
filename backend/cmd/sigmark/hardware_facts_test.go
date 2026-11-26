package main

import "testing"

func factsFrom(values map[string]string) profileLabel {
	return hardwareFactsLabel(func(key string) profileEvidence {
		value, ok := values[key]
		if !ok {
			return profileEvidence{Key: key, Status: "NOT_ARCHIVED"}
		}
		return profileEvidence{Key: key, Status: "AVAILABLE", Value: value}
	})
}

func TestHardwareFactsConfirmAcrossIndependentChannels(t *testing.T) {
	label := factsFrom(map[string]string{
		"memory.totalRam": "7.44 GiB", "memory.physicalRam": "7.43 GiB", "memory.kernelMemTotal": "7.44 GiB",
		"system.socModel": "Tensor", "cpu.cpuParts": "0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2",
		"runtime.glesRenderer": "Mali-G78", "system.device": "oriole",
		"environment.overlayDeviceCodename": "oriole",
		"cpu.cpuCapacity":                   "160/498/1024", "memory.cmaTotal": "652 MiB",
	})
	if label.State != "not_observed" || label.Code != "hardware_declaration_conflict" {
		t.Fatalf("consistent sample = %+v", label)
	}
}

func TestHardwareFactsFlagARewrittenDescription(t *testing.T) {
	// Shape of the observed Pixel 6 test unit: framework, libc and the GPU driver
	// answer for a Dimensity 9200+ phone, while /proc still answers for the original.
	label := factsFrom(map[string]string{
		"memory.totalRam": "12.00 GiB", "memory.physicalRam": "12.00 GiB", "memory.kernelMemTotal": "7.44 GiB",
		"system.socModel": "Dimensity 9200+", "cpu.cpuParts": "0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2",
		"runtime.glesRenderer": "Immortalis-G715", "system.device": "corot",
		"environment.overlayDeviceCodename": "oriole",
		"cpu.cpuCapacity":                   "160/498/1024", "memory.cmaTotal": "652 MiB",
	})
	if label.State != "hit" {
		t.Fatalf("rewritten description = %+v", label)
	}
	// Every evidence row must be a real archived reading, so the verdict can be
	// traced back to a field instead of a placeholder.
	if len(label.Evidence) != len(hardwareKeys) || label.Evidence[0].Key != "memory.totalRam" {
		t.Fatalf("evidence keys drifted: %+v", label.Evidence)
	}
	for _, row := range label.Evidence {
		if row.Status != "AVAILABLE" || row.Value == "" {
			t.Fatalf("placeholder evidence survived: %+v", row)
		}
	}
}

func TestHardwareFactsStayInsufficientWithoutComparableReadings(t *testing.T) {
	for name, values := range map[string]map[string]string{
		"nothing archived": {},
		"unlisted soc": {"system.socModel": "Exynos 2200", "cpu.cpuParts": "0x41:0xd46×4",
			"runtime.glesRenderer": "Xclipse 920"},
		"one ram channel only": {"memory.totalRam": "12.00 GiB", "system.socModel": "Tensor"},
	} {
		if got := factsFrom(values); got.State != "insufficient" {
			t.Errorf("%s = %+v", name, got)
		}
	}
}

func TestHardwareFactsParsers(t *testing.T) {
	if parts := coreParts("0x41:0xd05×4 / 0x41:0xd0b×2 / 0x41:0xd44×2"); len(parts) != 3 || !parts["0xd0b"] {
		t.Fatalf("core parts = %v", parts)
	}
	if parts := coreParts("0xd05×4"); !parts["0xd05"] {
		t.Fatalf("bare part = %v", parts)
	}
	if parts := coreParts("not a signature"); len(parts) != 0 {
		t.Fatalf("junk accepted: %v", parts)
	}
	if value, ok := gibValue("7.43 GiB"); !ok || value < 7.42 || value > 7.44 {
		t.Fatalf("gib parse = %v %v", value, ok)
	}
	if _, ok := gibValue("7798708 kB"); ok {
		t.Fatal("kB accepted as GiB")
	}
}

// The overlay file name is written into the image at build time, so it is the one
// channel a per-app codename rewrite cannot reach.
func TestHardwareFactsCatchARewrittenCodenameAlone(t *testing.T) {
	label := factsFrom(map[string]string{
		"system.device": "corot", "environment.overlayDeviceCodename": "oriole",
	})
	if label.State != "hit" {
		t.Fatalf("rewritten codename = %+v", label)
	}
	if got := factsFrom(map[string]string{
		"system.device": "oriole", "environment.overlayDeviceCodename": "oriole",
	}); got.State != "not_observed" {
		t.Fatalf("matching codename = %+v", got)
	}
	// One side missing is not a comparison.
	if got := factsFrom(map[string]string{"system.device": "corot"}); got.State != "insufficient" {
		t.Fatalf("single codename = %+v", got)
	}
}

// Field set 24. The capacity profile and the reserved pool are written by the kernel
// from the SoC layout, so a Tensor profile behind a Dimensity declaration is a
// positive identification of the other chip rather than a missing value.
func TestHardwareFactsCatchForeignCapacityProfile(t *testing.T) {
	base := map[string]string{"system.socModel": "Dimensity 9200+", "system.boardPlatform": "mt6985"}
	withCapacity := map[string]string{"cpu.cpuCapacity": "160/498/1024"}
	withCma := map[string]string{"memory.cmaTotal": "652 MiB"}
	for name, extra := range map[string]map[string]string{
		"capacity only": withCapacity,
		"cma only":      withCma,
	} {
		values := map[string]string{}
		for k, v := range base {
			values[k] = v
		}
		for k, v := range extra {
			values[k] = v
		}
		if got := factsFrom(values); got.State != "hit" {
			t.Errorf("%s = %+v", name, got)
		}
	}
	// The declared SoC matching its own registered profile is agreement, not a conflict.
	if got := factsFrom(map[string]string{
		"system.socModel": "Tensor", "cpu.cpuCapacity": "160/498/1024", "memory.cmaTotal": "652 MiB",
	}); got.State != "not_observed" {
		t.Fatalf("matching profile = %+v", got)
	}
	// An unregistered profile is not a verdict either way.
	if got := factsFrom(map[string]string{
		"system.socModel": "Dimensity 9200+", "cpu.cpuCapacity": "100/200/300",
	}); got.State != "insufficient" {
		t.Fatalf("unregistered profile = %+v", got)
	}
}

func TestCmaAndCapacityParsers(t *testing.T) {
	if value, ok := cmaValue("652 MiB"); !ok || value != 652 {
		t.Fatalf("cma parse = %v %v", value, ok)
	}
	if _, ok := cmaValue("667648 kB"); ok {
		t.Fatal("kB accepted as MiB")
	}
	if cmaText(652) != "652 MiB" {
		t.Fatalf("cma text = %q", cmaText(652))
	}
}

// The Mi 8 sample: a stock kernel 4.9 device that declares sdm845 through
// ro.board.platform, answers the core and GPU channels, exposes no cpu_capacity, and
// reports a CmaTotal that no registered profile claims. Every one of those has to stay
// out of the verdict rather than turn into a guess.
func TestHardwareFactsHandleAStockOlderKernel(t *testing.T) {
	label := factsFrom(map[string]string{
		"memory.totalRam": "5.50 GiB", "memory.physicalRam": "5.50 GiB", "memory.kernelMemTotal": "5.50 GiB",
		"system.boardPlatform": "sdm845", "cpu.cpuParts": "0x51:0x802×4 / 0x51:0x803×4",
		"runtime.glesRenderer": "Adreno (TM) 630", "system.device": "dipper",
		"memory.cmaTotal": "200 MiB",
	})
	if label.State != "not_observed" {
		t.Fatalf("stock sdm845 sample = %+v", label)
	}
	// A registered SoC answering only some channels still resolves; the rest stay unset.
	if _, profile, known := declaredSoc(func(key string) string {
		if key == "system.boardPlatform" {
			return "sdm845"
		}
		return ""
	}); !known || profile.label != "Snapdragon 845" {
		t.Fatalf("sdm845 must resolve through ro.board.platform: %v %+v", known, profile)
	}
	if socProfiles["sdm845"].cmaMiB != 0 || socProfiles["sdm845"].capacities != "" {
		t.Fatal("sdm845 must not carry unmeasured capacity or cma values")
	}
	// sdm845 carries no registered CmaTotal, so its own 200 MiB cannot be a conflict.
	// The Pixel value under an sdm845 declaration, however, still identifies the Pixel:
	// that is the whole point of the reverse lookup.
	if got := factsFrom(map[string]string{
		"system.boardPlatform": "sdm845", "memory.cmaTotal": "652 MiB",
	}); got.State != "hit" {
		t.Fatalf("652 MiB must still identify the Pixel behind an sdm845 declaration: %+v", got)
	}
}

// The verdict must publish which branch produced it. Without this the score layer has to
// re-derive the branch, which is a second implementation of the same question and drifts
// the moment a new rule is added here.
func TestHardwareFactsPublishTheirBasis(t *testing.T) {
	// A single decisive branch names exactly one basis. This fixture declares no SoC at all,
	// and a missing declaration is not a coverage gap — see socDeclared — so no
	// unregistered_soc: markers appear here.
	if got := factsFrom(map[string]string{
		"system.device": "corot", "environment.overlayDeviceCodename": "oriole",
	}); !sameStrings(got.Basis, []string{"overlay_codename"}) {
		t.Fatalf("codename-only basis = %v, want [overlay_codename]", got.Basis)
	}
	// A foreign profile names the measured channel, prefixed, so a consumer can tell it
	// apart from an ordinary dispersion conflict without consulting the SoC table.
	if got := factsFrom(map[string]string{
		"system.socModel": "Dimensity 9200+", "system.boardPlatform": "mt6985",
		"memory.cmaTotal": "652 MiB",
	}); !sameStrings(got.Basis, []string{"foreign_profile:memory.cmaTotal"}) {
		t.Fatalf("foreign basis = %v, want [foreign_profile:memory.cmaTotal]", got.Basis)
	}
	// Several branches can disagree at once, and every one of them is published: a
	// consumer that only saw the first would blame the wrong channel. This is the real
	// Pixel 6 shape — the codename and both foreign channels fire together.
	multi := factsFrom(map[string]string{
		"system.socModel": "Dimensity 9200+", "system.boardPlatform": "mt6985",
		"system.device": "corot", "environment.overlayDeviceCodename": "oriole",
		"cpu.cpuCapacity": "160/498/1024", "memory.cmaTotal": "652 MiB",
	})
	if multi.State != "hit" {
		t.Fatalf("multi-channel sample = %+v", multi)
	}
	for _, want := range []string{"overlay_codename", "foreign_profile:cpu.cpuCapacity",
		"foreign_profile:memory.cmaTotal"} {
		if !containsString(multi.Basis, want) {
			t.Errorf("basis = %v, missing %q", multi.Basis, want)
		}
	}
	// Agreement publishes its basis too, so "why is this clean" is answerable.
	if got := factsFrom(map[string]string{
		"system.device": "oriole", "environment.overlayDeviceCodename": "oriole",
	}); got.State != "not_observed" || !sameStrings(got.Basis, []string{"overlay_codename"}) {
		t.Fatalf("confirming basis = %v / %q", got.Basis, got.State)
	}
	// No channel answered: no basis, and no invented one.
	if got := factsFrom(map[string]string{}); len(got.Basis) != 0 {
		t.Fatalf("an undecidable label must publish no basis: %v", got.Basis)
	}
}

func sameStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

package main

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

// Field set 22 adds readings that do not come from the device's own declarations.
// The phone already derives a verdict; the archive recomputes it from the stored
// rows so a report cannot carry a claim its own evidence contradicts.

// Only SoCs with a written reference are listed. An unlisted chip stays
// insufficient instead of being guessed from a similar-looking string.
type socProfile struct {
	label string
	cores map[string]bool
	gpus  []string
	// capacities is the distinct cpu_capacity profile in core order; cmaMiB is the
	// contiguous pool the kernel reserved at boot. Both come from the SoC layout.
	capacities string
	cmaMiB     int
}

var socProfiles = map[string]socProfile{
	// Pixel 6 / 6 Pro: Cortex-X1 + A76 + A55, Mali-G78. Measured on a Pixel 6:
	// cpu0-3 = 160, cpu4-5 = 498, cpu6-7 = 1024; CmaTotal 667648 kB = 652 MiB.
	"gs101": {"Tensor G1", set("0xd44", "0xd0b", "0xd05"), []string{"mali-g78"}, "160/498/1024", 652},
	// Redmi K60 Ultra class: Cortex-X3 + A715 + A510, Immortalis-G715.
	"mt6985": {"Dimensity 9200+", set("0xd4e", "0xd4d", "0xd46"), []string{"mali-g715", "immortalis-g715"}, "", 0},
	// Snapdragon 8 Gen 2.
	"sm8550": {"Snapdragon 8 Gen 2", set("0xd4e", "0xd4d", "0xd46"), []string{"adreno"}, "", 0},
	// Snapdragon 8 Gen 1.
	"sm8450": {"Snapdragon 8 Gen 1", set("0xd48", "0xd47", "0xd46"), []string{"adreno"}, "", 0},
	// Snapdragon 865.
	"sm8250": {"Snapdragon 865", set("0xd0d", "0xd05"), []string{"adreno"}, "", 0},
	// Snapdragon 845: Cortex-A75 + A55, Adreno 630. Measured on a Mi 8 running the
	// stock kernel 4.9, which exposes no cpu_capacity at all, so only the two channels
	// that device actually answers for are registered. CmaTotal is a device-tree value
	// rather than a SoC constant, so it is left unset instead of guessed.
	"sdm845": {"Snapdragon 845", set("0x802", "0x803"), []string{"adreno"}, "", 0},
}

var socAliases = map[string]string{
	"tensor": "gs101", "tensor g1": "gs101", "google tensor": "gs101",
	"dimensity 9200+": "mt6985", "dimensity 9200": "mt6985",
	"snapdragon 8 gen 2": "sm8550", "snapdragon 8 gen 1": "sm8450", "snapdragon 865": "sm8250",
	"snapdragon 845": "sdm845",
}

func set(values ...string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, v := range values {
		out[v] = true
	}
	return out
}

var corePartToken = regexp.MustCompile(`0x[0-9a-f]{1,4}`)
var gibPattern = regexp.MustCompile(`^([0-9]+(?:\.[0-9]+)?) GiB$`)

// "0x41:0xd05×4 / 0x41:0xd0b×2" -> {"0xd05", "0xd0b"}
func coreParts(signature string) map[string]bool {
	out := map[string]bool{}
	for _, chunk := range strings.Split(signature, "/") {
		chunk = strings.TrimSpace(chunk)
		if cut := strings.Index(chunk, "×"); cut >= 0 {
			chunk = chunk[:cut]
		}
		if cut := strings.LastIndex(chunk, ":"); cut >= 0 {
			chunk = chunk[cut+1:]
		}
		if corePartToken.MatchString(chunk) && corePartToken.FindString(chunk) == chunk {
			out[chunk] = true
		}
	}
	return out
}

func gibValue(raw string) (float64, bool) {
	m := gibPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if m == nil {
		return 0, false
	}
	value, err := strconv.ParseFloat(m[1], 64)
	return value, err == nil
}

// declaredSoc resolves the archived declaration to a known profile. The order
// mirrors the phone so both sides pick the same claim when several disagree.
func declaredSoc(read func(string) string) (string, socProfile, bool) {
	for _, key := range []string{"system.socModel", "system.boardPlatform", "cpu.hardware", "system.board"} {
		value := strings.ToLower(strings.TrimSpace(read(key)))
		if value == "" {
			continue
		}
		if _, ok := socProfiles[value]; ok {
			return value, socProfiles[value], true
		}
		if id, ok := socAliases[value]; ok {
			return id, socProfiles[id], true
		}
	}
	return "", socProfile{}, false
}

// socDeclared reports whether the report names an SoC at all. declaredSoc returning
// `known == false` conflates two different situations — "no declaration was archived" and
// "a declaration exists but the registry has never heard of it" — and only the second is a
// gap in our coverage. This separates them without changing the resolution order.
func socDeclared(read func(string) string) bool {
	for _, key := range []string{"system.socModel", "system.boardPlatform", "cpu.hardware", "system.board"} {
		if strings.TrimSpace(read(key)) != "" {
			return true
		}
	}
	return false
}

// hardwareFactsLabel mirrors the on-device rule. Any conflict is a reason to
// re-check the test conditions; it is not a verdict about the physical device.
// hardwareKeys is the evidence list in wire order; every row is a real archived
// reading, never a placeholder, so a reviewer can trace the verdict to a field.
var hardwareKeys = []string{"memory.totalRam", "memory.physicalRam", "memory.kernelMemTotal",
	"cpu.cpuParts", "system.socModel", "runtime.glesRenderer", "system.device", "environment.overlayDeviceCodename",
	"cpu.cpuCapacity", "memory.cmaTotal"}

func hardwareFactsLabel(lookup func(string) profileEvidence) profileLabel {
	out := profileLabel{Code: "hardware_declaration_conflict", State: "insufficient", Evidence: []profileEvidence{}}
	read := func(key string) string {
		row := lookup(key)
		if row.Status != "AVAILABLE" {
			return ""
		}
		return row.Value
	}
	for _, key := range hardwareKeys {
		out.Evidence = append(out.Evidence, lookup(key))
	}

	type channel struct {
		conflict  bool
		confirmed bool
		// unset marks a channel the declared SoC *does* register but whose expected value
		// was left blank. It is neither a conflict nor a confirmation: there is nothing to
		// compare against. Before this existed the channel was skipped silently, which made
		// an unmeasured expectation indistinguishable from a channel that had been checked
		// and agreed — the label reported not_observed for a question nobody asked.
		unset bool
		// basis names the branch that produced this channel. It is carried all the way
		// out to the label so a consumer never has to re-derive the reason: the score
		// layer needs to tell a foreign-profile identification apart from an ordinary
		// dispersion conflict, and guessing that by re-running this function with a
		// restricted evidence view was a second, weaker implementation of the same
		// question.
		basis string
	}
	channels := make([]channel, 0, 6)

	var ram []float64
	for _, key := range []string{"memory.totalRam", "memory.physicalRam", "memory.kernelMemTotal"} {
		if value, ok := gibValue(read(key)); ok && value > 0.5 {
			ram = append(ram, value)
		}
	}
	if len(ram) >= 2 {
		low, high := ram[0], ram[0]
		for _, value := range ram[1:] {
			low = math.Min(low, value)
			high = math.Max(high, value)
		}
		channels = append(channels, channel{conflict: (high-low)/high > 0.08, confirmed: (high-low)/high <= 0.08,
			basis: "ram_dispersion"})
	}

	declaredID, profile, known := declaredSoc(read)
	// Every branch below is gated on `known`. When the registry does not know the SoC those
	// branches are skipped, and before this block nothing recorded that fact: the label
	// aggregated only ram_dispersion and overlay_codename, and a device whose four SoC
	// channels were never compared came out not_observed — indistinguishable from one that
	// was compared and agreed. Same shape of error as PROFILE_UNSET above, one level up.
	//
	// The fix does not guess expected values for unknown SoCs; that would invent facts. It
	// publishes the omission so a reviewer can see which questions were never asked.
	// A declaration that names an SoC we do not know is a gap worth naming. A report that
	// names no SoC at all is a different case: there is nothing to have looked up, so
	// inventing four gap markers there would turn "this old report has no such field" into
	// "we tried and failed". Only the first case gets markers.
	if !known && socDeclared(read) {
		for _, skipped := range []string{"cpu_core_set", "gpu_family", "cpu_capacity", "cma_total"} {
			channels = append(channels, channel{unset: true, basis: "unregistered_soc:" + skipped})
		}
	}
	parts := coreParts(read("cpu.cpuParts"))
	if known && len(parts) > 0 {
		hit := false
		for part := range parts {
			if profile.cores[part] {
				hit = true
				break
			}
		}
		channels = append(channels, channel{conflict: !hit, confirmed: hit, basis: "cpu_core_set"})
	}
	renderer := strings.ToLower(strings.TrimSpace(read("runtime.glesRenderer")))
	if known && renderer != "" {
		hit := false
		for _, gpu := range profile.gpus {
			if strings.Contains(renderer, gpu) {
				hit = true
				break
			}
		}
		channels = append(channels, channel{conflict: !hit, confirmed: hit, basis: "gpu_family"})
	}

	// The overlay file name is a build artifact: it is written into the image, not
	// read back from a property, so a rewritten codename leaves it untouched.
	device, overlay := strings.TrimSpace(read("system.device")), strings.TrimSpace(read("environment.overlayDeviceCodename"))
	if device != "" && overlay != "" {
		same := identityComparableForm(device) == identityComparableForm(overlay)
		channels = append(channels, channel{conflict: !same, confirmed: same, basis: "overlay_codename"})
	}

	// Field set 24. The capacity profile and the reserved contiguous pool are fixed by
	// the SoC's own core and memory layout. A match against a *different* registered SoC
	// is a positive identification, so no expected value is guessed for the others.
	//
	// Order matters and is not arbitrary: confirmed → foreign → unset. Putting the unset
	// arm first silently killed every FOREIGN_PROFILE on every SoC whose registry entry
	// has no capacities/cmaMiB — which is all of them except gs101, i.e. exactly the
	// devices where foreign identification is the only thing that can fire. A positive
	// identification must always beat "we have nothing to compare against".
	//
	// The unset arm is the PROFILE_UNSET case (§13 F12): the SoC is registered, the
	// reading is present, but the registry never recorded what this SoC should measure.
	// Skipping it silently was wrong — it made "we never wrote this down" look exactly
	// like "we checked and it agreed".
	if known {
		if capacity := strings.TrimSpace(read("cpu.cpuCapacity")); capacity != "" {
			switch {
			case profile.capacities == capacity:
				channels = append(channels, channel{confirmed: true, basis: "cpu_capacity"})
			case foreignProfile(declaredID, capacity, func(p socProfile) string { return p.capacities }):
				channels = append(channels, channel{conflict: true, basis: "foreign_profile:cpu.cpuCapacity"})
			case profile.capacities == "":
				channels = append(channels, channel{unset: true, basis: "profile_unset:cpu.cpuCapacity"})
			}
		}
		if cma, ok := cmaValue(read("memory.cmaTotal")); ok {
			switch {
			case profile.cmaMiB == cma:
				channels = append(channels, channel{confirmed: true, basis: "cma_total"})
			case foreignProfile(declaredID, cmaText(cma), func(p socProfile) string {
				if p.cmaMiB == 0 {
					return ""
				}
				return cmaText(p.cmaMiB)
			}):
				channels = append(channels, channel{conflict: true, basis: "foreign_profile:memory.cmaTotal"})
			case profile.cmaMiB == 0:
				channels = append(channels, channel{unset: true, basis: "profile_unset:memory.cmaTotal"})
			}
		}
	}

	// A conflict outranks agreement: one contradictory pair is enough to review. Every
	// conflicting channel is published, not just the first, so the deduction ledger can
	// name the exact branches that disagreed instead of inferring them.
	conflicts, confirmed, unset := []string{}, []string{}, []string{}
	for _, c := range channels {
		switch {
		case c.conflict:
			conflicts = append(conflicts, c.basis)
		case c.unset:
			unset = append(unset, c.basis)
		case c.confirmed:
			confirmed = append(confirmed, c.basis)
		}
	}
	// The aggregate state and the unset channels are published together, never one instead
	// of the other. `unset` answers "was this channel compared to anything at all?", which
	// stays a real gap even when another channel already settled the state — the first
	// version returned early on the confirmed branch and the unset basis vanished, which
	// is exactly the silent-omission bug this reason code was added to fix.
	if len(conflicts) > 0 {
		out.State = "hit"
		out.Basis = append(conflicts, unset...)
		return out
	}
	if len(confirmed) > 0 {
		out.State = "not_observed"
		out.Basis = append(confirmed, unset...)
		return out
	}
	// Nothing was compared because the registry has no expected value for this SoC. The
	// state stays insufficient — that part was always right — but the *reason* is now
	// nameable instead of being an unexplained blank. The basis carries the
	// `profile_unset:` prefix so the score layer can map it to the PROFILE_UNSET reason
	// without re-deriving anything.
	out.Basis = unset
	return out
}

var cmaPattern = regexp.MustCompile(`^([0-9]+) MiB$`)

func cmaValue(raw string) (int, bool) {
	m := cmaPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if m == nil {
		return 0, false
	}
	value, err := strconv.Atoi(m[1])
	return value, err == nil
}

func cmaText(mib int) string { return strconv.Itoa(mib) + " MiB" }

// foreignProfile reports whether the measured value equals a registered SoC other than
// the declared one. That is a positive identification, so nothing has to be assumed
// about what the declared SoC should measure.
func foreignProfile(declaredID, measured string, field func(socProfile) string) bool {
	if measured == "" {
		return false
	}
	for id, candidate := range socProfiles {
		if id == declaredID {
			continue
		}
		if want := field(candidate); want != "" && want == measured {
			return true
		}
	}
	return false
}

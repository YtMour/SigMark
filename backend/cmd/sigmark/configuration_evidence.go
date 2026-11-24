package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
)

const configurationCodeVersion = "sigmark-config-code/2"

// Three components: declared model family, chipset-level claim, installed build.
// Each hashes its own inputs, so a rewritten property family does not move the others.
var codeDomains = []struct {
	name, prefix string
	keys         []string
}{
	{"product", "P2", []string{"system.brand", "system.model", "system.device", "cpu.abis"}},
	{"hardware", "H2", []string{"cpu.hardware", "system.board", "cpu.coresConfigured", "system.initialSdk"}},
	{"rom", "R2", []string{"system.type", "system.buildId", "system.incremental", "system.patch"}},
}

type codeInput struct {
	Key     string     `json:"key"`
	Reading *Parameter `json:"reading"`
	Change  string     `json:"change,omitempty"`
}
type codeComponent struct {
	Domain    string      `json:"domain"`
	Code      string      `json:"code,omitempty"`
	Available int         `json:"available"`
	Inputs    []codeInput `json:"inputs"`
}
type configurationCode struct {
	Version          string          `json:"version"`
	PreviousReportID string          `json:"previousReportId,omitempty"`
	Components       []codeComponent `json:"components"`
}

func canonicalCodeValue(p Parameter) string {
	if p.Status != "AVAILABLE" || p.Value == nil {
		return ""
	}
	return strings.Trim(*p.Value, " \t\r\n")
}

func archivedCode(current Report, prior *storedReport) configurationCode {
	index := func(report Report) map[string]Parameter {
		out := make(map[string]Parameter, len(report.Parameters))
		for _, p := range report.Parameters {
			out[p.Group+"."+p.Key] = p
		}
		return out
	}
	now := index(current)
	out := configurationCode{Version: configurationCodeVersion}
	var before map[string]Parameter
	if prior != nil {
		before = index(prior.Report)
		out.PreviousReportID = prior.ID
	}
	for _, d := range codeDomains {
		part := codeComponent{Domain: d.name}
		var canonical strings.Builder
		fmt.Fprintf(&canonical, "%s/%s\n", configurationCodeVersion, d.name)
		for _, key := range d.keys {
			p, found := now[key]
			text := canonicalCodeValue(p)
			input := codeInput{Key: key}
			if found {
				input.Reading = &p
			}
			if prior != nil {
				old := canonicalCodeValue(before[key])
				switch {
				case old == text && (before[key].Status != p.Status || before[key].Reason != p.Reason):
					input.Change = "status_changed"
				case old == text:
				case old == "":
					input.Change = "gained"
				case text == "":
					input.Change = "lost"
				default:
					input.Change = "changed"
				}
			}
			if text != "" {
				part.Available++
				fmt.Fprintf(&canonical, "%s=%d:%s\n", key, len(text), text)
			} else {
				fmt.Fprintf(&canonical, "%s=-\n", key)
			}
			part.Inputs = append(part.Inputs, input)
		}
		if part.Available == len(d.keys) {
			sum := sha256.Sum256([]byte(canonical.String()))
			part.Code = d.prefix + "-" + hex.EncodeToString(sum[:16])
		}
		out.Components = append(out.Components, part)
	}
	return out
}

// sysfsFieldSpec lists every node one observation may legitimately come from.
// paths[0] is the primary node: the field dictionary and the dossier always show it.
type sysfsFieldSpec struct {
	paths []string
	unit  string
}

func (s sysfsFieldSpec) path() string { return s.paths[0] }

func (s sysfsFieldSpec) allows(source string) bool {
	for _, candidate := range s.paths {
		if source == candidate {
			return true
		}
	}
	return false
}

var sysfsFields = map[string]sysfsFieldSpec{
	"cpu.sysCpuPossible": {
		paths: []string{"/sys/devices/system/cpu/possible"},
		unit:  "Linux CPU list",
	},
	"cpu.sysCpuOnline": {
		paths: []string{"/sys/devices/system/cpu/online"},
		unit:  "Linux CPU list",
	},
	// Kernel battery drivers expose the same tenths-of-°C reading at either node;
	// the battery path stays primary because it is the documented one.
	"battery.sysBatteryTemp": {
		paths: []string{"/sys/class/power_supply/battery/temp", "/sys/class/power_supply/bms/temp"},
		unit:  "0.1 °C",
	},
}

func validCPUList(value string) bool {
	if len(value) >= 128 {
		return false
	}
	var seen [4096]bool
	for _, part := range strings.Split(value, ",") {
		a, b, rangeSet := strings.Cut(part, "-")
		if !rangeSet {
			b = a
		}
		if !compactIntRange(a, 0, 4095) || !compactIntRange(b, 0, 4095) {
			return false
		}
		lo, _ := strconv.Atoi(a)
		hi, _ := strconv.Atoi(b)
		if lo > hi {
			return false
		}
		for i := lo; i <= hi; i++ {
			if seen[i] {
				return false
			}
			seen[i] = true
		}
	}
	return true
}

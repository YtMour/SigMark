package main

import "testing"

// The decisive experiment the red-team predicted but did not run.
//
// Both earlier laundering experiments were contaminated, and the contamination was the same
// kind each time — the fixture carried an unrelated finding that made the baseline unreachable:
//
//	experiment 1 (pixel6Evidence): FOREIGN_PROFILE(30) + OVERLAY_CODENAME_MISMATCH(15)
//	experiment 2 (this file's predecessor): memory.kernelMemTotal 7.44 GiB vs totalRam 12.00 GiB
//	    is 38% dispersion, over the 8% threshold (hardware_facts.go:160), so ram_dispersion
//	    fired HARDWARE_CHANNEL_CONFLICT for 30 points (score.go:765) and the baseline was 88/B,
//	    never 100. "Laundering did not reach A" was therefore guaranteed by the fixture, not
//	    by any protection in the rule.
//
// The predicted fix was to make the baseline genuinely clean. If the baseline reaches 100/A,
// then laundering returns to 100/A and the vulnerability is exactly as severe as the red team
// originally claimed — a confirmed disguise becomes 一致 with no trace.
func TestRedteamLaunderingFromAGenuinelyCleanBaseline(t *testing.T) {
	// kernelMemTotal is set so that dispersion vs 12.00 GiB stays inside the 8% threshold:
	// 11.20 vs 12.00 is 6.7%, which confirms the channel instead of conflicting with it.
	base := map[string]string{
		"system.model":                      "23078PND5G",
		"system.propertyModel":              "23078PND5G",
		"system.device":                     "corot",
		"system.propertyDevice":             "corot",
		"system.sku":                        "GR1YH",
		"system.hardwareSku":                "GR1YH",
		"environment.overlayDeviceCodename": "corot",
		"cpu.cpuCapacity":                   "160/498/1024",
		"memory.cmaTotal":                   "652 MiB",
		"memory.totalRam":                   "12.00 GiB",
		"memory.physicalRam":                "12.00 GiB",
		"memory.kernelMemTotal":             "11.20 GiB",
		"system.socModel":                   "Tensor",
		"runtime.glesRenderer":              "Mali-G78",
		"cpu.cpuParts":                      "4x2.80 GHz Cortex-X1 + 4x2.20 GHz Cortex-A76",
		"system.selinux":                    "Enforcing（强制模式）",
		"app.debuggerConnected":             "否",
		"environment.tracerPid":             "0",
		"environment.hookSignals":           "none",
		"environment.rootMountHints":        "none",
		"environment.rootManagerVisible":    "none",
		"environment.userProfile":           "owner",
		"cpu.hardware":                      "qcom",
		"system.product":                    "corot",
		"system.partitionBuildDates":        "system 2026-01-15",
		"system.initialSdk":                 "34",
		"system.bootCount":                  "80",
	}

	clean := scoreEvidenceAt(base, nil, 2026)
	cleanDecl := scoreAxisByCode(t, clean, axisDeclaration)
	t.Logf("clean    : value=%v band=%s decl cov=%v deductions=%d",
		derefScore(clean.Value), clean.Band, cleanDecl.Coverage, len(cleanDecl.Deductions))
	for _, d := range cleanDecl.Deductions {
		t.Logf("  clean deduction: %s %d pts %v", d.Code, d.Points, d.Keys)
	}

	conflict := map[string]string{}
	for k, v := range base {
		conflict[k] = v
	}
	conflict["system.propertyModel"] = "Pixel 6"
	conflictScore := scoreEvidenceAt(conflict, nil, 2026)
	conflictDecl := scoreAxisByCode(t, conflictScore, axisDeclaration)
	t.Logf("conflict : value=%v band=%s decl cov=%v deductions=%d",
		derefScore(conflictScore.Value), conflictScore.Band, conflictDecl.Coverage, len(conflictDecl.Deductions))

	laundered := map[string]string{}
	for k, v := range conflict {
		laundered[k] = v
	}
	laundered["system.propertyModel"] = ""
	launderedScore := scoreEvidenceAt(laundered, nil, 2026)
	launderedDecl := scoreAxisByCode(t, launderedScore, axisDeclaration)
	t.Logf("laundered: value=%v band=%s decl cov=%v deductions=%d",
		derefScore(launderedScore.Value), launderedScore.Band, launderedDecl.Coverage, len(launderedDecl.Deductions))

	// The baseline must actually be clean for this experiment to mean anything. This is the
	// check that was missing from the previous two attempts.
	if clean.Band != bandA || clean.Value == nil || *clean.Value != 100 {
		t.Fatalf("baseline is not clean: %v/%s — this experiment would be contaminated again",
			derefScore(clean.Value), clean.Band)
	}
	if len(cleanDecl.Deductions) != 0 {
		t.Fatalf("baseline carries %d declaration deductions, want 0", len(cleanDecl.Deductions))
	}
	// The conflict must be a real, decisive finding.
	if conflictScore.Band != bandD {
		t.Fatalf("the conflict must grade D, got %s", conflictScore.Band)
	}
	// The decisive question.
	if launderedScore.Band == bandA && launderedScore.Value != nil && *launderedScore.Value == 100 {
		t.Fatalf("CONFIRMED SEVERE: from a clean 100/A baseline, blanking one property restores "+
			"%d/%s — a confirmed disguise becomes 一致 with no trace anywhere in the document",
			*launderedScore.Value, launderedScore.Band)
	}
	t.Logf("laundered band = %s (value %v): not a clean 100/A",
		launderedScore.Band, derefScore(launderedScore.Value))
}

package main

import "testing"

// The previous test used the *real* Pixel 6 evidence, which carries its own FOREIGN_PROFILE
// and overlay findings, so the laundering result (82/D) was contaminated by unrelated
// deductions and proved nothing about the laundering itself.
//
// This test isolates the question. It builds a device that is clean on the declaration axis
// except for ONE identity pair, reads the overlay (so the axis keeps 2/3 coverage), and then
// blanks one side of that pair. Nothing else is wrong with it. If the laundered report comes
// out 100/A, then "delete one property" is a complete disguise on any device whose overlay
// channel is readable — which is most real hardware, since the overlay property is readable
// on Pixel-class devices.
func TestRedteamLaunderingIsolateACompletelyCleanDevice(t *testing.T) {
	// A clean declaration picture: model/device/sku all agree, overlay readable and agreeing,
	// and no hardware conflicts. Then one identity pair is made to disagree.
	base := map[string]string{
		"system.model":                      "23078PND5G",
		"system.propertyModel":              "23078PND5G",
		"system.device":                     "corot",
		"system.propertyDevice":             "corot",
		"system.sku":                        "GR1YH",
		"system.hardwareSku":                "GR1YH",
		"environment.overlayDeviceCodename": "corot",
		// A hardware profile that matches, so no FOREIGN_PROFILE fires.
		"cpu.cpuCapacity":       "160/498/1024",
		"memory.cmaTotal":       "652 MiB",
		"memory.totalRam":       "12.00 GiB",
		"memory.physicalRam":    "12.00 GiB",
		"memory.kernelMemTotal": "7.44 GiB",
		"system.socModel":       "Tensor",
		"runtime.glesRenderer":  "Mali-G78",
		"cpu.cpuParts":          "4x2.80 GHz Cortex-X1 + 4x2.20 GHz Cortex-A76",
		// behavior clean
		"system.selinux":                 "Enforcing（强制模式）",
		"app.debuggerConnected":          "否",
		"environment.tracerPid":          "0",
		"environment.hookSignals":        "none",
		"environment.rootMountHints":     "none",
		"environment.rootManagerVisible": "none",
		"environment.userProfile":        "owner",
		"cpu.hardware":                   "qcom",
		"system.product":                 "corot",
		// usage clean
		"system.partitionBuildDates": "system 2026-01-15",
		"system.initialSdk":          "34",
		"system.bootCount":           "80",
	}

	clean := scoreEvidenceAt(base, nil, 2026)
	t.Logf("clean    : value=%v band=%s decl cov=%v",
		derefScore(clean.Value), clean.Band, scoreAxisByCode(t, clean, axisDeclaration).Coverage)

	// Introduce exactly one identity disagreement.
	conflict := map[string]string{}
	for k, v := range base {
		conflict[k] = v
	}
	conflict["system.propertyModel"] = "Pixel 6"
	conflictScore := scoreEvidenceAt(conflict, nil, 2026)
	conflictDecl := scoreAxisByCode(t, conflictScore, axisDeclaration)
	t.Logf("conflict : value=%v band=%s decl cov=%v deductions=%d",
		derefScore(conflictScore.Value), conflictScore.Band, conflictDecl.Coverage, len(conflictDecl.Deductions))

	// Blank the side that carries the disagreement — the "launder".
	laundered := map[string]string{}
	for k, v := range conflict {
		laundered[k] = v
	}
	laundered["system.propertyModel"] = ""
	launderedScore := scoreEvidenceAt(laundered, nil, 2026)
	launderedDecl := scoreAxisByCode(t, launderedScore, axisDeclaration)
	t.Logf("laundered: value=%v band=%s decl cov=%v deductions=%d",
		derefScore(launderedScore.Value), launderedScore.Band, launderedDecl.Coverage, len(launderedDecl.Deductions))

	if launderedDecl.Coverage < scoreCoverageFloor {
		t.Logf("declaration went blind (cov %v): R10 withholds the number", launderedDecl.Coverage)
		return
	}
	if launderedScore.Band == bandA {
		t.Fatalf("CONFIRMED SEVERE: a clean device with one identity conflict, laundered by "+
			"blanking one property, publishes %d/%s — the disguise is complete",
			*launderedScore.Value, bandA)
	}
	t.Logf("laundered band = %s (value %v): not %s, so the laundering is not a complete disguise",
		launderedScore.Band, derefScore(launderedScore.Value), bandA)
}

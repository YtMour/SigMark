package main

import (
	"testing"
)

// The QEMU boot flag is the third virtualisation channel and the easiest one to silence,
// which makes both of its directions worth pinning:
//
//   - when it is the only channel that fires, it must still decide (D, 35 points), or an
//     emulator that defeats the blocklist and hides its desktop CPU would pass;
//   - when another channel already fired, it must stay silent, or one cause gets charged
//     two or three times.
//
// The absence direction matters just as much and is easier to get wrong: a real handset
// reads UNAVAILABLE for ro.boot.qemu, which is the same reading an emulator produces after
// `resetprop` deletes the property. So absence must never be read as "clean".

// qemuFlagReport builds a minimal report whose only virtualisation evidence is bootQemu.
// The identity fields are a plausible handset so the declaration axis stays quiet and the
// behaviour axis is the only thing under test.
func qemuFlagReport(bootQemu string, status string) []Parameter {
	params := []Parameter{
		{Group: "system", Key: "model", Label: "型号", Status: "AVAILABLE", Value: strPtr("Pixel 6")},
		{Group: "system", Key: "manufacturer", Label: "厂商", Status: "AVAILABLE", Value: strPtr("Google")},
		{Group: "system", Key: "device", Label: "设备代号", Status: "AVAILABLE", Value: strPtr("oriole")},
		{Group: "system", Key: "hardware", Label: "硬件", Status: "AVAILABLE", Value: strPtr("oriole")},
		{Group: "system", Key: "boardPlatform", Label: "板级平台", Status: "AVAILABLE", Value: strPtr("gs101")},
		{Group: "cpu", Key: "cpuInfo", Label: "CPU 信息", Status: "AVAILABLE",
			Value: strPtr("ARMv8 Processor rev 1 (v8l)")},
	}
	if bootQemu == "" && status != "AVAILABLE" {
		params = append(params, Parameter{Group: "system", Key: "bootQemu", Label: "QEMU 启动标记",
			Status: status, Value: nil})
		return params
	}
	params = append(params, Parameter{Group: "system", Key: "bootQemu", Label: "QEMU 启动标记",
		Status: status, Value: strPtr(bootQemu)})
	return params
}

func strPtr(s string) *string { return &s }

// The positive direction: the flag alone must be decisive.
func TestQemuBootFlagAloneIsDecisive(t *testing.T) {
	axis, caps, _ := behaviorAxis(nil, qemuFlagReport("1", "AVAILABLE"))

	if len(caps) == 0 {
		t.Fatalf("bootQemu=1 produced no cap; the flag is the only virtualisation evidence here")
	}
	if caps[0].Band != bandD {
		t.Errorf("cap band = %q, want D", caps[0].Band)
	}
	var found bool
	for _, d := range axis.Deductions {
		if d.Code == "QEMU_BOOT_FLAG" {
			found = true
			if d.Points != qemuBootFlagPoints {
				t.Errorf("QEMU_BOOT_FLAG points = %d, want %d", d.Points, qemuBootFlagPoints)
			}
			if len(d.Keys) != 1 || d.Keys[0] != "system.bootQemu" {
				t.Errorf("QEMU_BOOT_FLAG keys = %v, want [system.bootQemu]", d.Keys)
			}
		}
	}
	if !found {
		t.Fatalf("bootQemu=1 produced no QEMU_BOOT_FLAG deduction; got %v", deductionCodes(axis))
	}
	// 100 - 35 = 65. If this is 100 the deduction was appended after finalizeScoreAxis,
	// which is the exact bug that hid the structural channel's 35 points for a whole release.
	if axis.Score == nil {
		t.Fatalf("behaviour axis published no score with a deduction on it")
	}
	if *axis.Score != 65 {
		t.Errorf("behaviour score = %d, want 65 (100 - 35)", *axis.Score)
	}
}

// The absence direction: a real handset reads UNAVAILABLE, and that must stay silent.
// A channel that treats "not reported" as evidence would fire on every handset.
func TestQemuBootFlagAbsenceIsNotEvidence(t *testing.T) {
	for _, status := range []string{"UNAVAILABLE", "RESTRICTED", "ERROR"} {
		axis, caps, _ := behaviorAxis(nil, qemuFlagReport("", status))
		if len(caps) != 0 {
			t.Errorf("%s produced a cap; absence must not be evidence", status)
		}
		for _, d := range axis.Deductions {
			if d.Code == "QEMU_BOOT_FLAG" {
				t.Errorf("%s produced a QEMU_BOOT_FLAG deduction", status)
			}
		}
	}
}

// "0" is a real answer from the bootloader and means it did not claim QEMU.
func TestQemuBootFlagZeroIsAClaimOfCleanlinessAndSilent(t *testing.T) {
	axis, caps, _ := behaviorAxis(nil, qemuFlagReport("0", "AVAILABLE"))
	if len(caps) != 0 {
		t.Errorf("bootQemu=0 produced a cap")
	}
	for _, d := range axis.Deductions {
		if d.Code == "QEMU_BOOT_FLAG" {
			t.Errorf("bootQemu=0 produced a deduction")
		}
	}
}

// An unrecognised value is not evidence. This is the guard against firing on a future
// format we have not seen — a channel that fires on surprises is not a channel.
func TestQemuBootFlagUnrecognisedValueIsSilent(t *testing.T) {
	for _, v := range []string{"", "true", "yes", "2", "11", "01", "-1"} {
		axis, caps, _ := behaviorAxis(nil, qemuFlagReport(v, "AVAILABLE"))
		if len(caps) != 0 {
			t.Errorf("bootQemu=%q produced a cap; only the literal \"1\" is evidence", v)
		}
		for _, d := range axis.Deductions {
			if d.Code == "QEMU_BOOT_FLAG" {
				t.Errorf("bootQemu=%q produced a deduction", v)
			}
		}
	}
}

// R2: one cause, one deduction. A device that reports the flag *and* contradicts itself
// structurally must not be charged twice.
func TestQemuBootFlagYieldsToOneCauseOneDeduction(t *testing.T) {
	params := qemuFlagReport("1", "AVAILABLE")
	// Make the structural channel fire too: a desktop CPU on a handset.
	for i := range params {
		if params[i].Group == "cpu" && params[i].Key == "cpuInfo" {
			params[i].Value = strPtr("AMD Ryzen 9 9950X 16-Core Processor")
		}
	}
	axis, caps, _ := behaviorAxis(nil, params)

	var structural, qemu int
	for _, d := range axis.Deductions {
		switch d.Code {
		case "STRUCTURAL_VIRTUAL_EVIDENCE":
			structural++
		case "QEMU_BOOT_FLAG":
			qemu++
		}
	}
	if structural+qemu != 1 {
		t.Fatalf("structural=%d qemu=%d, want exactly one of them to fire", structural, qemu)
	}
	// Two channels firing is still one decisive cap, not two.
	if len(caps) != 1 {
		t.Errorf("caps = %d, want 1; two channels reporting one cause is still one cause", len(caps))
	}
	// 100 - 35 = 65 either way. If both fired the score would be 30.
	if axis.Score == nil || *axis.Score != 65 {
		t.Errorf("behaviour score = %v, want 65", axis.Score)
	}
}

// The blocklist rule outranks both fallback channels: when a build marker already hit,
// neither the structural channel nor the flag may add a second deduction.
func TestQemuBootFlagYieldsToTheBlocklistMarker(t *testing.T) {
	params := qemuFlagReport("1", "AVAILABLE")
	labels := []profileLabel{{
		Code:  "virtual_build_markers",
		State: "hit",
		Evidence: []profileEvidence{{
			Key: "system.tags", Value: "test-keys", Status: "AVAILABLE",
		}},
	}}
	axis, caps, _ := behaviorAxis(labels, params)

	for _, d := range axis.Deductions {
		if d.Code == "QEMU_BOOT_FLAG" {
			t.Errorf("QEMU_BOOT_FLAG fired even though the blocklist marker already hit")
		}
	}
	// The marker rule contributes 35; the flag must not add another 35.
	if axis.Score == nil || *axis.Score != 65 {
		t.Errorf("behaviour score = %v, want 65 (marker only)", axis.Score)
	}
	if len(caps) != 1 {
		t.Errorf("caps = %d, want 1", len(caps))
	}
}

// The suppression handshake: a confirmed virtual device must also suppress the usage-axis
// fresh-boot charge, and the flag is now one of the channels that can confirm it.
func TestQemuBootFlagConfirmsVirtualisationForTheUsageAxis(t *testing.T) {
	params := qemuFlagReport("1", "AVAILABLE")
	params = append(params,
		Parameter{Group: "system", Key: "bootCount", Label: "开机次数", Status: "AVAILABLE", Value: strPtr("2")},
		Parameter{Group: "system", Key: "initialSdk", Label: "初始 SDK", Status: "AVAILABLE", Value: strPtr("28")},
		Parameter{Group: "system", Key: "partitionBuildDates", Label: "分区日期", Status: "AVAILABLE",
			Value: strPtr("system:2020-06-01")},
	)
	if !virtualEvidenceConfirmed(nil, params) {
		t.Fatalf("bootQemu=1 did not confirm virtualisation; the usage axis will charge 12 points it should not")
	}
	axis, _ := usageAxis(params, captureYearMs(2026), virtualEvidenceConfirmed(nil, params))
	if axis.Score == nil || *axis.Score != 100 {
		t.Errorf("usage score = %v, want 100; fresh boot on a confirmed virtual device is not a finding", axis.Score)
	}
}

// And the flag must not confirm anything when it is absent, or every real handset would
// silently lose the fresh-boot check.
func TestQemuBootFlagAbsenceDoesNotConfirmVirtualisation(t *testing.T) {
	params := qemuFlagReport("", "UNAVAILABLE")
	if virtualEvidenceConfirmed(nil, params) {
		t.Errorf("an UNAVAILABLE bootQemu confirmed virtualisation; absence is not evidence")
	}
}

// captureYearMs is a tiny helper so the usage tests can name a capture year without
// hard-coding a magic epoch. 2026-01-01T00:00:00Z.
func captureYearMs(year int) int64 {
	return int64(year-1970)*365*24*60*60*1000 + 1
}

func deductionCodes(axis scoreAxis) []string {
	codes := make([]string, 0, len(axis.Deductions))
	for _, d := range axis.Deductions {
		codes = append(codes, d.Code)
	}
	return codes
}

// The scrub scenario, on the real LDPlayer capture: an adversary who knows about the two
// established channels wipes both of them. cpuInfo goes RESTRICTED and boardPlatform goes
// back to something plausible. The question is whether the device still convicts itself.
//
// This is the test that gives system.bootQemu its point. Without it the new channel is only
// ever observed in the shadow of the structural channel, where it stays silent by design
// (R2) and therefore proves nothing.
func TestQemuBootFlagConvictsWhenTheOlderChannelsAreScrubbed(t *testing.T) {
	values, statuses := ldPlayerCapture()

	// The baseline must first be what we think it is: the structural channel is the one
	// that fires on the untouched capture. If this precondition fails, the test below is
	// measuring nothing.
	baseline := scoreFixtureAt(values, statuses, ldPlayerCapturedAt)
	baselineCodes := behaviorDeductionCodes(baseline)
	if !containsString(baselineCodes, "STRUCTURAL_VIRTUAL_EVIDENCE") {
		t.Fatalf("baseline does not fire the structural channel; got %v", baselineCodes)
	}

	// Scrub both established channels. cpuInfo is read-only on a real device, so an
	// adversary cannot rewrite it — but they can make it unreadable, which is the same
	// outcome from the App's point of view.
	values["cpu.cpuInfo"] = ""
	statuses["cpu.cpuInfo"] = "RESTRICTED"
	values["system.boardPlatform"] = "gs101" // a real handset SoC, no longer generic
	statuses["system.boardPlatform"] = "AVAILABLE"

	scrubbed := scoreFixtureAt(values, statuses, ldPlayerCapturedAt)
	codes := behaviorDeductionCodes(scrubbed)

	if containsString(codes, "STRUCTURAL_VIRTUAL_EVIDENCE") {
		t.Fatalf("structural channel still fired after the scrub; the scenario is wrong: %v", codes)
	}
	if !containsString(codes, "QEMU_BOOT_FLAG") {
		t.Fatalf("bootQemu=1 did not convict after both older channels were scrubbed; got %v", codes)
	}
	if scrubbed.Band != bandD {
		t.Errorf("band = %q, want D; one confirmed channel is decisive", scrubbed.Band)
	}
	if !scrubbed.Decisive {
		t.Errorf("decisive = false; a bootloader self-report is decisive")
	}
	// The same 35 as the channel it replaced: the fact did not change, only the witness.
	if scrubbed.Value == nil {
		t.Fatalf("value is null; band is D and coverage is above the floor")
	}
	if *scrubbed.Value != 71 {
		t.Errorf("value = %d, want 71 (same 35-point deduction, different channel)", *scrubbed.Value)
	}
}

// The other half of the scrub: once the flag is gone too, nothing convicts. This is the
// honest limit of the three channels and must be recorded as a limit, not papered over.
func TestQemuBootFlagScrubbedAlongWithEverythingElseLeavesNoEvidence(t *testing.T) {
	values, statuses := ldPlayerCapture()
	values["cpu.cpuInfo"] = ""
	statuses["cpu.cpuInfo"] = "RESTRICTED"
	values["system.boardPlatform"] = "gs101"
	statuses["system.boardPlatform"] = "AVAILABLE"
	values["system.bootQemu"] = ""
	statuses["system.bootQemu"] = "UNAVAILABLE"

	scrubbed := scoreFixtureAt(values, statuses, ldPlayerCapturedAt)
	codes := behaviorDeductionCodes(scrubbed)
	for _, code := range []string{"STRUCTURAL_VIRTUAL_EVIDENCE", "QEMU_BOOT_FLAG"} {
		if containsString(codes, code) {
			t.Errorf("%s fired after every virtualisation channel was scrubbed; got %v", code, codes)
		}
	}
	// The declaration axis still catches the disguise, which is why the capture does not
	// come out clean. That is a different finding (the device lies about its identity) and
	// it must not be confused with "we proved it is an emulator".
	if scrubbed.Band == bandA {
		t.Errorf("band = A after a full virtualisation scrub; the declaration axis should still be unhappy")
	}
}

func behaviorDeductionCodes(score deviceScore) []string {
	codes := make([]string, 0, 4)
	for _, axis := range score.Axes {
		if axis.Code != axisBehavior {
			continue
		}
		for _, d := range axis.Deductions {
			codes = append(codes, d.Code)
		}
	}
	return codes
}

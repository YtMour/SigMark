package main

import (
	"encoding/json"
	"strconv"
	"testing"
)

func profileField(group, key, value string) Parameter {
	return Parameter{Group: group, Key: key, Value: &value, Source: "fixture", Status: "AVAILABLE"}
}

func profileRestricted(group, key string) Parameter {
	errno := 13
	return Parameter{Group: group, Key: key, Source: "fixture", Status: "RESTRICTED", Reason: "ACCESS_DENIED", Errno: &errno}
}

func profileLabelByCode(t *testing.T, labels []profileLabel, code string) profileLabel {
	t.Helper()
	for _, l := range labels {
		if l.Code == code {
			return l
		}
	}
	t.Fatalf("label %q not found among %d labels", code, len(labels))
	return profileLabel{}
}

func profileEvidenceByKey(t *testing.T, l profileLabel, key string) profileEvidence {
	t.Helper()
	for _, e := range l.Evidence {
		if e.Key == key {
			return e
		}
	}
	t.Fatalf("evidence %q not found on label %q", key, l.Code)
	return profileEvidence{}
}

// The order is part of the wire contract (the web client maps history counters by
// position), so a reorder must fail here rather than silently shift the UI columns.
func TestDeviceProfileLabelOrderAndVersion(t *testing.T) {
	want := []string{
		"virtual_build_markers",
		"selinux_permissive",
		"debugger_attached",
		"hook_injection",
		"root_manager_visible",
		"multi_open",
		"rom_verification",
		"software_drm",
		"identity_conflict",
	}
	if profileVersion != "sigmark-profile/3" {
		t.Fatalf("profileVersion = %q, want sigmark-profile/3", profileVersion)
	}
	if profileLimit != 50 || profileDays != 30 {
		t.Fatalf("history window changed: limit=%d days=%d", profileLimit, profileDays)
	}
	labels := profileSignals(nil)
	if len(labels) != len(want) {
		t.Fatalf("label count = %d, want %d", len(labels), len(want))
	}
	for i, code := range want {
		if labels[i].Code != code {
			t.Errorf("label %d = %q, want %q", i, labels[i].Code, code)
		}
		if labels[i].State != "insufficient" {
			t.Errorf("%s on an empty archive = %s, want insufficient", code, labels[i].State)
		}
		if len(labels[i].Evidence) == 0 {
			t.Errorf("%s has no evidence rows", code)
		}
		for _, e := range labels[i].Evidence {
			if e.Status != "NOT_ARCHIVED" {
				t.Errorf("%s/%s on an empty archive = %s, want NOT_ARCHIVED", code, e.Key, e.Status)
			}
		}
	}
	raw, err := json.Marshal(labels)
	if err != nil {
		t.Fatal(err)
	}
	var decoded []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	for i, row := range decoded {
		for _, key := range []string{"code", "state", "evidence", "historyHits", "historyEvaluable", "historyRestricted"} {
			if _, ok := row[key]; !ok {
				t.Errorf("label %d (%s) is missing JSON field %q", i, want[i], key)
			}
		}
		if _, ok := row["lastHistoricalHit"]; ok && labels[i].LastHit == nil {
			t.Errorf("label %d (%s) emitted an empty lastHistoricalHit", i, want[i])
		}
	}
}

func TestDeviceProfileLegacyLabels(t *testing.T) {
	const hit, no, unknown = "hit", "not_observed", "insufficient"
	codes := []string{"virtual_build_markers", "selinux_permissive", "debugger_attached"}
	hw := profileField("cpu", "hardware", "qcom")
	device := profileField("system", "device", "dipper")
	product := profileField("system", "product", "dipper")
	denied := profileField("system", "selinux", "Permissive（宽容模式）") // ignore even a stray value on a rejected read
	errno := 13
	denied.Status, denied.Errno, denied.Reason = "RESTRICTED", &errno, "ACCESS_DENIED"
	cases := []struct {
		name  string
		input []Parameter
		want  [3]string
	}{
		{"empty archive", nil, [3]string{unknown, unknown, unknown}},
		{"partial declarations", []Parameter{hw, device}, [3]string{unknown, unknown, unknown}},
		{"field names are scoped", []Parameter{hw, device, profileField("other", "product", "ranchu")}, [3]string{unknown, unknown, unknown}},
		{"unknown value is missing evidence", []Parameter{hw, device, profileField("system", "product", " UnKnOwN ")}, [3]string{unknown, unknown, unknown}},
		{"explicit declaration suffices", []Parameter{profileField("cpu", "hardware", " RANCHU ")}, [3]string{hit, unknown, unknown}},
		{"configuration may declare an emulator product", []Parameter{hw, device, profileField("system", "product", "sdk_gphone64_x86_64")}, [3]string{hit, unknown, unknown}},
		{"three nonmatching declarations", []Parameter{hw, device, product}, [3]string{no, unknown, unknown}},
		{"custom build and empty SIM do not classify a physical target", []Parameter{hw, device, product,
			profileField("system", "type", "userdebug"), profileField("environment", "flashLock", "0"),
			profileField("cellular", "simState", "无卡"), profileField("sensors", "count", "0")}, [3]string{no, unknown, unknown}},
		{"irrelevant build characteristics", []Parameter{profileField("app", "appDebuggable", "是"), profileField("cpu", "abis", "x86_64"), denied}, [3]string{unknown, unknown, unknown}},
		{"unexpected mode vocabulary", []Parameter{profileField("system", "selinux", "not recorded"), profileField("app", "debuggerConnected", "?")}, [3]string{unknown, unknown, unknown}},
		{"explicit positive", []Parameter{profileField("system", "selinux", "Permissive（宽容模式）"), profileField("app", "debuggerConnected", "是")}, [3]string{unknown, hit, hit}},
		{"explicit negative", []Parameter{profileField("system", "selinux", "Enforcing（强制模式）"), profileField("app", "debuggerConnected", "否"), profileField("environment", "tracerPid", "0")}, [3]string{unknown, no, no}},
		{"inferred permissive is still permissive", []Parameter{profileField("system", "selinux", "Permissive（宽容模式，推断）")}, [3]string{unknown, hit, unknown}},
		{"inferred enforcing is still enforcing", []Parameter{profileField("system", "selinux", "Enforcing（强制模式，推断）")}, [3]string{unknown, no, unknown}},
		{"disabled inference is not a mode", []Parameter{profileField("system", "selinux", "未启用（推断）")}, [3]string{unknown, unknown, unknown}},
		{"tracer pid alone completes the debugger label", []Parameter{profileField("environment", "tracerPid", "4242")}, [3]string{unknown, unknown, hit}},
		{"zero tracer pid is a negative only with the direct flag", []Parameter{profileField("app", "debuggerConnected", "否"), profileField("environment", "tracerPid", "0")}, [3]string{unknown, unknown, no}},
		{"missing tracer pid leaves the debugger label insufficient", []Parameter{profileField("app", "debuggerConnected", "否")}, [3]string{unknown, unknown, unknown}},
		{"unparsable tracer pid is not a tracer", []Parameter{profileField("app", "debuggerConnected", "否"), profileField("environment", "tracerPid", "abc")}, [3]string{unknown, unknown, unknown}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := profileSignals(c.input)
			for i, w := range c.want {
				if state := profileLabelByCode(t, got, codes[i]).State; state != w {
					t.Errorf("%s = %s, want %s", codes[i], state, w)
				}
			}
		})
	}
	labels := profileSignals([]Parameter{denied})
	e := labels[1].Evidence[0]
	if e.Status != "RESTRICTED" || e.Errno == nil || *e.Errno != 13 || e.Value != "" || e.Source != "fixture" || e.Reason != "ACCESS_DENIED" {
		t.Errorf("rejected observation lost provenance or retained a value: %+v", e)
	}
	if e := labels[2].Evidence[0]; e.Key != "app.debuggerConnected" || e.Status != "NOT_ARCHIVED" {
		t.Errorf("missing archived field: %+v", e)
	}
	if e := labels[2].Evidence[1]; e.Key != "environment.tracerPid" || e.Status != "NOT_ARCHIVED" {
		t.Errorf("missing archived tracer evidence: %+v", e)
	}
}

func TestDeviceProfileNewLabels(t *testing.T) {
	const hit, no, unknown = "hit", "not_observed", "insufficient"
	cases := []struct {
		name   string
		code   string
		params []Parameter
		want   string
	}{
		{"hook signal observed", "hook_injection", []Parameter{
			profileField("environment", "hookSignals", "frida / gadget"),
			profileField("environment", "rootMountHints", "none")}, hit},
		{"mount hint observed with clean signals", "hook_injection", []Parameter{
			profileField("environment", "hookSignals", "none"),
			profileField("environment", "rootMountHints", "overlay_system / magisk_path")}, hit},
		{"both hook readings clean", "hook_injection", []Parameter{
			profileField("environment", "hookSignals", "none"),
			profileField("environment", "rootMountHints", "none")}, no},
		{"one hook reading missing", "hook_injection", []Parameter{
			profileField("environment", "hookSignals", "none")}, unknown},
		{"restricted hook reading is not a negative", "hook_injection", []Parameter{
			profileField("environment", "hookSignals", "none"),
			profileRestricted("environment", "rootMountHints")}, unknown},
		{"no hook readings", "hook_injection", nil, unknown},

		{"root manager visible", "root_manager_visible", []Parameter{profileField("environment", "rootManagerVisible", "magisk / kernelsu")}, hit},
		{"no root manager visible", "root_manager_visible", []Parameter{profileField("environment", "rootManagerVisible", "none")}, no},
		{"root manager not archived", "root_manager_visible", nil, unknown},

		{"secondary user", "multi_open", []Parameter{profileField("environment", "userProfile", "secondary")}, hit},
		{"managed profile", "multi_open", []Parameter{profileField("environment", "userProfile", "managed")}, hit},
		{"owner user", "multi_open", []Parameter{profileField("environment", "userProfile", "owner")}, no},
		{"unexpected user profile", "multi_open", []Parameter{profileField("environment", "userProfile", "guest")}, unknown},
		{"user profile not archived", "multi_open", nil, unknown},

		{"verity disabled", "rom_verification", []Parameter{profileField("environment", "verityMode", "disabled")}, hit},
		{"verity logging", "rom_verification", []Parameter{profileField("environment", "verityMode", "logging")}, hit},
		{"debuggable build declared", "rom_verification", []Parameter{profileField("environment", "buildDebuggable", "开启")}, hit},
		{"enforcing verity plus non-debuggable build", "rom_verification", []Parameter{
			profileField("environment", "verityMode", "enforcing"),
			profileField("environment", "buildDebuggable", "关闭")}, no},
		{"enforcing verity alone is not a full negative", "rom_verification", []Parameter{
			profileField("environment", "verityMode", "enforcing")}, unknown},
		{"non-debuggable build alone is not a full negative", "rom_verification", []Parameter{
			profileField("environment", "buildDebuggable", "关闭")}, unknown},
		{"restricted build declaration is not a negative", "rom_verification", []Parameter{
			profileField("environment", "verityMode", "enforcing"),
			profileRestricted("environment", "buildDebuggable")}, unknown},
		{"rom rows not archived", "rom_verification", nil, unknown},
		{"unexpected verity marker", "rom_verification", []Parameter{profileField("environment", "verityMode", "hash")}, unknown},

		{"software drm", "software_drm", []Parameter{profileField("environment", "drmSecurityLevel", "L3")}, hit},
		{"hardware-backed drm", "software_drm", []Parameter{profileField("environment", "drmSecurityLevel", "L1")}, no},
		{"unknown drm level is retained but not a hit", "software_drm", []Parameter{profileField("environment", "drmSecurityLevel", "L4")}, unknown},
		{"drm level not archived", "software_drm", nil, unknown},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := profileLabelByCode(t, profileSignals(c.params), c.code)
			if got.State != c.want {
				t.Errorf("%s = %s, want %s (evidence %+v)", c.code, got.State, c.want, got.Evidence)
			}
		})
	}
	l2 := profileLabelByCode(t, profileSignals([]Parameter{profileField("environment", "drmSecurityLevel", "L2")}), "software_drm")
	if l2.State != no {
		t.Errorf("L2 drm = %s, want %s", l2.State, no)
	}
	if e := profileEvidenceByKey(t, l2, "environment.drmSecurityLevel"); e.Status != "AVAILABLE" || e.Value != "L2" {
		t.Errorf("L2 evidence was not preserved: %+v", e)
	}
}

func TestDeviceProfileEvidenceKeepsRestrictedReads(t *testing.T) {
	denied := profileRestricted("system", "selinux")
	value := "Permissive（宽容模式）"
	denied.Value = &value // a stray value on a rejected read must not become a hit
	labels := profileSignals([]Parameter{denied})
	sel := profileLabelByCode(t, labels, "selinux_permissive")
	if sel.State != "insufficient" {
		t.Fatalf("restricted selinux = %s, want insufficient", sel.State)
	}
	e := profileEvidenceByKey(t, sel, "system.selinux")
	if e.Status != "RESTRICTED" || e.Errno == nil || *e.Errno != 13 || e.Value != "" || e.Source != "fixture" || e.Reason != "ACCESS_DENIED" {
		t.Errorf("rejected observation lost provenance or retained a value: %+v", e)
	}
	for _, code := range []string{"debugger_attached", "hook_injection", "root_manager_visible", "multi_open", "rom_verification", "software_drm"} {
		l := profileLabelByCode(t, labels, code)
		if l.State != "insufficient" {
			t.Errorf("%s without evidence = %s, want insufficient", code, l.State)
		}
		for _, ev := range l.Evidence {
			if ev.Status != "NOT_ARCHIVED" {
				t.Errorf("%s/%s = %s, want NOT_ARCHIVED", code, ev.Key, ev.Status)
			}
		}
	}
}

func TestDeviceProfileHistoryRestricted(t *testing.T) {
	p := &deviceProfile{Labels: profileSignals([]Parameter{profileField("system", "selinux", "Enforcing（强制模式）")})}
	if p.Samples != 0 {
		t.Fatalf("history starts at %d samples", p.Samples)
	}
	// A restricted read is not a hit and cannot complete the negative evidence.
	p.addHistory("restricted-selinux", Report{CapturedAt: 1000, Parameters: []Parameter{profileRestricted("system", "selinux")}})
	sel := profileLabelByCode(t, p.Labels, "selinux_permissive")
	if sel.HistoryHits != 0 || sel.HistoryEvaluable != 0 || sel.HistoryRestricted != 1 {
		t.Errorf("restricted selinux history = %+v, want hits=0 evaluable=0 restricted=1", sel)
	}
	// A sample can be a hit through one field while another field is restricted;
	// both counters describe different facts about the sample.
	p.addHistory("mixed-hook", Report{CapturedAt: 2000, Parameters: []Parameter{
		profileField("environment", "hookSignals", "frida"),
		profileRestricted("environment", "rootMountHints"),
	}})
	// Two restricted fields in one sample count once, not twice.
	p.addHistory("double-hook", Report{CapturedAt: 2500, Parameters: []Parameter{
		profileRestricted("environment", "hookSignals"),
		profileRestricted("environment", "rootMountHints"),
	}})
	// A clean negative sample neither hits nor adds to the restricted counter.
	p.addHistory("clean-hook", Report{CapturedAt: 3000, Parameters: []Parameter{
		profileField("environment", "hookSignals", "none"),
		profileField("environment", "rootMountHints", "none"),
	}})
	hook := profileLabelByCode(t, p.Labels, "hook_injection")
	if hook.HistoryHits != 1 || hook.HistoryEvaluable != 2 || hook.HistoryRestricted != 2 {
		t.Errorf("hook history = %+v, want hits=1 evaluable=2 restricted=2", hook)
	}
	if hook.LastHit == nil || hook.LastHit.ID != "mixed-hook" || hook.LastHit.CapturedAt != 2000 {
		t.Errorf("hook last hit = %+v, want mixed-hook@2000", hook.LastHit)
	}
	// A restricted tracer must not be read as the "否" negative of a debugger label.
	p.addHistory("debug-restricted", Report{CapturedAt: 4000, Parameters: []Parameter{
		profileField("app", "debuggerConnected", "否"),
		profileRestricted("environment", "tracerPid"),
	}})
	dbg := profileLabelByCode(t, p.Labels, "debugger_attached")
	if dbg.HistoryHits != 0 || dbg.HistoryEvaluable != 0 || dbg.HistoryRestricted != 1 {
		t.Errorf("debugger history = %+v, want hits=0 evaluable=0 restricted=1", dbg)
	}
	if p.Samples != 5 {
		t.Errorf("history samples = %d, want 5", p.Samples)
	}
	if p.Limited {
		t.Error("five samples must not mark the history limited")
	}
}

func TestDeviceProfileOlderReportKeepsOtherLabels(t *testing.T) {
	// Field set 12 rows only: the new hook/tracer/profile/drm/verity rows are absent.
	params := []Parameter{
		profileField("cpu", "hardware", "qcom"),
		profileField("system", "product", "dipper"),
		profileField("system", "device", "dipper"),
		profileField("system", "selinux", "Enforcing（强制模式）"),
		profileField("app", "debuggerConnected", "否"),
	}
	want := map[string]string{
		"virtual_build_markers": "not_observed",
		"selinux_permissive":    "not_observed",
		// The direct flag says 否 but tracerPid is not archived: not a full negative.
		"debugger_attached":    "insufficient",
		"hook_injection":       "insufficient",
		"root_manager_visible": "insufficient",
		"multi_open":           "insufficient",
		"rom_verification":     "insufficient",
		"software_drm":         "insufficient",
		// Field set 18 and older carry none of the identity pairs, so the new label
		// must still be the ninth row with missing evidence, never a dropped slot.
		"identity_conflict": "insufficient",
	}
	labels := profileSignals(params)
	if len(labels) != 9 {
		t.Fatalf("label count on an old report = %d, want 9", len(labels))
	}
	if labels[8].Code != "identity_conflict" {
		t.Fatalf("labels[8] = %q, want identity_conflict", labels[8].Code)
	}
	for code, state := range want {
		if got := profileLabelByCode(t, labels, code).State; got != state {
			t.Errorf("%s = %s, want %s", code, got, state)
		}
	}
	if e := profileEvidenceByKey(t, profileLabelByCode(t, labels, "software_drm"), "environment.drmSecurityLevel"); e.Status != "NOT_ARCHIVED" {
		t.Errorf("unarchived DRM field = %s, want NOT_ARCHIVED", e.Status)
	}
}

func TestDeviceProfileHistoryLimit(t *testing.T) {
	p := &deviceProfile{
		Version: profileVersion,
		Days:    profileDays,
		Limit:   profileLimit,
		Labels:  profileSignals([]Parameter{profileField("app", "debuggerConnected", "否")}),
	}
	params := []Parameter{profileField("app", "debuggerConnected", "是")}
	for i := 1; i <= profileLimit; i++ {
		p.recordHistory("r"+strconv.Itoa(i), Report{CapturedAt: int64(i) * 1000, Parameters: params})
	}
	if p.Samples != profileLimit || p.Limited {
		t.Fatalf("after %d samples: samples=%d limited=%v", profileLimit, p.Samples, p.Limited)
	}
	dbg := profileLabelByCode(t, p.Labels, "debugger_attached")
	if dbg.HistoryHits != profileLimit || dbg.HistoryEvaluable != profileLimit {
		t.Fatalf("history = %+v, want hits=evaluable=%d", dbg, profileLimit)
	}
	if dbg.LastHit == nil || dbg.LastHit.ID != "r50" || dbg.LastHit.CapturedAt != 50000 {
		t.Errorf("last hit = %+v, want r50@50000", dbg.LastHit)
	}
	// The 51st row only flips historyLimited; counters keep the capped sample set.
	p.recordHistory("r51", Report{CapturedAt: 51000, Parameters: params})
	if !p.Limited || p.Samples != profileLimit {
		t.Errorf("after 51 rows: samples=%d limited=%v, want %d,true", p.Samples, p.Limited, profileLimit)
	}
	dbg = profileLabelByCode(t, p.Labels, "debugger_attached")
	if dbg.HistoryHits != profileLimit || dbg.HistoryEvaluable != profileLimit {
		t.Errorf("51st row changed counters: %+v", dbg)
	}
}

// The ninth label compares two independent declarations of the same identity, so
// it cannot be expressed by per-field classify: a pair only counts when both sides
// are usable, and one conflict beats agreement in the other pairs.
func TestDeviceProfileIdentityConflict(t *testing.T) {
	const hit, no, unknown = "hit", "not_observed", "insufficient"
	cases := []struct {
		name   string
		params []Parameter
		want   string
	}{
		{"board pair disagrees", []Parameter{
			profileField("system", "board", "corot"),
			profileField("system", "boardPlatform", "slider")}, hit},
		{"hardware pair disagrees", []Parameter{
			profileField("cpu", "hardware", "qcom"),
			profileField("system", "bootHardware", "mtk")}, hit},
		{"sku pair disagrees", []Parameter{
			profileField("system", "sku", "GR1YH"),
			profileField("system", "hardwareSku", "23078PND5G")}, hit},
		{"all three pairs agree", []Parameter{
			profileField("system", "board", "corot"),
			profileField("system", "boardPlatform", "corot"),
			profileField("cpu", "hardware", "qcom"),
			profileField("system", "bootHardware", "qcom"),
			profileField("system", "sku", "GR1YH"),
			profileField("system", "hardwareSku", "GR1YH")}, no},
		{"case differences are agreement", []Parameter{
			profileField("system", "board", "COROT"),
			profileField("system", "boardPlatform", "corot")}, no},
		{"only one comparable pair agrees", []Parameter{
			profileField("system", "board", "corot"),
			profileField("system", "boardPlatform", "corot"),
			profileField("cpu", "hardware", "qcom")}, no},
		{"one conflict beats an agreeing pair", []Parameter{
			profileField("system", "board", "corot"),
			profileField("system", "boardPlatform", "corot"),
			profileField("system", "sku", "GR1YH"),
			profileField("system", "hardwareSku", "23078PND5G")}, hit},
		{"trimmed values still compare", []Parameter{
			profileField("system", "board", " COROT "),
			profileField("system", "boardPlatform", "corot-1.0.9")}, hit},
		{"a single side is not comparable", []Parameter{
			profileField("system", "board", "corot")}, unknown},
		{"unknown placeholder is missing evidence", []Parameter{
			profileField("system", "board", " UnKnOwN "),
			profileField("system", "boardPlatform", "corot")}, unknown},
		{"restricted side is not comparable", []Parameter{
			profileField("system", "board", "corot"),
			profileRestricted("system", "boardPlatform")}, unknown},
		{"restricted side hides no conflict", []Parameter{
			profileField("system", "sku", "GR1YH"),
			profileField("system", "hardwareSku", "23078PND5G"),
			profileRestricted("system", "board")}, hit},
		{"no identity rows", nil, unknown},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := profileLabelByCode(t, profileSignals(c.params), "identity_conflict")
			if got.State != c.want {
				t.Errorf("identity_conflict = %s, want %s (evidence %+v)", got.State, c.want, got.Evidence)
			}
		})
	}
	// Fixed evidence shape: six rows in pair order, whatever was archived, so the
	// history counter and the detail table never shift with the sample.
	empty := profileSignals(nil)
	if len(empty) != 9 {
		t.Fatalf("label count = %d, want 9", len(empty))
	}
	if empty[8].Code != "identity_conflict" {
		t.Fatalf("labels[8] = %q, want identity_conflict", empty[8].Code)
	}
	keys := []string{"system.board", "system.boardPlatform", "cpu.hardware", "system.bootHardware", "system.sku", "system.hardwareSku"}
	if len(empty[8].Evidence) != len(keys) {
		t.Fatalf("evidence rows = %d, want %d", len(empty[8].Evidence), len(keys))
	}
	for i, k := range keys {
		if e := empty[8].Evidence[i]; e.Key != k || e.Status != "NOT_ARCHIVED" {
			t.Errorf("evidence %d = %+v, want %s NOT_ARCHIVED", i, e, k)
		}
	}
	restricted := profileSignals([]Parameter{profileRestricted("system", "hardwareSku")})
	e := profileEvidenceByKey(t, profileLabelByCode(t, restricted, "identity_conflict"), "system.hardwareSku")
	if e.Status != "RESTRICTED" || e.Errno == nil || *e.Errno != 13 || e.Source != "fixture" || e.Reason != "ACCESS_DENIED" {
		t.Errorf("restricted identity evidence lost provenance: %+v", e)
	}
}

func TestDeviceProfileIdentityConflictHistory(t *testing.T) {
	p := &deviceProfile{Labels: profileSignals(nil)}
	if len(p.Labels) != 9 {
		t.Fatalf("labels = %d, want 9", len(p.Labels))
	}
	// A conflicting sample is a hit.
	p.addHistory("conflict", Report{CapturedAt: 1000, Parameters: []Parameter{
		profileField("system", "board", "corot"),
		profileField("system", "boardPlatform", "slider"),
	}})
	// An agreeing pair is evaluable and not a hit.
	p.addHistory("agree", Report{CapturedAt: 2000, Parameters: []Parameter{
		profileField("system", "board", "corot"),
		profileField("system", "boardPlatform", "corot"),
	}})
	// A restricted basis field is counted, never a hit and never a negative.
	p.addHistory("restricted", Report{CapturedAt: 3000, Parameters: []Parameter{
		profileRestricted("system", "hardwareSku"),
	}})
	// A pre-19 sample carries no identity rows: insufficient, not restricted.
	p.addHistory("legacy", Report{CapturedAt: 4000, Parameters: []Parameter{
		profileField("app", "debuggerConnected", "否"),
	}})
	// One sample can be a hit and hold a restricted basis field at the same time.
	p.addHistory("conflict-restricted", Report{CapturedAt: 5000, Parameters: []Parameter{
		profileField("system", "sku", "GR1YH"),
		profileField("system", "hardwareSku", "23078PND5G"),
		profileRestricted("system", "board"),
	}})
	p.addHistory("agree-second", Report{CapturedAt: 6000, Parameters: []Parameter{
		profileField("cpu", "hardware", "QCOM"),
		profileField("system", "bootHardware", "qcom"),
	}})
	l := profileLabelByCode(t, p.Labels, "identity_conflict")
	if l.HistoryHits != 2 || l.HistoryEvaluable != 4 || l.HistoryRestricted != 2 {
		t.Errorf("identity history = %+v, want hits=2 evaluable=4 restricted=2", l)
	}
	if l.LastHit == nil || l.LastHit.ID != "conflict-restricted" || l.LastHit.CapturedAt != 5000 {
		t.Errorf("identity last hit = %+v, want conflict-restricted@5000", l.LastHit)
	}
	if p.Samples != 6 {
		t.Errorf("history samples = %d, want 6", p.Samples)
	}
	// addHistory indexes by position, so the ninth row must stay the ninth row.
	if p.Labels[8].Code != "identity_conflict" {
		t.Errorf("labels[8] = %q, want identity_conflict", p.Labels[8].Code)
	}
}

func identityParams(model, device, board, platform, hardware, sku string) []Parameter {
	out := []Parameter{profileField("system", "model", model), profileField("system", "device", device),
		profileField("system", "board", board)}
	if platform != "" {
		out = append(out, profileField("system", "boardPlatform", platform))
	}
	if hardware != "" {
		out = append(out, profileField("system", "bootHardware", hardware))
	}
	if sku != "" {
		out = append(out, profileField("system", "hardwareSku", sku))
	}
	return out
}

func TestDeviceProfileIdentityHistoryKeepsDistinctDeclarations(t *testing.T) {
	p := deviceProfile{Version: profileVersion}
	p.recordIdentity("r1", Report{CapturedAt: 1000, Parameters: identityParams("23078PND5G", "corot", "mt6985", "mt6985", "mtk", "23078PND5G")})
	p.recordIdentity("r2", Report{CapturedAt: 2000, Parameters: identityParams("23078PND5G", "corot", "mt6985", "mt6985", "mtk", "23078PND5G")})
	p.recordIdentity("r3", Report{CapturedAt: 3000, Parameters: identityParams("Pixel 6", "oriole", "gs101", "gs101", "oriole", "GR1YH")})
	p.sortIdentity()
	if len(p.Identity) != 2 || p.IdentityLimited {
		t.Fatalf("identity combos = %+v limited=%v", p.Identity, p.IdentityLimited)
	}
	if p.Identity[0].Model != "Pixel 6" || p.Identity[0].Samples != 1 || p.Identity[0].LastReportID != "r3" {
		t.Fatalf("newest combo first expected, got %+v", p.Identity[0])
	}
	if p.Identity[1].Model != "23078PND5G" || p.Identity[1].Samples != 2 ||
		p.Identity[1].LastCapturedAt != 2000 || p.Identity[1].LastReportID != "r2" {
		t.Fatalf("repeated combo not aggregated: %+v", p.Identity[1])
	}
	p.recordIdentity("r4", Report{CapturedAt: 4000, Parameters: identityParams("23078PND5G", "corot", "mt6985", "mt6985", "mtk", "23078PND5G")})
	p.sortIdentity()
	if p.Identity[0].Samples != 3 || p.Identity[0].LastReportID != "r4" {
		t.Fatalf("aggregation after sort lost: %+v", p.Identity[0])
	}
}

func TestDeviceProfileIdentityHistorySeparatesMissingFromChanged(t *testing.T) {
	p := deviceProfile{Version: profileVersion}
	p.recordIdentity("r1", Report{CapturedAt: 1000})
	p.recordIdentity("r2", Report{CapturedAt: 2000, Parameters: []Parameter{profileField("system", "model", "MI 8")}})
	p.recordIdentity("r3", Report{CapturedAt: 3000, Parameters: []Parameter{profileRestricted("system", "board")}})
	p.sortIdentity()
	// An empty archive and a restricted-only archive carry the same empty tuple, so
	// they share one combination; a model-only archive is a second one. Restricted
	// and unknown values never fill a field.
	if len(p.Identity) != 2 {
		t.Fatalf("identity combos = %+v", p.Identity)
	}
	for _, combo := range p.Identity {
		if combo.Board != "" || combo.BoardPlatform != "" || combo.BootHardware != "" || combo.HardwareSku != "" {
			t.Fatalf("restricted or missing field leaked into identity: %+v", combo)
		}
	}
	p.recordIdentity("r4", Report{CapturedAt: 4000, Parameters: []Parameter{profileField("system", "model", "unknown")}})
	p.sortIdentity()
	if len(p.Identity) != 2 {
		t.Fatalf("unknown placeholder should equal an absent model, combos=%+v", p.Identity)
	}
	if p.Identity[0].Model != "" || p.Identity[0].Samples != 3 || p.Identity[0].LastReportID != "r4" {
		t.Fatalf("empty tuple aggregation wrong: %+v", p.Identity[0])
	}
}

func TestDeviceProfileIdentityHistoryIsCapped(t *testing.T) {
	p := deviceProfile{Version: profileVersion}
	for i := 0; i < identityComboLimit+2; i++ {
		p.recordIdentity("r"+strconv.Itoa(i), Report{CapturedAt: int64(i + 1),
			Parameters: []Parameter{profileField("system", "model", "model-"+strconv.Itoa(i))}})
	}
	p.sortIdentity()
	if len(p.Identity) != identityComboLimit || !p.IdentityLimited {
		t.Fatalf("cap behaviour: combos=%d limited=%v", len(p.Identity), p.IdentityLimited)
	}
}

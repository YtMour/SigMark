package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDiagnosticCoverageContract(t *testing.T) {
	report := synthetic()
	report.SchemaVersion = 3
	report.Parameters = []Parameter{
		{Group: "battery", Key: "energyCounter", Label: "Remaining energy", Source: "BatteryManager", Status: "UNAVAILABLE", Reason: "NOT_REPORTED"},
		{Group: "environment", Key: "selinuxDomain", Label: "Process domain", Source: "/proc/self/attr/current", Status: "RESTRICTED", Reason: "ACCESS_DENIED"},
	}
	report.Coverage = []Coverage{
		{Group: "battery", Unavailable: 1},
		{Group: "environment", Available: 2, Restricted: 1},
	}
	if !report.valid() {
		t.Fatal("valid v3 report rejected")
	}
	report.Coverage[1].Restricted = 0
	if report.valid() {
		t.Fatal("coverage undercounts archived status")
	}
	report.Coverage[1].Restricted = 1
	report.Coverage = append(report.Coverage, report.Coverage[1])
	if report.valid() {
		t.Fatal("duplicate coverage group accepted")
	}
	report.Coverage = report.Coverage[:2]
	report.Parameters[1].Key = "configurationDigest"
	if report.valid() {
		t.Fatal("local-only configuration digest accepted")
	}
	report.Parameters[1].Key = "selinuxDomain"
	report.SchemaVersion = 2
	report.Coverage = nil
	if report.valid() {
		t.Fatal("legacy v2 accepted a v3-only field")
	}
}

func TestVersionedDiagnosticsAndMissingReasons(t *testing.T) {
	p := synthetic()
	p.SchemaVersion = 4
	p.CollectorVersion = "0.11.0"
	p.FieldSetVersion = 2
	p.Parameters = []Parameter{{Group: "battery", Key: "energyCounter", Label: "Energy", Source: "BatteryManager", Status: "UNAVAILABLE", Reason: "INTERFACE_UNSUPPORTED"}}
	p.Coverage = []Coverage{{Group: "battery", Unavailable: 1}}
	for _, reason := range []string{"INTERFACE_UNSUPPORTED", "OPTIONAL_UNSET", "MODEM_NOT_REPORTED", "NO_REGISTERED_LTE"} {
		p.Parameters[0].Reason = reason
		if !p.valid() {
			t.Fatalf("%s rejected", reason)
		}
	}
	p.Parameters[0].Reason = "NOT_COLLECTED"
	if p.valid() {
		t.Fatal("comparison-only absence accepted as a device reading")
	}
	p.Parameters[0].Reason = "INTERFACE_UNSUPPORTED"
	p.FieldSetVersion = 0
	if p.valid() {
		t.Fatal("v4 accepted without field set")
	}
	p.FieldSetVersion = 2
	p.CollectorVersion = ""
	if p.valid() {
		t.Fatal("v4 accepted without collector version")
	}
	p.CollectorVersion = "0.12.0"
	value := "10000 kHz / 20000 kHz"
	p.Parameters = append(p.Parameters, Parameter{Group: "cellular", Key: "carrierBandwidths", Label: "Carrier bandwidths",
		Source: "TelephonyManager.serviceState.cellBandwidths", Value: &value, Status: "AVAILABLE"})
	p.Coverage = append(p.Coverage, Coverage{Group: "cellular", Available: 1})
	if p.valid() {
		t.Fatal("field set 2 accepted a field set 3 parameter")
	}
	p.FieldSetVersion = 3
	if !p.valid() {
		t.Fatal("field set 3 rejected the carrier bandwidths")
	}
	sim := "卡槽 1：就绪"
	p.Parameters = append(p.Parameters, Parameter{Group: "cellular", Key: "simState", Label: "SIM", Value: &sim,
		Source: "TelephonyManager.getSimState(slotIndex)", Status: "AVAILABLE"})
	p.Coverage[len(p.Coverage)-1].Available++
	if p.valid() {
		t.Fatal("field set 3 accepted field set 4 data")
	}
	p.FieldSetVersion = 4
	if !p.valid() {
		t.Fatal("field set 4 rejected independent SIM state")
	}
	slot, service := "卡槽 1", "卡槽 1：有服务"
	p.Parameters = append(p.Parameters,
		Parameter{Group: "cellular", Key: "defaultDataSlot", Label: "数据卡槽", Value: &slot, Source: "SubscriptionManager", Status: "AVAILABLE"},
		Parameter{Group: "cellular", Key: "slotService", Label: "卡槽服务", Value: &service, Source: "TelephonyManager", Status: "AVAILABLE"})
	p.Coverage[len(p.Coverage)-1].Available += 2
	if p.valid() {
		t.Fatal("field set 4 accepted field set 5 data")
	}
	p.FieldSetVersion = 5
	if !p.valid() {
		t.Fatal("field set 5 rejected slot diagnostics")
	}
	locked, encrypted := "是", "已启用（按用户加密）"
	p.Parameters = append(p.Parameters,
		Parameter{Group: "environment", Key: "keyguardSecure", Label: "锁屏凭证", Source: "KeyguardManager", Status: "AVAILABLE", Value: &locked},
		Parameter{Group: "environment", Key: "storageEncryption", Label: "存储加密", Source: "DevicePolicyManager", Status: "AVAILABLE", Value: &encrypted})
	p.Coverage = append(p.Coverage, Coverage{Group: "environment", Available: 2})
	if p.valid() {
		t.Fatal("field set 5 accepted field set 6 data")
	}
	p.FieldSetVersion = 6
	if !p.valid() {
		t.Fatal("field set 6 rejected protection readings")
	}
	p.Parameters[len(p.Parameters)-1].Key = "subscriptionId"
	if p.valid() {
		t.Fatal("private subscription identifier accepted")
	}
}

func synthetic() Report {
	return Report{SchemaVersion: 1, RequestID: "00000000-0000-4000-8000-000000000001", CapturedAt: 1800000000000,
		Model: "Synthetic QA", AndroidAPI: 34, AppVersion: "0.3.0", Network: "wifi", WifiBand: "5", Radio: "lte",
		Metrics: []Metric{{Key: "system.selinux", Status: "RESTRICTED", Reason: "ACCESS_DENIED"}}}
}

func TestV8CapabilityFields(t *testing.T) {
	r := synthetic()
	r.SchemaVersion, r.FieldSetVersion, r.CollectorVersion = 4, 8, "0.20.0"
	for _, field := range [][3]string{
		{"runtime", "vulkanVersion", "1.1.0"},
		{"media", "cameraCapabilitySummary", "rear/FULL x1"},
		{"sensors", "typeWakeupSummary", "1:2/1"},
	} {
		value := field[2]
		r.Parameters = append(r.Parameters, Parameter{Group: field[0], Key: field[1], Value: &value,
			Label: field[1], Source: "fixture", Status: "AVAILABLE"})
		r.Coverage = append(r.Coverage, Coverage{Group: field[0], Available: 1})
	}
	if !r.valid() {
		t.Fatal("v8 capability summaries rejected")
	}
	r.FieldSetVersion = 7
	if r.valid() {
		t.Fatal("v7 accepted v8 fields")
	}
	r.FieldSetVersion = 8
	r.Parameters[0].Group = "cpu"
	if r.valid() {
		t.Fatal("a capability key was accepted under a different group")
	}
}

func TestV9AcceptanceValues(t *testing.T) {
	for _, tc := range [][4]string{
		{"environment", "capturePlan", "rom", "anything"},
		{"environment", "captureLocationAccess", "approximate", "coordinates"},
		{"media", "avcFixture", "sigmark-avc/1", "custom"},
		{"media", "avcFirstFrame", "fail", "unknown"},
		{"media", "avcStage", "decode", "unexpected"},
		{"media", "avcDecoder", "c2.exynos.h264.decoder", "not a decoder name"},
		{"media", "avcElapsed", "132 ms", "-10 ms"},
	} {
		p := Parameter{Group: tc[0], Key: tc[1], Value: &tc[2], Label: tc[1], Source: "fixture", Status: "AVAILABLE"}
		if !p.valid(4, 9) || p.valid(4, 8) {
			t.Fatalf("field set gate failed for %s", tc[1])
		}
		p.Value = &tc[3]
		if p.valid(4, 9) {
			t.Fatalf("bad value accepted for %s", tc[1])
		}
	}
}

func TestParametersAndPaginationContract(t *testing.T) {
	p := synthetic()
	p.SchemaVersion = 2
	p.Parameters = []Parameter{{Group: "system", Key: "selinux", Label: "SELinux", Source: "/sys/fs/selinux/enforce", Status: "RESTRICTED", Reason: "ACCESS_DENIED"}}
	errno := 13
	p.Parameters[0].Errno = &errno
	if !p.valid() {
		t.Fatal("detailed report rejected")
	}
	p.Parameters[0].Key = "fingerprint"
	if p.valid() {
		t.Fatal("excluded key accepted")
	}
	p.Parameters[0].Key = "selinux"
	p.Parameters[0].Value = new(string)
	if p.valid() {
		t.Fatal("unavailable value must be null")
	}
	p.Parameters[0].Value = nil
	p.SchemaVersion = 1
	if p.valid() {
		t.Fatal("unexpected v1 parameters accepted")
	}
	at := time.Unix(1800000000, 123456000)
	got, id, err := parseCursor(makeCursor(at, p.RequestID))
	if err != nil || !got.Equal(at) || *id != p.RequestID {
		t.Fatal("cursor round trip")
	}
	if _, _, err := parseCursor("not-an-index"); err == nil {
		t.Fatal("invalid cursor accepted")
	}
}

func TestFieldSet11EnvironmentObservations(t *testing.T) {
	for _, c := range []struct{ group, key, value, invalid string }{
		{"cpu", "processBitness", "64", "64 bit"},
		{"cpu", "kernelMachine", "aarch64", "unknown"},
		{"system", "interfaceCapabilities", "nfc / gnss / usb_accessory", "nfc / private_device_id"},
		{"runtime", "externalInputTypes", "keyboard / gamepad", "keyboard / keyboard"},
		{"runtime", "externalInputTypes", "none", "none / pointer"},
	} {
		p := Parameter{Group: c.group, Key: c.key, Label: c.key, Value: &c.value, Source: "fixture", Status: "AVAILABLE"}
		if !p.valid(4, 11) || p.valid(4, 10) || p.valid(3, 0) {
			t.Errorf("unexpected schema/field set acceptance for %s", c.key)
		}
		p.Value = &c.invalid
		if p.valid(4, 11) {
			t.Errorf("accepted invalid observation for %s", c.key)
		}
	}
	errno := 13
	missing := Parameter{Group: "cpu", Key: "kernelMachine", Label: "Kernel", Source: "Os.uname",
		Status: "RESTRICTED", Reason: "ACCESS_DENIED", Errno: &errno}
	if !missing.valid(4, 11) || missing.valid(4, 10) {
		t.Fatal("missing architecture must retain its source and errno in v11 only")
	}
}

func TestFieldSet12Hardware(t *testing.T) {
	for _, c := range []struct{ group, key, value, invalid string }{
		{"system", "gnssHardwareYear", "2019", "0"},
		{"system", "gnssCapabilities", "measurements / antenna_info", "gpsCoordinates"},
		{"runtime", "declaredInput", "touchscreen / jazzhand", "gamepad / touchscreen"},
		{"sensors", "reportingModes", "5/11/2/1/0", "5/11/-1/1/0"},
		{"sensors", "fifoCount", "5", "05"},
		{"sensors", "directChannelTypes", "none", "memory_file / none"},
		{"media", "cameraModes", "raw / depth / high_speed_video", "depth / $jpeg"},
		{"runtime", "glesProbeResult", "pass", "unknown"},
		{"runtime", "glesProbeStage", "timeout", "vendor-private"},
		{"runtime", "glesProbeVersion", "3.2", "3.2 driver"},
	} {
		p := Parameter{Group: c.group, Key: c.key, Label: c.key, Value: &c.value, Source: "fixture", Status: "AVAILABLE"}
		if !p.valid(4, 12) || p.valid(4, 11) || p.valid(3, 0) {
			t.Errorf("unexpected version handling for %s", c.key)
		}
		p.Value = &c.invalid
		if p.valid(4, 12) {
			t.Errorf("accepted invalid reading for %s", c.key)
		}
	}
}

func TestTimedUSBOnlyWithPlanAndConsistentOutcome(t *testing.T) {
	f := func(group, key, value string) Parameter {
		return Parameter{Group: group, Key: key, Value: &value, Label: key, Source: "fixture", Status: "AVAILABLE"}
	}
	rows := []Parameter{f("environment", "capturePlan", "usb"), f("runtime", "usbStartCount", "0"), f("runtime", "usbEndCount", "1"),
		f("runtime", "usbStartAt", "1700000000000"), f("runtime", "usbEndAt", "1700000001000"), f("runtime", "usbElapsed", "1000 ms"), f("runtime", "usbOutcome", "increase")}
	for _, p := range rows {
		if !p.valid(4, 13) || p.valid(4, 12) {
			t.Errorf("bad version gate for %s", p.Key)
		}
	}
	if !validTimedExperiment(rows) {
		t.Fatal("valid USB outcome rejected")
	}
	if validTimedExperiment(rows[1:]) || validTimedExperiment(rows[:6]) {
		t.Fatal("missing plan or outcome accepted")
	}
	rows[6] = f("runtime", "usbOutcome", "no_change")
	if validTimedExperiment(rows) {
		t.Fatal("wrong USB outcome accepted")
	}
	if f("runtime", "usbElapsed", "120001 ms").valid(4, 13) || f("runtime", "usbStartAt", "0").valid(4, 13) {
		t.Fatal("invalid duration/date accepted")
	}
}

func TestFieldSet14GNSS(t *testing.T) {
	f := func(group, key, value string) Parameter {
		return Parameter{Group: group, Key: key, Value: &value, Label: key, Source: "fixture", Status: "AVAILABLE"}
	}
	for _, raw := range []string{"0", "2016", "2015", "2104", "-1"} {
		p := f("system", "gnssHardwareYear", raw)
		if !p.valid(4, 14) {
			t.Fatalf("SDK raw int %s rejected", raw)
		}
	}
	for _, raw := range []string{"0", "-1", "2104"} {
		if f("system", "gnssHardwareYear", raw).valid(4, 13) {
			t.Fatalf("legacy year gate drifted: %s", raw)
		}
	}
	for _, raw := range []string{"01", "+1", "some string", "2147483648", " 0"} {
		if f("system", "gnssHardwareYear", raw).valid(4, 14) {
			t.Fatalf("accepted non-SDK encoding %q", raw)
		}
	}
	plan := f("environment", "capturePlan", "gnss")
	rows := []Parameter{plan, f("system", "gnssCheckPrerequisite", "ready"), f("system", "gnssCheckStatus", "observed"),
		f("system", "gnssCheckMeasurements", "not_seen"), f("system", "gnssCheckStartAt", "1700000000000"),
		f("system", "gnssCheckEndAt", "1700000000010"), f("system", "gnssCheckElapsed", "10 ms")}
	for _, p := range rows {
		if p.valid(4, 13) || !p.valid(4, 14) {
			t.Errorf("mis-versioned field %s", p.Key)
		}
	}
	if !validTimedExperiment(rows) || validTimedExperiment(rows[:6]) || validTimedExperiment(rows[1:]) {
		t.Fatal("GNSS experiment presence constraints failed")
	}
	rows[1] = f("system", "gnssCheckPrerequisite", "permission_required")
	if validTimedExperiment(rows) {
		t.Fatal("blocked prerequisite cannot claim callback results")
	}
	for _, i := range []int{2, 3} {
		rows[i].Value, rows[i].Status, rows[i].Reason = nil, "RESTRICTED", "PERMISSION_REQUIRED"
	}
	if !validTimedExperiment(rows) || !rows[2].valid(4, 14) {
		t.Fatal("legitimate restricted result rejected")
	}
	if f("system", "gnssHardwareModel", "OEM text").valid(4, 14) ||
		f("system", "gnssCheckMeasurements", "individual measurement").valid(4, 14) ||
		f("system", "gnssCoordinates", "0,0").valid(4, 14) {
		t.Fatal("accepted prohibited raw GNSS fields")
	}
}

func TestFieldSet17ProcessEvidence(t *testing.T) {
	for _, c := range []struct{ group, key, value, invalid string }{
		{"environment", "hookSignals", "frida / gadget / zygisk / memfd_exec", "zygisk / frida"},
		{"environment", "tracerPid", "0", "0100"},
		{"environment", "rootMountHints", "overlay_system / tmpfs_sbin / magisk_path", "tmpfs_sbin / overlay_system"},
		{"environment", "rootManagerVisible", "none", "magisk / none"},
		{"environment", "userProfile", "managed", "guest"},
		{"environment", "drmSecurityLevel", "L2", "L0"},
		{"environment", "verityMode", "enforcing", "Enforcing"},
		{"environment", "buildDebuggable", "关闭", "false"},
		{"system", "partitionBuildDates", "system 2024-01-05 · vendor 2023-12-11", "vendor 2023-12-11 · system 2024-01-05"},
		{"system", "selinuxEvidence", "inferred_mac", "inferred"},
		{"cpu", "coresConfigured", "1024", "1025"},
	} {
		p := Parameter{Group: c.group, Key: c.key, Label: c.key, Value: &c.value, Source: "fixture", Status: "AVAILABLE"}
		if !p.valid(4, 17) || p.valid(4, 16) || p.valid(3, 0) {
			t.Errorf("unexpected version handling for %s.%s", c.group, c.key)
		}
		p.Value = &c.invalid
		if p.valid(4, 17) {
			t.Errorf("accepted invalid reading for %s.%s", c.group, c.key)
		}
	}
	for _, raw := range []string{"4194304", "1"} {
		value := raw
		p := Parameter{Group: "environment", Key: "tracerPid", Label: "TracerPid", Value: &value, Source: "fixture", Status: "AVAILABLE"}
		if !p.valid(4, 17) {
			t.Errorf("tracer pid %s rejected", raw)
		}
	}
	over := "4194305"
	tooLarge := Parameter{Group: "environment", Key: "tracerPid", Label: "TracerPid", Value: &over,
		Source: "fixture", Status: "AVAILABLE"}
	if tooLarge.valid(4, 17) {
		t.Fatal("out-of-range tracer pid accepted")
	}
	for _, raw := range []string{"1", "64"} {
		value := raw
		p := Parameter{Group: "cpu", Key: "coresConfigured", Label: "Cores", Value: &value, Source: "fixture", Status: "AVAILABLE"}
		if !p.valid(4, 17) {
			t.Errorf("configured cores %s rejected", raw)
		}
	}
	all := "system 2024-01-05 · vendor 2023-12-11 · product 2023-12-09 · odm 2023-12-08 · system_ext 2023-12-07 · bootimage 2023-12-06"
	complete := Parameter{Group: "system", Key: "partitionBuildDates", Label: "dates", Value: &all,
		Source: "fixture", Status: "AVAILABLE"}
	if !complete.valid(4, 17) {
		t.Fatal("full ordered partition date list rejected")
	}
	for _, raw := range []string{
		"system",
		"system 2024-13-05",
		"cache 2024-01-05",
		"system 2024-01-05 · system 2024-01-06",
		"system 2024-01-05 · ",
		"system 2024-01-05·vendor 2023-12-11",
	} {
		value := raw
		bad := Parameter{Group: "system", Key: "partitionBuildDates", Label: "dates", Value: &value,
			Source: "fixture", Status: "AVAILABLE"}
		if bad.valid(4, 17) {
			t.Errorf("accepted partition date text %q", raw)
		}
	}
	if partitionDatesText("") || !partitionDatesText("bootimage 2023-12-06") {
		t.Fatal("partition date text helper disagrees with the wire rule")
	}
	missing := Parameter{Group: "environment", Key: "tracerPid", Label: "TracerPid", Source: "/proc/self/status",
		Status: "RESTRICTED", Reason: "ACCESS_DENIED"}
	if !missing.valid(4, 17) || missing.valid(4, 16) {
		t.Fatal("restricted tracer pid must stay version gated")
	}
}

func TestFieldSet17To18DictionaryMetadata(t *testing.T) {
	meta := map[string]dictionaryField{}
	for _, entry := range dictionary() {
		meta[entry.Key] = entry
	}
	// maxFields for field set 20 is 248: these 224 static keys plus 24 partition rows.
	if len(meta) != 224 {
		t.Fatalf("static registry = %d keys, want 224", len(meta))
	}
	if got := meta["system.initialSdk"]; got.SinceFieldSet != 18 || got.ValueKind != "integer_text" ||
		got.Unit != "api_level" || got.MinSchema != 4 || got.Scope != "lan_projection" {
		t.Errorf("initialSdk metadata = %+v", got)
	}
	for _, want := range []struct{ key, unit string }{
		{"system.bootCount", "boot_count"}, {"system.mediaPerformanceClass", "media_performance_class"},
	} {
		got := meta[want.key]
		if got.SinceFieldSet != 20 || got.ValueKind != "integer_text" || got.Unit != want.unit ||
			got.MinSchema != 4 || got.Scope != "lan_projection" {
			t.Errorf("%s metadata = %+v", want.key, got)
		}
	}
	bootValue := "86"
	boot := Parameter{Group: "system", Key: "bootCount", Label: "x", Source: "s", Status: "AVAILABLE", Value: &bootValue}
	if !boot.valid(4, 20) {
		t.Error("bootCount rejected at field set 20")
	}
	if boot.valid(4, 19) {
		t.Error("bootCount accepted at field set 19")
	}
	for _, want := range []struct{ key, kind, unit, temporal string }{
		{"environment.hookSignals", "enum_text", "code_list", "snapshot"},
		{"environment.tracerPid", "integer_text", "pid", "snapshot"},
		{"environment.rootMountHints", "enum_text", "code_list", "snapshot"},
		{"environment.rootManagerVisible", "enum_text", "code_list", "snapshot"},
		{"environment.userProfile", "enum_text", "", "snapshot"},
		{"environment.drmSecurityLevel", "enum_text", "", "configuration"},
		{"environment.verityMode", "enum_text", "", "configuration"},
		{"environment.buildDebuggable", "enum_text", "", "configuration"},
		{"system.partitionBuildDates", "display_text", "partition_date_list", "configuration"},
		{"system.selinuxEvidence", "enum_text", "", "snapshot"},
		{"cpu.coresConfigured", "integer_text", "count", "configuration"},
	} {
		got, ok := meta[want.key]
		if !ok {
			t.Errorf("missing dictionary entry %s", want.key)
			continue
		}
		if got.ValueKind != want.kind || got.Unit != want.unit || got.Temporal != want.temporal ||
			got.SinceFieldSet != 17 || got.MinSchema != 4 || got.Scope != "lan_projection" {
			t.Errorf("%s metadata drift: %+v", want.key, got)
		}
	}
	if meta["environment.hookSignals"].Sensitivity != "operational_context" {
		t.Fatal("environment sensitivity must stay operational_context")
	}
}

func TestFieldSet19IdentityDeclarationCodes(t *testing.T) {
	meta := map[string]dictionaryField{}
	for _, entry := range dictionary() {
		meta[entry.Key] = entry
	}
	for _, want := range []struct{ key, unit string }{
		{"system.boardPlatform", "platform_code"},
		{"system.bootHardware", "platform_code"},
		{"system.hardwareSku", "sku_code"},
	} {
		got, ok := meta[want.key]
		if !ok {
			t.Errorf("missing dictionary entry %s", want.key)
			continue
		}
		if got.ValueKind != "enum_text" || got.Unit != want.unit || got.Temporal != "configuration" ||
			got.SinceFieldSet != 19 || got.MinSchema != 4 || got.Scope != "lan_projection" {
			t.Errorf("%s metadata drift: %+v", want.key, got)
		}
	}
	for _, tc := range []struct {
		key, value string
		ok         bool
	}{
		{"boardPlatform", "mt6985", true},
		{"boardPlatform", "sdm845", true},
		{"boardPlatform", "gs101", true},
		{"boardPlatform", "MT6985", false},
		{"boardPlatform", "bad value", false},
		{"bootHardware", "mtk", true},
		{"bootHardware", "qcom", true},
		{"bootHardware", "oriole", true},
		{"bootHardware", "QCOM", false},
		{"hardwareSku", "GR1YH", true},
		{"hardwareSku", "23078PND5G", true},
		{"hardwareSku", "GR1YH!", false},
	} {
		value := tc.value
		field := Parameter{Group: "system", Key: tc.key, Label: tc.key, Value: &value,
			Source: "getprop", Status: "AVAILABLE"}
		if got := field.valid(4, 19); got != tc.ok {
			t.Errorf("%s=%q accepted=%v, want %v", tc.key, tc.value, got, tc.ok)
		}
	}
	value := "mt6985"
	identity := Parameter{Group: "system", Key: "boardPlatform", Label: "board", Value: &value,
		Source: "getprop", Status: "AVAILABLE"}
	if identity.valid(4, 18) {
		t.Fatal("identity declarations must stay field set 19 gated")
	}
	if !identity.valid(4, 19) {
		t.Fatal("identity declaration rejected at field set 19")
	}
}

func TestReportSchemaRejectsExcessData(t *testing.T) {
	r := synthetic()
	if !r.valid() {
		t.Fatal("valid report rejected")
	}
	withoutMetrics := synthetic()
	withoutMetrics.Metrics = nil
	if withoutMetrics.valid() {
		t.Fatal("null metrics accepted")
	}
	r.Metrics[0].Key = "system.fingerprint"
	if r.valid() {
		t.Fatal("unexpected field accepted")
	}
	r = synthetic()
	r.Metrics = append(r.Metrics, r.Metrics[0])
	if r.valid() {
		t.Fatal("duplicate metric accepted")
	}
	r = synthetic()
	r.Metrics[0].Status = "AVAILABLE"
	if r.valid() {
		t.Fatal("inconsistent reason accepted")
	}
	b, _ := json.Marshal(synthetic())
	if decodeStrict(strings.NewReader(string(b[:len(b)-1])+`,"ssid":"private"}`), new(Report)) == nil {
		t.Fatal("accepted unknown top-level field")
	}
	if decodeStrict(strings.NewReader(string(b)+` {}`), new(Report)) == nil {
		t.Fatal("accepted trailing data")
	}
}

func TestOverallCapturePlan(t *testing.T) {
	value := func(group, key, text string) Parameter {
		return Parameter{Group: group, Key: key, Value: &text, Label: key, Source: "fixture", Status: "AVAILABLE"}
	}
	plan := value("environment", "capturePlan", "full")
	if plan.valid(4, 19) || !plan.valid(4, 20) {
		t.Fatal("full plan is accepted starting at field set 20")
	}
	local := []Parameter{plan, value("media", "avcStartAt", "1790000000000"), value("runtime", "glesEndAt", "1790000000001")}
	if !validTimedExperiment(local) {
		t.Fatal("full plan must accept local experiment timings")
	}
	for _, interactive := range []Parameter{
		value("network", "checkStartAt", "1790000000000"),
		value("runtime", "usbStartAt", "1790000000000"),
		value("system", "gnssCheckStartAt", "1790000000000"),
	} {
		if validTimedExperiment(append(local, interactive)) {
			t.Fatalf("full plan unexpectedly accepts interactive experiment %s", interactive.Key)
		}
	}
}

func TestLanSeparation(t *testing.T) {
	s := server{token: "test-token", batch: "lan-direct"}
	h := s.routes()
	for _, tc := range []struct {
		method, path, authorization, marker, origin string
		want                                        int
	}{
		{"GET", "/", "", "", "", 200},
		{"GET", "/api/admin/session", "", "", "", 401},
		{"GET", "/api/admin/session", "Bearer wrong", "", "", 401},
		{"GET", "/api/admin/session", "Bearer test-token", "", "", 200},
		{"GET", "/api/admin/reports", "", "android-lan", "", 401},
		{"GET", "/api/admin/invites", "Bearer test-token", "", "", 404},
		{"POST", "/api/admin/logout", "Bearer test-token", "", "", 403},
		{"POST", "/api/v1/reports", "Bearer test-token", "", "", 403},
		{"POST", "/api/v1/reports", "", "android-lan", "http://example.test", 403},
		{"POST", "/api/v1/reports", "", "android-lan", "", 415},
	} {
		r := httptest.NewRequest(tc.method, tc.path, nil)
		if tc.authorization != "" {
			r.Header.Set("Authorization", tc.authorization)
		}
		if tc.marker != "" {
			r.Header.Set("X-SigMark-Client", tc.marker)
		}
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("%s %s: got %d want %d", tc.method, tc.path, w.Code, tc.want)
		}
		if w.Header().Get("WWW-Authenticate") != "" {
			t.Fatal("native login challenge must not appear")
		}
	}
}

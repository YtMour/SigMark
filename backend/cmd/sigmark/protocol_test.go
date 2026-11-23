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

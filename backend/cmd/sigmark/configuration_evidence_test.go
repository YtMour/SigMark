package main

import (
	"strings"
	"testing"
)

func TestConfigurationCodeMobileParity(t *testing.T) {
	values := []struct{ group, key, value string }{
		{"system", "brand", "厂牌"}, {"system", "model", "Bench 1"}, {"system", "device", "bench"},
		{"cpu", "abis", "arm64-v8a, armeabi-v7a"},
		{"cpu", "hardware", "bench"}, {"system", "board", "benchboard"},
		{"cpu", "coresConfigured", "8"}, {"system", "initialSdk", "31"},
		{"system", "type", "user"}, {"system", "buildId", "QA1A"},
		{"system", "incremental", "1"}, {"system", "patch", "2026-11-01"},
	}
	report := Report{}
	for _, row := range values {
		report.Parameters = append(report.Parameters, Parameter{Group: row.group, Key: row.key, Value: &row.value, Status: "AVAILABLE", Source: "Build"})
	}
	code := archivedCode(report, nil)
	if code.Components[0].Code != "P2-0298a3fdcf04149ce27436cc7d0d5509" ||
		code.Components[1].Code != "H2-0df61682ea44367fd0ebb157b98c300f" ||
		code.Components[2].Code != "R2-abf4c36833e6a89dec9715fe56da99e7" {
		t.Fatalf("codes disagree with mobile vectors: %+v", code)
	}
	prior := &storedReport{ID: "prior", Report: report}
	current := report
	current.Parameters = append([]Parameter{}, report.Parameters...)
	for i := range current.Parameters {
		if current.Parameters[i].Group == "system" && current.Parameters[i].Key == "incremental" {
			current.Parameters[i].Value = nil
			current.Parameters[i].Status = "RESTRICTED"
		}
	}
	next := archivedCode(current, prior)
	part := next.Components[2]
	if next.PreviousReportID != "prior" || part.Available != 3 || part.Code != "" || part.Inputs[2].Change != "lost" ||
		next.Components[0].Code != code.Components[0].Code {
		t.Fatalf("unexpected change: %+v", next)
	}
}

func TestSysfsWireLimits(t *testing.T) {
	f := func(group, key, path, value string) Parameter {
		return Parameter{Group: group, Key: key, Label: "fixture", Source: path, Value: &value, Status: "AVAILABLE"}
	}
	path := "/sys/devices/system/cpu/online"
	ok := f("cpu", "sysCpuOnline", path, "0-3,5,6-7")
	if !ok.valid(4, 15) || ok.valid(4, 14) {
		t.Fatal("wrong field-set boundary")
	}
	for _, raw := range []string{"0-3,3", "0-4096", "4-2", "00", "0,", "0-1\n2", strings.Repeat("0,", 64)} {
		if f("cpu", "sysCpuOnline", path, raw).valid(4, 15) {
			t.Errorf("accepted CPU list %q", raw)
		}
	}
	if f("cpu", "sysCpuOnline", "ADB shell", "0").valid(4, 15) {
		t.Fatal("different observer source accepted")
	}
	if !f("battery", "sysBatteryTemp", "/sys/class/power_supply/battery/temp", "-40").valid(4, 15) ||
		f("battery", "sysBatteryTemp", "/sys/class/power_supply/battery/temp", "35000").valid(4, 15) {
		t.Fatal("temperature limits inconsistent")
	}
	// The same tenths-of-°C reading may come from the BMS node on devices without
	// a battery node; the dictionary keeps the battery node as the primary path.
	if !f("battery", "sysBatteryTemp", "/sys/class/power_supply/bms/temp", "350").valid(4, 15) {
		t.Fatal("bms temperature node rejected")
	}
	for _, bad := range []string{"/sys/class/power_supply/battery/tempx", "/sys/class/power_supply/bms/temp ", "ADB shell"} {
		if f("battery", "sysBatteryTemp", bad, "350").valid(4, 15) {
			t.Fatalf("unlisted temperature node accepted: %q", bad)
		}
	}
	if sys := sysfsFields["battery.sysBatteryTemp"]; sys.path() != "/sys/class/power_supply/battery/temp" ||
		len(sys.paths) != 2 {
		t.Fatalf("battery temperature node list drifted: %+v", sys)
	}
	for _, entry := range dictionary() {
		if entry.Key == "battery.sysBatteryTemp" && entry.Path != "/sys/class/power_supply/battery/temp" {
			t.Fatalf("dictionary must show the primary node: %q", entry.Path)
		}
		if entry.Key == "battery.sysBatteryTemp" && entry.Observer != "APP_SYSFS" {
			t.Fatalf("unexpected sysfs observer: %q", entry.Observer)
		}
	}
	errno := 13
	ok.Value, ok.Status, ok.Reason, ok.Errno = nil, "RESTRICTED", "ACCESS_DENIED", &errno
	if !ok.valid(4, 15) {
		t.Fatal("legitimate restricted reading rejected")
	}
}

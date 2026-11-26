package main

import (
	"net/http"
	"strings"
)

const latestFieldSet = 26
const dictionaryVersion = "sigmark-lan-fields/17"

type dictionaryField struct {
	Key           string   `json:"key"`
	MinSchema     int      `json:"minSchemaVersion"`
	SinceFieldSet int      `json:"sinceFieldSet,omitempty"`
	Unit          string   `json:"unit,omitempty"`
	WireType      string   `json:"wireType,omitempty"`
	ValueKind     string   `json:"valueKind,omitempty"`
	Temporal      string   `json:"temporal,omitempty"`
	Scope         string   `json:"scope,omitempty"`
	Sensitivity   string   `json:"sensitivity,omitempty"`
	MinAPI        int      `json:"minApi,omitempty"`
	Plan          string   `json:"plan,omitempty"`
	AlsoPlans     []string `json:"alsoPlans,omitempty"`
	Requires      []string `json:"requires,omitempty"`
	Observer      string   `json:"observer,omitempty"`
	Path          string   `json:"path,omitempty"`
}

func describeField(f *dictionaryField, requirements map[string]dossierRule) {
	group, key, _ := strings.Cut(f.Key, ".")
	f.WireType, f.ValueKind, f.Scope = "string_or_null", "display_text", "lan_projection"
	f.Temporal, f.Sensitivity = dossierFieldKind(group, key), "technical"
	if sys, ok := sysfsFields[f.Key]; ok {
		f.Unit, f.MinAPI, f.Observer, f.Path = sys.unit, 26, "APP_SYSFS", sys.path()
		f.ValueKind = "kernel_cpu_list"
		if group == "battery" {
			f.ValueKind = "integer_text"
		}
	}
	if rule, ok := requirements[f.Key]; ok {
		f.MinAPI, f.Plan = rule.minAPI, rule.plan
		if rule.fine {
			f.Requires = []string{"android.permission.ACCESS_FINE_LOCATION", "system_location_enabled"}
		}
	}
	switch {
	case group == "network" && strings.HasPrefix(key, "check"):
		f.Plan = "network"
	case group == "media" && strings.HasPrefix(key, "avc"), group == "runtime" && strings.HasPrefix(key, "gles"):
		f.Plan = "rom"
	case group == "runtime" && strings.HasPrefix(key, "usb"):
		f.Plan = "usb"
	case group == "system" && strings.HasPrefix(key, "gnssCheck"):
		f.Plan = "gnss"
	}
	if f.Plan != "" {
		f.Temporal = "experiment"
	}
	if f.Plan == "rom" {
		f.AlsoPlans = []string{"full"}
	}
	switch f.Key {
	case "battery.present":
		f.ValueKind = "enum_text"
	case "battery.cycleCount":
		f.ValueKind, f.MinAPI = "integer_text", 34
	case "cellular.dataSubscriptionService", "cellular.carrierBandwidths":
		f.MinAPI = 28
		f.Requires = []string{"android.permission.READ_PHONE_STATE", "api_28_to_32:android.permission.ACCESS_FINE_LOCATION", "api_28_to_32:system_location_enabled"}
	case "cpu.processBitness", "system.gnssHardwareYear", "system.initialSdk", "system.bootCount",
		"system.mediaPerformanceClass", "sensors.fifoCount", "runtime.usbStartCount", "runtime.usbEndCount":
		f.ValueKind = "integer_text"
	case "runtime.glesProbeVersion", "runtime.vulkanVersion":
		f.ValueKind = "version_text"
	case "system.patch", "system.vendorSpl", "system.systemSpl":
		f.ValueKind = "date_text"
	case "environment.capturePlan", "environment.capturePhoneAccess", "environment.captureLocationAccess", "environment.captureLocationSwitch",
		"runtime.glesProbeResult", "runtime.glesProbeStage", "media.avcFirstFrame", "media.avcStage", "system.gnssProvider",
		"system.gnssAntennaSupport", "system.gnssModelReported", "system.gnssCheckStatus", "system.gnssCheckMeasurements", "system.gnssCheckPrerequisite":
		f.ValueKind = "enum_text"
	case "environment.tracerPid":
		f.ValueKind, f.Unit = "integer_text", "pid"
	case "cpu.coresConfigured":
		f.ValueKind, f.Unit = "integer_text", "count"
	case "environment.hookSignals", "environment.rootMountHints", "environment.rootManagerVisible":
		f.ValueKind, f.Unit = "enum_text", "code_list"
	case "environment.userProfile", "environment.drmSecurityLevel", "environment.verityMode",
		"environment.buildDebuggable", "system.selinuxEvidence":
		f.ValueKind = "enum_text"
	case "system.partitionBuildDates":
		f.Unit = "partition_date_list"
	case "system.boardPlatform", "system.bootHardware":
		f.ValueKind, f.Unit = "enum_text", "platform_code"
	case "system.hardwareSku":
		f.ValueKind, f.Unit = "enum_text", "sku_code"
	case "system.propertyModel", "system.propertyDevice":
		f.ValueKind, f.Observer = "declaration_text", "APP_GETPROP"
	case "environment.overlayDeviceCodename":
		f.ValueKind, f.Unit, f.Observer = "enum_text", "device_codename", "APP_PROC_MAPS"
	case "environment.overlayEvidence":
		f.ValueKind, f.Unit, f.Observer = "enum_text", "overlay_evidence", "APP_PROC_MAPS+APP_DIR_LIST"
	case "cpu.cpuCapacity":
		f.ValueKind, f.Unit, f.Observer = "enum_text", "capacity_profile", "APP_SYSFS"
	case "memory.cmaTotal":
		f.ValueKind, f.Unit, f.Observer = "display_text", "MiB", "APP_PROC"
	}
	if f.Unit == "epoch_ms" {
		f.ValueKind = "integer_text"
	}
	if oneOf(group, "network", "cellular", "environment", "app") || f.Key == "runtime.externalInputTypes" {
		f.Sensitivity = "operational_context"
	}
}

var fieldUnits = map[string]string{
	"battery.cycleCount": "cycles", "cellular.carrierBandwidths": "kHz",
	"system.patch": "YYYY-MM-DD", "system.vendorSpl": "YYYY-MM-DD", "system.systemSpl": "YYYY-MM-DD",
	"runtime.vulkanVersion": "version", "media.avcElapsed": "ms", "media.avcFixture": "fixture_id",
	"media.avcFirstFrame": "outcome_code", "media.avcStage": "stage_code",
	"environment.capturePlan": "plan_code", "environment.capturePhoneAccess": "authorization_code",
	"environment.captureLocationAccess": "authorization_code", "environment.captureLocationSwitch": "switch_code",
	"network.wifiFrequency": "MHz", "cellular.cellLTEBandwidth": "kHz",
	"network.checkElapsed": "ms", "network.checkStartTransport": "transport_code", "network.checkEndTransport": "transport_code",
	"cpu.processBitness": "bit", "system.interfaceCapabilities": "feature_codes", "runtime.externalInputTypes": "input_type_codes",
	"system.gnssCheckStartAt": "epoch_ms", "system.gnssCheckEndAt": "epoch_ms", "system.gnssCheckElapsed": "ms",
	"system.gnssHardwareYear": "year", "system.initialSdk": "api_level", "system.bootCount": "boot_count",
	"system.mediaPerformanceClass": "media_performance_class", "sensors.reportingModes": "counts", "sensors.fifoCount": "sensor_count",
	"runtime.glesProbeVersion": "version",
	"network.checkStartAt":     "epoch_ms", "network.checkEndAt": "epoch_ms", "media.avcStartAt": "epoch_ms", "media.avcEndAt": "epoch_ms",
	"runtime.glesStartAt": "epoch_ms", "runtime.glesEndAt": "epoch_ms", "runtime.usbStartAt": "epoch_ms", "runtime.usbEndAt": "epoch_ms",
	"runtime.usbElapsed": "ms", "runtime.usbStartCount": "device_count", "runtime.usbEndCount": "device_count", "runtime.usbOutcome": "outcome_code",
	"cpu.cpuParts": "core_part_counts", "memory.physicalRam": "GiB", "memory.kernelMemTotal": "GiB",
	"environment.overlayDeviceCodename": "device_codename",
	"environment.overlayEvidence":       "overlay_evidence",
	"cpu.cpuCapacity":                   "capacity_profile", "memory.cmaTotal": "MiB",
}

func dictionary() []dictionaryField {
	legacy, diagnostic, versioned := map[string]bool{}, map[string]bool{}, map[string]int{}
	for g, keys := range parameterKeys {
		for _, k := range keys {
			legacy[g+"."+k] = true
		}
	}
	for g, keys := range diagnosticKeys {
		for _, k := range keys {
			diagnostic[g+"."+k] = true
		}
	}
	for _, p := range versionedParameters {
		versioned[p.group+"."+p.key] = p.since
	}
	keys := coverageFieldKeys()
	requirements := map[string]dossierRule{}
	for _, rule := range dossierChecklist {
		requirements[rule.key] = rule
	}
	items := make([]dictionaryField, 0, len(keys))
	for _, key := range keys {
		// Static parameters started with schema 2; schema 1 metrics are status-only.
		row := dictionaryField{Key: key, Unit: fieldUnits[key]}
		switch {
		case legacy[key]:
			row.MinSchema = 2
		case diagnostic[key]:
			row.MinSchema = 3
		default:
			row.MinSchema, row.SinceFieldSet = 4, versioned[key]
		}
		describeField(&row, requirements)
		items = append(items, row)
	}
	return items
}

func (_ server) fieldDictionary(w http.ResponseWriter, _ *http.Request) {
	send(w, http.StatusOK, map[string]any{
		"schemaVersion": 1, "dictionaryVersion": dictionaryVersion, "latestFieldSet": latestFieldSet, "items": dictionary(),
		"readingStates": []string{"AVAILABLE", "RESTRICTED", "UNAVAILABLE", "ERROR"},
		"dynamic":       map[string]any{"pattern": "^system\\.partition_[a-z0-9_]{1,32}$", "minSchemaVersion": 4, "sinceFieldSet": 7, "maxPerReport": 24},
	})
}

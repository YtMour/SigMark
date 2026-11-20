package main

import (
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"

	"unicode"
	"unicode/utf8"
)

type Metric struct {
	Key    string `json:"key"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}

type Parameter struct {
	Group  string  `json:"group"`
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Value  *string `json:"value"`
	Source string  `json:"source"`
	Status string  `json:"status"`
	Reason string  `json:"reason,omitempty"`
	Errno  *int    `json:"errno,omitempty"`
	Note   string  `json:"note,omitempty"`
}

var parameterKeys = map[string][]string{
	"system":  {"release", "api", "patch", "type", "manufacturer", "brand", "model", "buildId", "romHint", "uptime", "selinux", "selinuxPolicy", "selinuxBootHint", "selinuxBuildHint", "socModel", "socManufacturer", "declaredCapabilities"},
	"cpu":     {"kernel", "kernelFull", "abis", "hardware", "cores", "pageSize", "cpuInfo", "features", "cpu0MaxFrequency"},
	"memory":  {"totalRam", "availableRam", "lowMemory", "lowMemoryThreshold", "swap", "internalTotal", "internalAvailable", "sharedState"},
	"display": {"resolution", "densityDpi", "density", "fontScale", "refresh", "modes", "hdr", "sizeEstimate"},
	"battery": {"level", "status", "plugged", "temperature", "voltage", "health", "current", "powerSaver", "thermalStatus"},
	"sensors": {"count"},
	"network": {"transport", "internetValidation", "metered", "captivePortal", "bandwidthEstimate", "wifiDetails", "wifiFrequency", "wifiBandChannel", "wifiRssi", "wifiLinkSpeed", "wifiStandard", "wifiSecurity", "linkDetails", "defaultRouteFamilies", "privateDnsActive", "linkMtu"},
	"cellular": {"support", "subscription", "dataState", "mobileDataToggle", "roaming", "dataRat", "modemSignalLevel", "cellDiagnostics",
		"cellLTEBands", "cellLTEBandRange", "cellLTEBandwidth", "cellLTESignal", "cellNRBands", "cellNRSignal"},
}

var diagnosticKeys = map[string][]string{
	"system":      {"display", "incremental", "buildTime", "board", "sku", "baseOs", "tags", "device", "product", "bootloader"},
	"cpu":         {"arch", "abi32", "abi64"},
	"memory":      {"ramUseEstimate", "volumeSummary", "systemSpace", "appCacheSpace"},
	"display":     {"wideGamut", "visibleDisplays", "windowSize", "systemBarInsets", "cutoutInsets"},
	"battery":     {"capacityPercent", "chargeCounter", "energyCounter", "currentAverage"},
	"runtime":     {"featureCount", "openGlEs", "virtualMachine", "heapMax", "heapAllocated", "heapFree", "standbyBucket", "backgroundRestricted"},
	"media":       {"cameraCount", "bluetoothCapabilities", "audioCapabilities", "audioSampleRate", "audioBuffer", "codecs"},
	"environment": {"selinuxDomain", "buildSignals", "systemDebuggable", "verifiedBoot", "vbmetaState", "flashLock"},
	"app":         {"version", "appDebuggable", "debuggerConnected"},
}

func textValid(s string, max int) bool {
	return utf8.RuneCountInString(s) <= max && strings.IndexFunc(s, unicode.IsControl) < 0
}

func stateValid(status, reason string) bool {
	return oneOf(status, "AVAILABLE", "UNAVAILABLE", "RESTRICTED", "ERROR") && (reason == "" ||
		(status == "RESTRICTED" && oneOf(reason, "PERMISSION_REQUIRED", "LOCATION_DISABLED", "ACCESS_DENIED")) ||
		(status == "UNAVAILABLE" && oneOf(reason, "NOT_REPORTED", "NODE_MISSING", "INVALID_VALUE", "OPTIONAL_UNSET",
			"INTERFACE_UNSUPPORTED", "MODEM_NOT_REPORTED", "NO_REGISTERED_LTE")) ||
		(status == "ERROR" && reason == "READ_FAILED"))
}

func (p Parameter) valid(schema, fieldSet int) bool {
	allowed := oneOf(p.Key, parameterKeys[p.Group]...) || (schema >= 3 && oneOf(p.Key, diagnosticKeys[p.Group]...)) ||
		(schema >= 4 && fieldSet >= 3 && p.Group == "cellular" && p.Key == "carrierBandwidths") ||
		(schema >= 4 && fieldSet >= 4 && ((p.Group == "cellular" && p.Key == "simState") ||
			(p.Group == "network" && oneOf(p.Key, "visibleTransports", "wifiRouteRole"))))
	if !allowed || !stateValid(p.Status, p.Reason) ||
		strings.TrimSpace(p.Label) == "" || !textValid(p.Label, 64) ||
		strings.TrimSpace(p.Source) == "" || !textValid(p.Source, 160) || !textValid(p.Note, 280) {
		return false
	}
	if p.Errno != nil && (!((p.Group == "system" && oneOf(p.Key, "selinux", "selinuxPolicy")) ||
		(p.Group == "cpu" && oneOf(p.Key, "cpuInfo", "features", "cpu0MaxFrequency", "kernelFull", "pageSize")) ||
		(p.Group == "memory" && p.Key == "swap") || (schema >= 3 && p.Group == "environment" && p.Key == "selinuxDomain")) ||
		p.Status == "AVAILABLE" || *p.Errno < 1 || *p.Errno > 4095) {
		return false
	}
	if p.Status == "AVAILABLE" {
		return p.Value != nil && strings.TrimSpace(*p.Value) != "" && textValid(*p.Value, 512)
	}
	return p.Value == nil
}

type Coverage struct {
	Group       string `json:"group"`
	Available   int    `json:"available"`
	Restricted  int    `json:"restricted"`
	Unavailable int    `json:"unavailable"`
	Errors      int    `json:"errors"`
}

func (row Coverage) counts() [4]int {
	return [4]int{row.Available, row.Restricted, row.Unavailable, row.Errors}
}

func validCoverage(rows []Coverage, fields []Parameter) bool {
	if len(rows) == 0 || len(rows) > 12 {
		return false
	}
	available := make(map[string][4]int, len(rows))
	total := 0
	for _, row := range rows {
		if _, exists := available[row.Group]; exists || (parameterKeys[row.Group] == nil && diagnosticKeys[row.Group] == nil) {
			return false
		}
		sum := 0
		for _, count := range row.counts() {
			if count < 0 || count > 1024 {
				return false
			}
			sum += count
		}
		if sum == 0 {
			return false
		}
		total += sum
		available[row.Group] = row.counts()
	}
	if total > 2048 {
		return false
	}
	statusIndex := map[string]int{"AVAILABLE": 0, "RESTRICTED": 1, "UNAVAILABLE": 2, "ERROR": 3}
	for _, field := range fields {
		status, exists := statusIndex[field.Status]
		counts := available[field.Group]
		if !exists || counts[status] == 0 {
			return false
		}
		counts[status]--
		available[field.Group] = counts
	}
	return true
}

type Report struct {
	SchemaVersion    int         `json:"schemaVersion"`
	RequestID        string      `json:"requestId"`
	CapturedAt       int64       `json:"capturedAtEpochMs"`
	Model            string      `json:"model"`
	AndroidAPI       int         `json:"androidApi"`
	AppVersion       string      `json:"appVersion"`
	CollectorVersion string      `json:"collectorVersion,omitempty"`
	FieldSetVersion  int         `json:"fieldSetVersion,omitempty"`
	Network          string      `json:"network"`
	WifiBand         string      `json:"wifiBand"`
	Radio            string      `json:"radio"`
	Metrics          []Metric    `json:"metrics"`
	Feedback         string      `json:"feedback,omitempty"`
	Parameters       []Parameter `json:"parameters,omitempty"`
	Coverage         []Coverage  `json:"coverage,omitempty"`
}

var (
	batchPattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)
	requestPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	modelPattern   = regexp.MustCompile(`^[\p{L}\p{N} ._+()-]{1,40}$`)
	versionPattern = regexp.MustCompile(`^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$`)
)

func oneOf(s string, options ...string) bool {
	for _, o := range options {
		if s == o {
			return true
		}
	}
	return false
}

func decodeStrict(r io.Reader, dst any) error {
	d := json.NewDecoder(r)
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errors.New("trailing data")
	}
	return nil
}

func (p Report) valid() bool {
	if (p.SchemaVersion < 1 || p.SchemaVersion > 4) || !requestPattern.MatchString(p.RequestID) || p.AndroidAPI < 0 || p.AndroidAPI > 999 ||
		!modelPattern.MatchString(p.Model) || !versionPattern.MatchString(p.AppVersion) ||
		p.CapturedAt < 946684800000 || p.CapturedAt >= 4102444800000 ||
		!oneOf(p.Network, "wifi", "cellular", "ethernet", "vpn", "none", "other", "unknown") ||
		!oneOf(p.WifiBand, "2.4", "4.9", "5", "6", "60", "unknown") ||
		!oneOf(p.Radio, "lte", "nr", "iwlan", "other", "unknown") ||
		!textValid(p.Feedback, 300) || len(p.Metrics) == 0 || len(p.Metrics) > 6 ||
		(p.SchemaVersion == 1 && len(p.Parameters) != 0) ||
		(p.SchemaVersion == 2 && (len(p.Parameters) == 0 || len(p.Parameters) > 96)) ||
		(p.SchemaVersion >= 3 && (len(p.Parameters) == 0 || len(p.Parameters) > 160)) ||
		(p.SchemaVersion < 3 && p.Coverage != nil) ||
		(p.SchemaVersion < 4 && (p.CollectorVersion != "" || p.FieldSetVersion != 0)) ||
		(p.SchemaVersion == 4 && (!versionPattern.MatchString(p.CollectorVersion) || p.FieldSetVersion < 2 || p.FieldSetVersion > 4)) {
		return false
	}
	seen := map[string]bool{}
	for _, m := range p.Metrics {
		if seen[m.Key] || !oneOf(m.Key, "system.selinux", "cpu.kernelFull", "network.wifiFrequency", "network.internetValidation", "cellular.dataRat", "cellular.cellDiagnostics") {
			return false
		}
		seen[m.Key] = true
		if !stateValid(m.Status, m.Reason) {
			return false
		}
	}
	for _, field := range p.Parameters {
		key := field.Group + "/" + field.Key
		if seen[key] || !field.valid(p.SchemaVersion, p.FieldSetVersion) {
			return false
		}
		seen[key] = true
	}
	return p.SchemaVersion < 3 || validCoverage(p.Coverage, p.Parameters)
}

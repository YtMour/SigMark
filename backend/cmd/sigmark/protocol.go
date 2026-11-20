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

func textValid(s string, max int) bool {
	return utf8.RuneCountInString(s) <= max && strings.IndexFunc(s, unicode.IsControl) < 0
}

func stateValid(status, reason string) bool {
	return oneOf(status, "AVAILABLE", "UNAVAILABLE", "RESTRICTED", "ERROR") && (reason == "" ||
		(status == "RESTRICTED" && oneOf(reason, "PERMISSION_REQUIRED", "LOCATION_DISABLED", "ACCESS_DENIED")) ||
		(status == "UNAVAILABLE" && oneOf(reason, "NOT_REPORTED", "NODE_MISSING", "INVALID_VALUE")) ||
		(status == "ERROR" && reason == "READ_FAILED"))
}

func (p Parameter) valid() bool {
	if !oneOf(p.Key, parameterKeys[p.Group]...) || !stateValid(p.Status, p.Reason) ||
		strings.TrimSpace(p.Label) == "" || !textValid(p.Label, 64) ||
		strings.TrimSpace(p.Source) == "" || !textValid(p.Source, 160) || !textValid(p.Note, 280) {
		return false
	}
	if p.Errno != nil && (!((p.Group == "system" && oneOf(p.Key, "selinux", "selinuxPolicy")) ||
		(p.Group == "cpu" && oneOf(p.Key, "cpuInfo", "features", "cpu0MaxFrequency", "kernelFull", "pageSize")) ||
		(p.Group == "memory" && p.Key == "swap")) ||
		p.Status == "AVAILABLE" || *p.Errno < 1 || *p.Errno > 4095) {
		return false
	}
	if p.Status == "AVAILABLE" {
		return p.Value != nil && strings.TrimSpace(*p.Value) != "" && textValid(*p.Value, 512)
	}
	return p.Value == nil
}

type Report struct {
	SchemaVersion int         `json:"schemaVersion"`
	RequestID     string      `json:"requestId"`
	CapturedAt    int64       `json:"capturedAtEpochMs"`
	Model         string      `json:"model"`
	AndroidAPI    int         `json:"androidApi"`
	AppVersion    string      `json:"appVersion"`
	Network       string      `json:"network"`
	WifiBand      string      `json:"wifiBand"`
	Radio         string      `json:"radio"`
	Metrics       []Metric    `json:"metrics"`
	Feedback      string      `json:"feedback,omitempty"`
	Parameters    []Parameter `json:"parameters,omitempty"`
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
	if (p.SchemaVersion != 1 && p.SchemaVersion != 2) || !requestPattern.MatchString(p.RequestID) || p.AndroidAPI < 0 || p.AndroidAPI > 999 ||
		!modelPattern.MatchString(p.Model) || !versionPattern.MatchString(p.AppVersion) ||
		p.CapturedAt < 946684800000 || p.CapturedAt >= 4102444800000 ||
		!oneOf(p.Network, "wifi", "cellular", "ethernet", "vpn", "none", "other", "unknown") ||
		!oneOf(p.WifiBand, "2.4", "4.9", "5", "6", "60", "unknown") ||
		!oneOf(p.Radio, "lte", "nr", "iwlan", "other", "unknown") ||
		!textValid(p.Feedback, 300) || len(p.Metrics) == 0 || len(p.Metrics) > 6 ||
		(p.SchemaVersion == 1 && len(p.Parameters) != 0) || (p.SchemaVersion == 2 && (len(p.Parameters) == 0 || len(p.Parameters) > 96)) {
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
		if seen[key] || !field.valid() {
			return false
		}
		seen[key] = true
	}
	return true
}

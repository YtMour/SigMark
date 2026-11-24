package main

import (
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"

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

type versionedParameter struct {
	group string
	key   string
	since int
}

var versionedParameters = []versionedParameter{
	{"cellular", "carrierBandwidths", 3},
	{"cellular", "simState", 4},
	{"network", "visibleTransports", 4}, {"network", "wifiRouteRole", 4},
	{"cellular", "defaultDataSlot", 5}, {"cellular", "slotService", 5},
	{"environment", "keyguardSecure", 6}, {"environment", "storageEncryption", 6},
	{"system", "partitionCount", 7}, {"system", "webViewProvider", 7}, {"system", "webViewVersion", 7}, {"system", "webViewCode", 7},
	{"system", "systemSpl", 7}, {"system", "vendorSpl", 7}, {"environment", "keyProtection", 7},
	{"app", "package", 7}, {"app", "channel", 7}, {"app", "certSha256", 7},
	{"runtime", "vulkanVersion", 8}, {"media", "cameraCapabilitySummary", 8}, {"sensors", "typeWakeupSummary", 8},
	{"environment", "capturePlan", 9}, {"environment", "capturePhoneAccess", 9},
	{"environment", "captureLocationAccess", 9}, {"environment", "captureLocationSwitch", 9},
	{"media", "avcFixture", 9}, {"media", "avcFirstFrame", 9}, {"media", "avcStage", 9},
	{"media", "avcDecoder", 9}, {"media", "avcElapsed", 9},
	{"network", "checkStartTransport", 10}, {"network", "checkEndTransport", 10},
	{"network", "checkStartValidated", 10}, {"network", "checkEndValidated", 10}, {"network", "checkElapsed", 10},
	{"cpu", "processBitness", 11}, {"cpu", "kernelMachine", 11},
	{"system", "interfaceCapabilities", 11}, {"runtime", "externalInputTypes", 11},
	{"system", "gnssHardwareYear", 12}, {"system", "gnssCapabilities", 12}, {"runtime", "declaredInput", 12},
	{"system", "gnssProvider", 14}, {"system", "gnssModelReported", 14}, {"system", "gnssAntennaSupport", 14},
	{"system", "gnssCheckPrerequisite", 14}, {"system", "gnssCheckStatus", 14}, {"system", "gnssCheckMeasurements", 14},
	{"system", "gnssCheckStartAt", 14}, {"system", "gnssCheckEndAt", 14}, {"system", "gnssCheckElapsed", 14},
	{"cpu", "sysCpuPossible", 15}, {"cpu", "sysCpuOnline", 15}, {"battery", "sysBatteryTemp", 15},
	{"battery", "present", 16}, {"battery", "cycleCount", 16}, {"cellular", "dataSubscriptionService", 16},
	{"system", "initialSdk", 18}, {"system", "bootCount", 20}, {"system", "mediaPerformanceClass", 20},
	{"system", "boardPlatform", 19}, {"system", "bootHardware", 19}, {"system", "hardwareSku", 19},
	{"environment", "hookSignals", 17}, {"environment", "tracerPid", 17}, {"environment", "rootMountHints", 17},
	{"environment", "rootManagerVisible", 17}, {"environment", "userProfile", 17}, {"environment", "drmSecurityLevel", 17},
	{"environment", "verityMode", 17}, {"environment", "buildDebuggable", 17},
	{"system", "partitionBuildDates", 17}, {"system", "selinuxEvidence", 17}, {"cpu", "coresConfigured", 17},
	{"sensors", "reportingModes", 12}, {"sensors", "fifoCount", 12}, {"sensors", "directChannelTypes", 12},
	{"media", "cameraModes", 12}, {"runtime", "glesProbeResult", 12}, {"runtime", "glesProbeStage", 12}, {"runtime", "glesProbeVersion", 12},
	{"network", "checkStartAt", 13}, {"network", "checkEndAt", 13}, {"media", "avcStartAt", 13}, {"media", "avcEndAt", 13},
	{"runtime", "glesStartAt", 13}, {"runtime", "glesEndAt", 13},
	{"runtime", "usbStartAt", 13}, {"runtime", "usbEndAt", 13}, {"runtime", "usbStartCount", 13}, {"runtime", "usbEndCount", 13},
	{"runtime", "usbOutcome", 13}, {"runtime", "usbElapsed", 13},
}

var partitionField = regexp.MustCompile(`^partition_[a-z0-9_]{1,32}$`)

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
	allowed := oneOf(p.Key, parameterKeys[p.Group]...) || (schema >= 3 && oneOf(p.Key, diagnosticKeys[p.Group]...))
	if !allowed && schema >= 4 {
		allowed = fieldSet >= 7 && p.Group == "system" && partitionField.MatchString(p.Key)
		for _, item := range versionedParameters {
			if p.Group == item.group && p.Key == item.key && fieldSet >= item.since {
				allowed = true
				break
			}
		}
	}
	if !allowed || !stateValid(p.Status, p.Reason) ||
		strings.TrimSpace(p.Label) == "" || !textValid(p.Label, 64) ||
		strings.TrimSpace(p.Source) == "" || !textValid(p.Source, 160) || !textValid(p.Note, 280) {
		return false
	}
	sys, sysField := sysfsFields[p.Group+"."+p.Key]
	if sysField && !sys.allows(p.Source) {
		return false
	}
	if p.Errno != nil && (!(sysField || (p.Group == "system" && oneOf(p.Key, "selinux", "selinuxPolicy")) ||
		(p.Group == "cpu" && oneOf(p.Key, "cpuInfo", "features", "cpu0MaxFrequency", "kernelFull", "kernelMachine", "pageSize")) ||
		(p.Group == "memory" && p.Key == "swap") || (schema >= 3 && p.Group == "environment" && p.Key == "selinuxDomain")) ||
		p.Status == "AVAILABLE" || *p.Errno < 1 || *p.Errno > 4095) {
		return false
	}
	if p.Status == "AVAILABLE" {
		if p.Value != nil && p.Group == "environment" && p.Key == "capturePlan" && *p.Value == "usb" && fieldSet < 13 {
			return false
		}
		if p.Value != nil && p.Group == "environment" && p.Key == "capturePlan" && *p.Value == "gnss" && fieldSet < 14 {
			return false
		}
		if p.Group == "environment" && p.Key == "capturePlan" && p.Value != nil && *p.Value == "full" && fieldSet < 20 {
			return false
		}
		if p.Value != nil && p.Group == "system" && p.Key == "gnssHardwareYear" && fieldSet >= 14 {
			// A signed SDK int, including zero and semantically unusual values, remains raw evidence.
			n, err := strconv.ParseInt(*p.Value, 10, 32)
			return err == nil && strconv.FormatInt(n, 10) == *p.Value
		}
		return p.Value != nil && strings.TrimSpace(*p.Value) != "" && textValid(*p.Value, 512) &&
			validAcceptanceValue(p.Group, p.Key, *p.Value)
	}
	return p.Value == nil
}

var decoderName = regexp.MustCompile(`^[a-zA-Z0-9._+\-]{1,128}$`)
var decodeDuration = regexp.MustCompile(`^[0-9]{1,9} ms$`)
var kernelMachine = regexp.MustCompile(`^[a-z0-9_+-]{1,32}$`)
var glesVersion = regexp.MustCompile(`^[1-9]\.[0-9]$`)
var compactInt = regexp.MustCompile(`^(0|[1-9][0-9]{0,6})$`)
var verityMode = regexp.MustCompile(`^[a-z0-9_.-]{1,32}$`)

func compactIntRange(value string, min, max int) bool {
	if !compactInt.MatchString(value) {
		return false
	}
	n, err := strconv.Atoi(value)
	return err == nil && n >= min && n <= max
}

func orderedObservation(value string, codes ...string) bool {
	if value == "none" {
		return true
	}
	for _, item := range strings.Split(value, " / ") {
		index := -1
		for i, code := range codes {
			if item == code {
				index = i
				break
			}
		}
		if index < 0 {
			return false
		}
		codes = codes[index+1:]
	}
	return true
}

// Fixed partition order for system.partitionBuildDates. Partitions whose property
// is missing may be skipped, but the surviving names keep this relative order.
var partitionDateOrder = []string{"system", "vendor", "product", "odm", "system_ext", "bootimage"}

var partitionDateSegment = regexp.MustCompile(`^([a-z_]+) ([0-9]{4}-[0-9]{2}-[0-9]{2})$`)

func partitionDatesText(value string) bool {
	rows := strings.Split(value, " · ")
	if len(rows) > len(partitionDateOrder) {
		return false
	}
	seen := -1
	for _, row := range rows {
		parts := partitionDateSegment.FindStringSubmatch(row)
		if parts == nil {
			return false
		}
		index := -1
		for i, name := range partitionDateOrder {
			if name == parts[1] {
				index = i
				break
			}
		}
		// Strictly increasing: fixed order and no repeated partition.
		if index <= seen {
			return false
		}
		seen = index
		if _, err := time.Parse("2006-01-02", parts[2]); err != nil {
			return false
		}
	}
	return true
}

func validAcceptanceValue(group, key, value string) bool {
	switch group + "." + key {
	case "battery.present":
		return oneOf(value, "yes", "no")
	case "battery.cycleCount":
		n, err := strconv.Atoi(value)
		return err == nil && n >= 0 && n <= 99999 && strconv.Itoa(n) == value
	case "cellular.dataSubscriptionService":
		return oneOf(value, "有服务", "无服务", "仅紧急呼叫", "无线电关闭")
	case "cpu.sysCpuPossible", "cpu.sysCpuOnline":
		return validCPUList(value)
	case "battery.sysBatteryTemp":
		n, err := strconv.Atoi(value)
		return err == nil && n >= -500 && n <= 1200 && strconv.Itoa(n) == value
	case "environment.hookSignals":
		return orderedObservation(value, "frida", "gadget", "xposed", "substrate", "riru", "zygisk", "lspatch", "memfd_exec")
	case "environment.tracerPid":
		return compactIntRange(value, 0, 4_194_304)
	case "environment.rootMountHints":
		return orderedObservation(value, "overlay_system", "overlay_vendor", "overlay_product", "tmpfs_sbin", "magisk_path")
	case "environment.rootManagerVisible":
		return orderedObservation(value, "magisk", "kernelsu", "supersu", "superuser", "kingroot")
	case "environment.userProfile":
		return oneOf(value, "owner", "secondary", "managed")
	case "environment.drmSecurityLevel":
		return oneOf(value, "L1", "L2", "L3")
	case "environment.verityMode":
		return verityMode.MatchString(value)
	case "environment.buildDebuggable":
		return oneOf(value, "开启", "关闭")
	case "system.initialSdk":
		return compactIntRange(value, 1, 99)
	case "system.bootCount":
		return compactIntRange(value, 0, 1_000_000)
	case "system.mediaPerformanceClass":
		return compactIntRange(value, 0, 99)
	case "system.partitionBuildDates":
		return partitionDatesText(value)
	case "system.selinuxEvidence":
		return oneOf(value, "exact", "inferred_mac", "inferred_disabled")
	case "cpu.coresConfigured":
		return compactIntRange(value, 1, 1024)
	case "environment.capturePlan":
		return oneOf(value, "full", "standard", "rom", "network", "usb", "gnss")
	case "environment.capturePhoneAccess":
		return oneOf(value, "granted", "not_granted")
	case "environment.captureLocationAccess":
		return oneOf(value, "precise", "approximate", "not_granted")
	case "environment.captureLocationSwitch":
		return oneOf(value, "enabled", "disabled")
	case "media.avcFixture":
		return value == "sigmark-avc/1"
	case "media.avcFirstFrame":
		return oneOf(value, "pass", "fail")
	case "media.avcStage":
		return oneOf(value, "source", "configure", "decode", "done")
	case "media.avcDecoder":
		return decoderName.MatchString(value)
	case "media.avcElapsed":
		return decodeDuration.MatchString(value)
	case "network.checkStartTransport", "network.checkEndTransport":
		return oneOf(value, "wifi", "cellular", "ethernet", "vpn", "none", "other")
	case "network.checkStartValidated", "network.checkEndValidated":
		return oneOf(value, "yes", "no")
	case "network.checkElapsed":
		if !decodeDuration.MatchString(value) {
			return false
		}
		n, err := strconv.Atoi(strings.TrimSuffix(value, " ms"))
		return err == nil && n <= 600_000
	case "cpu.processBitness":
		return oneOf(value, "32", "64")
	case "cpu.kernelMachine":
		return kernelMachine.MatchString(value) && value != "unknown" && value != "null"
	case "system.interfaceCapabilities":
		return orderedObservation(value, "nfc", "gnss", "usb_host", "usb_accessory")
	case "runtime.externalInputTypes":
		return orderedObservation(value, "keyboard", "pointer", "gamepad")
	case "system.gnssHardwareYear":
		return compactIntRange(value, 1980, 2100)
	case "system.gnssCapabilities":
		return orderedObservation(value, "measurements", "navigation_message", "antenna_info")
	case "system.gnssProvider", "system.gnssAntennaSupport":
		return oneOf(value, "yes", "no")
	case "system.gnssModelReported":
		return value == "yes"
	case "system.gnssCheckStatus", "system.gnssCheckMeasurements":
		return oneOf(value, "observed", "not_seen")
	case "system.gnssCheckPrerequisite":
		return oneOf(value, "ready", "permission_required", "location_disabled", "location_unknown", "provider_missing")
	case "system.gnssCheckElapsed":
		return decodeDuration.MatchString(value)
	case "runtime.declaredInput":
		return orderedObservation(value, "touchscreen", "multitouch", "multitouch_distinct", "jazzhand", "gamepad")
	case "sensors.reportingModes":
		parts := strings.Split(value, "/")
		if len(parts) != 5 {
			return false
		}
		for _, v := range parts {
			if !compactIntRange(v, 0, 9999) {
				return false
			}
		}
		return true
	case "sensors.fifoCount":
		return compactIntRange(value, 0, 9999)
	case "sensors.directChannelTypes":
		return orderedObservation(value, "memory_file", "hardware_buffer")
	case "media.cameraModes":
		return orderedObservation(value, "raw", "depth", "logical_multi_camera", "high_speed_video")
	case "runtime.glesProbeResult":
		return oneOf(value, "pass", "fail", "not_completed")
	case "runtime.glesProbeStage":
		return oneOf(value, "done", "display", "config", "context", "surface", "readback", "timeout", "busy", "interrupted", "driver_error")
	case "runtime.glesProbeVersion":
		return glesVersion.MatchString(value)
	case "network.checkStartAt", "network.checkEndAt", "media.avcStartAt", "media.avcEndAt", "runtime.glesStartAt", "runtime.glesEndAt", "runtime.usbStartAt", "runtime.usbEndAt", "system.gnssCheckStartAt", "system.gnssCheckEndAt":
		n, err := strconv.ParseInt(value, 10, 64)
		return err == nil && strconv.FormatInt(n, 10) == value && n >= 946684800000 && n < 4102444800000
	case "runtime.usbStartCount", "runtime.usbEndCount":
		return compactIntRange(value, 0, 1024)
	case "runtime.usbOutcome":
		return oneOf(value, "increase", "decrease", "no_change", "incomplete")
	case "runtime.usbElapsed":
		if !decodeDuration.MatchString(value) {
			return false
		}
		n, err := strconv.Atoi(strings.TrimSuffix(value, " ms"))
		return err == nil && n <= 120000
	case "system.boardPlatform", "system.bootHardware":
		return platformCode.MatchString(value)
	case "system.hardwareSku":
		return skuCode.MatchString(value)
	}
	return true
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
	platformCode   = regexp.MustCompile(`^[a-z0-9_.-]{1,32}$`)
	skuCode        = regexp.MustCompile(`^[A-Za-z0-9._-]{1,32}$`)
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
	maxFields := 192
	if p.FieldSetVersion >= 12 {
		maxFields = 208 // Covers the static allowlist plus up to 24 partition rows.
	}
	if p.FieldSetVersion >= 13 {
		maxFields = 224
	}
	if p.FieldSetVersion >= 15 {
		maxFields = 228 // 204 fixed keys and up to 24 dynamic partition rows.
	}
	if p.FieldSetVersion >= 16 {
		maxFields = 231
	}
	if p.FieldSetVersion >= 17 {
		maxFields = 242 // 218 fixed keys and up to 24 dynamic partition rows.
	}
	if p.FieldSetVersion >= 18 {
		maxFields = 243 // 219 fixed keys and up to 24 dynamic partition rows.
	}
	if p.FieldSetVersion >= 19 {
		maxFields = 246 // 222 fixed keys and up to 24 dynamic partition rows.
	}
	if p.FieldSetVersion >= 20 {
		maxFields = 248 // 224 fixed keys and up to 24 dynamic partition rows.
	}
	if (p.SchemaVersion < 1 || p.SchemaVersion > 4) || !requestPattern.MatchString(p.RequestID) || p.AndroidAPI < 0 || p.AndroidAPI > 999 ||
		!modelPattern.MatchString(p.Model) || !versionPattern.MatchString(p.AppVersion) ||
		p.CapturedAt < 946684800000 || p.CapturedAt >= 4102444800000 ||
		!oneOf(p.Network, "wifi", "cellular", "ethernet", "vpn", "none", "other", "unknown") ||
		!oneOf(p.WifiBand, "2.4", "4.9", "5", "6", "60", "unknown") ||
		!oneOf(p.Radio, "lte", "nr", "iwlan", "other", "unknown") ||
		!textValid(p.Feedback, 300) || len(p.Metrics) == 0 || len(p.Metrics) > 6 ||
		(p.SchemaVersion == 1 && len(p.Parameters) != 0) ||
		(p.SchemaVersion == 2 && (len(p.Parameters) == 0 || len(p.Parameters) > 96)) ||
		(p.SchemaVersion >= 3 && (len(p.Parameters) == 0 || len(p.Parameters) > maxFields || (p.FieldSetVersion < 7 && len(p.Parameters) > 160))) ||
		(p.SchemaVersion < 3 && p.Coverage != nil) ||
		(p.SchemaVersion < 4 && (p.CollectorVersion != "" || p.FieldSetVersion != 0)) ||
		(p.SchemaVersion == 4 && (!versionPattern.MatchString(p.CollectorVersion) || p.FieldSetVersion < 2 || p.FieldSetVersion > latestFieldSet)) {
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
	partitions := 0
	for _, field := range p.Parameters {
		if field.Group == "system" && partitionField.MatchString(field.Key) {
			partitions++
			if partitions > 24 {
				return false
			}
		}
		key := field.Group + "/" + field.Key
		if seen[key] || !field.valid(p.SchemaVersion, p.FieldSetVersion) {
			return false
		}
		seen[key] = true
	}
	return (p.FieldSetVersion < 13 || validTimedExperiment(p.Parameters)) && (p.SchemaVersion < 3 || validCoverage(p.Coverage, p.Parameters))
}

func matchesExperimentPlan(actual, required string) bool {
	return actual == required || (actual == "full" && required == "rom")
}

func validTimedExperiment(fields []Parameter) bool {
	archive := map[string]Parameter{}
	for _, f := range fields {
		archive[f.Group+"."+f.Key] = f
	}
	val := func(k string) string {
		p := archive[k]
		if p.Status == "AVAILABLE" && p.Value != nil {
			return *p.Value
		}
		return ""
	}
	plan := val("environment.capturePlan")
	for _, key := range []string{"gnssCheckPrerequisite", "gnssCheckStatus", "gnssCheckMeasurements", "gnssCheckStartAt", "gnssCheckEndAt", "gnssCheckElapsed"} {
		if _, found := archive["system."+key]; found != (plan == "gnss") {
			return false
		}
	}
	if plan == "gnss" {
		pre := val("system.gnssCheckPrerequisite")
		if pre == "" || (pre != "ready" && (val("system.gnssCheckStatus") != "" || val("system.gnssCheckMeasurements") != "")) ||
			val("system.gnssCheckElapsed") == "" {
			return false
		}
	}
	for _, v := range []struct{ key, plan string }{
		{"network.checkStartAt", "network"}, {"network.checkEndAt", "network"}, {"media.avcStartAt", "rom"}, {"media.avcEndAt", "rom"},
		{"runtime.glesStartAt", "rom"}, {"runtime.glesEndAt", "rom"},
	} {
		if _, found := archive[v.key]; found && !matchesExperimentPlan(plan, v.plan) {
			return false
		}
	}
	for _, key := range []string{"usbStartAt", "usbEndAt", "usbStartCount", "usbEndCount", "usbOutcome", "usbElapsed"} {
		if _, found := archive["runtime."+key]; found != (plan == "usb") {
			return false
		}
	}
	if plan != "usb" {
		return true
	}
	want := "incomplete"
	left, right := val("runtime.usbStartCount"), val("runtime.usbEndCount")
	if left != "" && right != "" && val("runtime.usbElapsed") != "" {
		a, _ := strconv.Atoi(left)
		b, _ := strconv.Atoi(right)
		switch {
		case b > a:
			want = "increase"
		case b < a:
			want = "decrease"
		default:
			want = "no_change"
		}
	}
	return val("runtime.usbOutcome") == want
}

package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

const dossierRules = "sigmark-dossier/6"

// Receipt order is intentionally not used as capture order: offline uploads may
// arrive late. Select one exact, explicitly linked asset, never a same-model row.
const latestAssetCaptureSQL = `SELECT r.id,r.batch,r.received_at,r.body,
 (SELECT g.id::text FROM reports g WHERE g.asset_id=$1 AND g.trashed_at IS NULL
 AND g.body @> '{"parameters":[{"group":"environment","key":"capturePlan","status":"AVAILABLE","value":"gnss"}]}'::jsonb
 ORDER BY NULLIF((g.body->>'capturedAtEpochMs')::bigint,0) DESC NULLS LAST, g.received_at DESC, g.id DESC LIMIT 1) AS latest_gnss_id,
 prior.id::text,prior.body
 FROM reports r
 LEFT JOIN LATERAL (
  SELECT p.id,p.body FROM reports p WHERE p.asset_id=r.asset_id AND p.trashed_at IS NULL
  AND (p.body->>'capturedAtEpochMs')::bigint > 0
  AND (p.body->>'capturedAtEpochMs')::bigint < (r.body->>'capturedAtEpochMs')::bigint
  ORDER BY (p.body->>'capturedAtEpochMs')::bigint DESC,p.received_at DESC,p.id DESC LIMIT 1
 ) prior ON true
 WHERE r.asset_id=$1 AND r.trashed_at IS NULL
 ORDER BY NULLIF((r.body->>'capturedAtEpochMs')::bigint,0) DESC NULLS LAST, r.received_at DESC, r.id DESC LIMIT 1`

var dossierGroups = [...]string{"system", "cpu", "memory", "display", "battery", "sensors", "network", "cellular", "runtime", "media", "environment", "app"}

// A small reproducible checklist, not the ingestion allowlist. Optional,
// vendor-specific, and dynamic partition/technology branches aren't assumed
// to produce rows. Keep requirements aligned with the Android collectors.
type dossierRule struct {
	key, label string
	minAPI     int
	plan       string
	fine       bool
}

var dossierChecklist = [...]dossierRule{
	{key: "system.release", label: "Android 版本"},
	{key: "system.buildId", label: "构建号"},
	{key: "system.interfaceCapabilities", label: "设备接口声明"},
	{key: "system.gnssHardwareYear", label: "GNSS 硬件与软件型号年", minAPI: 28},
	{key: "system.gnssCapabilities", label: "GNSS 高级能力", minAPI: 31},
	{key: "system.gnssAntennaSupport", label: "GNSS 天线信息声明", minAPI: 30},
	{key: "system.gnssProvider", label: "GPS 提供器"},
	{key: "system.gnssModelReported", label: "GNSS 型号名称上报情况", minAPI: 28},
	{key: "system.gnssCheckStatus", label: "GNSS 状态回调", plan: "gnss", fine: true},
	{key: "system.gnssCheckMeasurements", label: "GNSS 测量回调", plan: "gnss", fine: true},
	{key: "system.selinux", label: "SELinux 实时模式"},
	{key: "system.partitionCount", label: "公开分区构建数", minAPI: 29},
	{key: "system.webViewProvider", label: "WebView 提供程序", minAPI: 26},
	{key: "cpu.kernel", label: "内核版本"},
	{key: "cpu.abis", label: "支持的 ABI"},
	{key: "cpu.processBitness", label: "印迹进程位宽"},
	{key: "cpu.kernelMachine", label: "内核报告的架构"},
	{key: "cpu.pageSize", label: "内存页大小"},
	{key: "memory.totalRam", label: "总内存"},
	{key: "memory.availableRam", label: "可用内存"},
	{key: "memory.internalTotal", label: "内部存储总量"},
	{key: "display.resolution", label: "显示分辨率"},
	{key: "display.refresh", label: "当前刷新率"},
	{key: "battery.level", label: "当前电量"},
	{key: "battery.energyCounter", label: "剩余能量"},
	{key: "sensors.count", label: "传感器数量"},
	{key: "sensors.typeWakeupSummary", label: "传感器类型与唤醒能力"},
	{key: "sensors.reportingModes", label: "传感器上报模式分布"},
	{key: "sensors.fifoCount", label: "支持 FIFO 批处理的传感器数"},
	{key: "sensors.directChannelTypes", label: "传感器直通通道类型"},
	{key: "network.transport", label: "默认链路"},
	{key: "network.visibleTransports", label: "应用可见网络"},
	{key: "network.checkStartTransport", label: "切换实验起点链路", plan: "network"},
	{key: "network.checkEndTransport", label: "切换实验终点链路", plan: "network"},
	{key: "cellular.cellDiagnostics", label: "小区注册与制式", fine: true},
	{key: "cellular.cellLTEBandwidth", label: "LTE 信道带宽", minAPI: 28, fine: true},
	{key: "runtime.openGlEs", label: "声明的 OpenGL ES"},
	{key: "runtime.externalInputTypes", label: "外接输入设备类型", minAPI: 29},
	{key: "runtime.declaredInput", label: "系统声明的输入能力"},
	{key: "runtime.glesProbeResult", label: "图形回读实测结果", plan: "rom"},
	{key: "runtime.glesProbeVersion", label: "实测上下文 GLES 版本", plan: "rom"},
	{key: "runtime.glesProbeStage", label: "图形实测阶段", plan: "rom"},
	{key: "runtime.usbStartCount", label: "USB 起点设备数", plan: "usb"},
	{key: "runtime.usbEndCount", label: "USB 终点设备数", plan: "usb"},
	{key: "runtime.usbOutcome", label: "USB 主机枚举结果", plan: "usb"},
	{key: "runtime.vulkanVersion", label: "声明的 Vulkan 版本"},
	{key: "media.cameraCapabilitySummary", label: "相机能力"},
	{key: "media.cameraModes", label: "Camera2 高级能力"},
	{key: "media.avcFirstFrame", label: "AVC 首帧实测", plan: "rom"},
	{key: "environment.capturePlan", label: "采样方案"},
	{key: "environment.keyguardSecure", label: "锁屏凭证配置"},
	{key: "environment.storageEncryption", label: "存储加密状态"},
	{key: "app.version", label: "SigMark 版本"},
	{key: "app.certSha256", label: "应用签名摘要"},
}

type dossierCounts struct {
	Available   int `json:"available"`
	Restricted  int `json:"restricted"`
	Unavailable int `json:"unavailable"`
	Errors      int `json:"errors"`
}

func (c *dossierCounts) count(status string) {
	switch status {
	case "AVAILABLE":
		c.Available++
	case "RESTRICTED":
		c.Restricted++
	case "UNAVAILABLE":
		c.Unavailable++
	case "ERROR":
		c.Errors++
	}
}

type dossierField struct {
	Parameter
	Kind string `json:"kind"`
	Unit string `json:"unit,omitempty"`
}

type dossierGap struct {
	Group         string  `json:"group"`
	Key           string  `json:"key"`
	Label         string  `json:"label"`
	Code          string  `json:"code"`
	Kind          string  `json:"kind"`
	MinSchema     int     `json:"minSchemaVersion"`
	SinceFieldSet int     `json:"sinceFieldSet,omitempty"`
	MinAPI        int     `json:"minApi,omitempty"`
	RequiredPlan  string  `json:"requiredPlan,omitempty"`
	StatusOnly    *Metric `json:"legacyStatusOnly,omitempty"`
}

type dossierCategory struct {
	Group          string         `json:"group"`
	Counts         dossierCounts  `json:"counts"`
	ChecklistSaved int            `json:"checklistSaved"`
	ChecklistScope int            `json:"checklistScope"`
	Fields         []dossierField `json:"fields"`
	Gaps           []dossierGap   `json:"gaps"`
}

type dossierContext struct {
	CapturePlan string `json:"capturePlan,omitempty"`
	PhoneAccess string `json:"phoneAccess,omitempty"`
	Location    string `json:"locationAccess,omitempty"`
	Switch      string `json:"locationSwitch,omitempty"`
}

type assetDossier struct {
	SchemaVersion    int               `json:"schemaVersion"`
	RuleVersion      string            `json:"ruleVersion"`
	AssetID          string            `json:"assetId"`
	LatestGNSSReport *string           `json:"latestGnssReportId,omitempty"`
	ReportID         string            `json:"reportId"`
	Batch            string            `json:"batch"`
	Received         time.Time         `json:"receivedAt"`
	CapturedAt       int64             `json:"capturedAtEpochMs"`
	ReportSchema     int               `json:"reportSchemaVersion"`
	FieldSet         int               `json:"fieldSetVersion,omitempty"`
	AppVersion       string            `json:"appVersion"`
	CollectorVersion string            `json:"collectorVersion,omitempty"`
	AndroidAPI       int               `json:"androidApi"`
	Android          string            `json:"android,omitempty"`
	BuildID          string            `json:"buildId,omitempty"`
	ROMHint          string            `json:"romHint,omitempty"`
	Context          dossierContext    `json:"context"`
	Categories       []dossierCategory `json:"categories"`
	Configuration    configurationCode `json:"configurationCode"`
}

func dossierFieldKind(group, key string) string {
	if group == "system" && strings.HasPrefix(key, "gnssCheck") {
		return "snapshot"
	}
	switch group {
	case "network", "cellular", "battery":
		return "snapshot"
	}
	if (group == "runtime" && (strings.HasPrefix(key, "usb") || strings.HasPrefix(key, "gles"))) ||
		(group == "media" && strings.HasPrefix(key, "avc")) {
		return "snapshot"
	}
	switch group + "." + key {
	case "system.uptime", "memory.availableRam", "memory.ramUseEstimate", "memory.lowMemory", "memory.internalAvailable",
		"cpu.sysCpuOnline",
		"memory.sharedState", "memory.volumeSummary", "memory.systemSpace", "memory.appCacheSpace",
		"display.refresh", "display.visibleDisplays", "display.windowSize", "display.systemBarInsets", "display.cutoutInsets",
		"runtime.heapAllocated", "runtime.heapFree", "runtime.standbyBucket", "runtime.backgroundRestricted", "runtime.externalInputTypes",
		"runtime.glesProbeResult", "runtime.glesProbeVersion", "runtime.glesProbeStage",
		"media.avcFixture", "media.avcFirstFrame", "media.avcStage", "media.avcDecoder", "media.avcElapsed",
		"environment.keyProtection", "environment.capturePlan", "environment.capturePhoneAccess", "environment.captureLocationAccess",
		"environment.captureLocationSwitch", "app.debuggerConnected",
		"environment.hookSignals", "environment.tracerPid", "environment.rootMountHints", "environment.rootManagerVisible",
		"environment.userProfile", "system.selinuxEvidence":
		return "snapshot"
	}
	return "configuration"
}

func dossierGapCode(p Report, field dictionaryField, rule dossierRule, access dossierContext, noCellular bool) string {
	switch {
	case p.SchemaVersion < field.MinSchema || p.FieldSetVersion < field.SinceFieldSet:
		return "OLDER_FIELD_SET"
	case rule.minAPI > 0 && p.AndroidAPI == 0:
		return "API_UNKNOWN"
	case rule.minAPI > p.AndroidAPI:
		return "API_BELOW_MINIMUM"
	case rule.plan != "" && access.CapturePlan == "":
		return "PLAN_UNKNOWN"
	case rule.plan != "" && !matchesExperimentPlan(access.CapturePlan, rule.plan):
		return "OTHER_CAPTURE_PLAN"
	case rule.fine && noCellular:
		return "CELLULAR_NOT_OBSERVED"
	case rule.fine && oneOf(access.Location, "approximate", "not_granted"):
		return "PRECISE_LOCATION_NOT_GRANTED"
	case rule.fine && access.Switch == "disabled":
		return "LOCATION_SWITCH_OFF"
	case rule.fine && (access.Location != "precise" || access.Switch != "enabled"):
		return "ACCESS_UNKNOWN"
	default:
		return "NOT_RECORDED"
	}
}

func buildDossier(asset string, sample storedReport) assetDossier {
	p := sample.Report
	fields := make(map[string]Parameter, len(p.Parameters))
	for _, f := range p.Parameters {
		fields[f.Group+"."+f.Key] = f
	}
	get := func(key string) string {
		f := fields[key]
		if f.Status == "AVAILABLE" && f.Value != nil {
			return *f.Value
		}
		return ""
	}
	access := dossierContext{get("environment.capturePlan"), get("environment.capturePhoneAccess"),
		get("environment.captureLocationAccess"), get("environment.captureLocationSwitch")}
	// The Android collector emits this explicit capability row only on its
	// early-return branch, rather than emitting it on every device.
	noCellular := get("cellular.support") == "设备未声明蜂窝能力" &&
		fields["cellular.support"].Source == "PackageManager.FEATURE_TELEPHONY"
	d := assetDossier{
		SchemaVersion: 1, RuleVersion: dossierRules, AssetID: asset, ReportID: sample.ID, Batch: sample.Batch,
		Received: sample.Received, CapturedAt: p.CapturedAt, ReportSchema: p.SchemaVersion, FieldSet: p.FieldSetVersion,
		AppVersion: p.AppVersion, CollectorVersion: p.CollectorVersion, AndroidAPI: p.AndroidAPI,
		Android: get("system.release"), BuildID: get("system.buildId"), ROMHint: get("system.romHint"), Context: access,
	}
	dict := map[string]dictionaryField{}
	for _, entry := range dictionary() {
		dict[entry.Key] = entry
	}
	metrics := map[string]*Metric{}
	for i := range p.Metrics {
		metrics[p.Metrics[i].Key] = &p.Metrics[i]
	}
	for _, group := range dossierGroups {
		c := dossierCategory{Group: group, Fields: []dossierField{}, Gaps: []dossierGap{}}
		for _, f := range p.Parameters {
			if f.Group == group {
				c.Counts.count(f.Status)
				unit := fieldUnits[group+"."+f.Key]
				if sys, ok := sysfsFields[group+"."+f.Key]; ok {
					unit = sys.unit
				}
				c.Fields = append(c.Fields, dossierField{f, dossierFieldKind(group, f.Key), unit})
			}
		}
		for _, rule := range dossierChecklist {
			g, k, _ := strings.Cut(rule.key, ".")
			if g != group {
				continue
			}
			if _, saved := fields[rule.key]; saved {
				// An explicit attempt in the archive is evidence even with a nil value.
				c.ChecklistSaved++
				c.ChecklistScope++
				continue
			}
			meta := dict[rule.key]
			code := dossierGapCode(p, meta, rule, access, noCellular)
			if code == "NOT_RECORDED" {
				c.ChecklistScope++
			}
			c.Gaps = append(c.Gaps, dossierGap{group, k, rule.label, code, dossierFieldKind(group, k),
				meta.MinSchema, meta.SinceFieldSet, rule.minAPI, rule.plan, metrics[rule.key]})
		}
		d.Categories = append(d.Categories, c)
	}
	return d
}

func (s server) deviceDossier(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !requestPattern.MatchString(id) {
		fail(w, http.StatusBadRequest, "invalid_asset_id")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var sample storedReport
	var gnssReport *string
	var previousID *string
	var previousBody []byte
	err := s.db.QueryRow(ctx, latestAssetCaptureSQL, id).Scan(&sample.ID, &sample.Batch, &sample.Received, &sample.Report, &gnssReport, &previousID, &previousBody)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusNotFound, "device_capture_not_found")
		return
	}
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "storage_unavailable")
		return
	}
	out := buildDossier(id, sample)
	out.LatestGNSSReport = gnssReport
	var previous *storedReport
	if previousID != nil {
		previous = &storedReport{ID: *previousID}
		if err := json.Unmarshal(previousBody, &previous.Report); err != nil {
			fail(w, http.StatusServiceUnavailable, "storage_unavailable")
			return
		}
	}
	out.Configuration = archivedCode(sample.Report, previous)
	send(w, http.StatusOK, out)
}

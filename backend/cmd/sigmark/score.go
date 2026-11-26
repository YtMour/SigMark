package main

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Device security score, rule version sigmark-score/1.
//
// This file is a projection, not a second verdict engine. Every number below is
// derived from a profileLabel that profileSignals() already produced (plus the two
// usage fields, which no label covers yet); nothing re-reads a raw parameter to
// re-decide whether a device is modified. That keeps one source of truth: if
// hardware_facts.go changes its mind, the score follows automatically.
//
// The nine rules (R1..R9) are implemented one by one and each has its own test in
// score_test.go.
//
// Version history — the rule is "a change that moves a device's band bumps this".
//
//	/1  initial projection: three axes, R1..R11, decisive caps.
//	/2  U2 lands: `system.initialSdk` now participates in FRESH_BOOT_ON_AGED_ROM, and the
//	    usage axis becomes decidable on an aged *device* even when its *image* is current.
//	    This is a genuine verdict change, not a shape change: a device with bootCount ≤ 2,
//	    an unreadable partition date and a 2017-era SDK moves from `?`/not-decidable to a
//	    real deduction. Bumping the version is what tells a stale frontend to stop
//	    colouring with older thresholds (see web/src/score-view.ts scoreVersion).
//	/3  one-sided identity becomes evidence: an `identity_conflict` label is now `hit` when
//	    both sides of a pair were read successfully and only one produced a value, where
//	    before that pair was skipped and the label fell to `insufficient`. Verdict change,
//	    not a shape change: measured on a clean baseline, a confirmed 90/D disguise used to
//	    wash back to 100/A by blanking one property, and now stays 90/D. Bumped together with
//	    profileVersion (/8 → /9) because the label's state mapping is what moved.
//	/4  structural virtual evidence: VIRTUAL_BUILD_MARKERS asks whether cpu.hardware /
//	    system.product / system.device look like an emulator, and those three strings are
//	    chosen by the device under examination — so an emulator that ships plausible values
//	    answers "no" and the 35-point decisive rule never fires. Measured on LDPlayer 9:
//	    qcom / RMX5010 / unicorn, band `?`. Two channels that are not name matches now run
//	    alongside it: cpu.cpuInfo naming a desktop part (a /proc read the emulator passes
//	    through from its host) and system.boardPlatform being a generic build string rather
//	    than a SoC codename (a build artifact). Same 35 points, same decisive cap, and
//	    mutually exclusive with the marker rule so one cause is never charged twice.
//	    Verdict change, not a shape change: the same archived report moves `?` → D.
//	    profileVersion stays /9 — the label layer did not move, the score layer reads the
//	    new evidence straight from parameters.
//	/5  two fixes found by replaying the LDPlayer 9 capture that /4 was built for:
//	    (a) a decisive hit no longer withholds `value`. The declaration-blind withhold (R10)
//	    fired on that report — declaration coverage 0.33, no deduction — and dropped the
//	    number even though `band` was already D and overall coverage was 0.73. R10 exists to
//	    stop an unlooked-at 40%-weight axis from publishing a comfortable A; once a decisive
//	    cap has fixed the band at D there is no comfort left to protect, and the number is
//	    the only remaining sort key (§13 F5 says exactly that). So the withhold now applies
//	    only when nothing else has decided the band.
//	    (b) FRESH_BOOT_ON_AGED_ROM is no longer charged on a device already identified as
//	    virtual. LDPlayer reports initialSdk 28 against an android-14 image and bootCount 2,
//	    so U2 priced it 12 points — but "the image's first_api_level disagrees with the
//	    system image" is what an emulator *is*, not a disguise. The same fact is already
//	    charged 35 points decisively on the behaviour axis, and one cause must not be
//	    charged twice. The suppression is one-way: on real hardware the rule is untouched.
//	    Both are verdict changes for archived emulator reports (the LDPlayer capture moves
//	    from `value: null` to 71, and its usage axis from 88 to 100), so the version moves.
const scoreVersion = "sigmark-score/5"

const (
	axisDeclaration = "declaration"
	axisBehavior    = "behavior"
	axisUsage       = "usage"
)

const (
	bandA       = "A"
	bandB       = "B"
	bandC       = "C"
	bandD       = "D"
	bandUnknown = "?"
)

var scoreBandLabels = map[string]string{
	bandA:       "一致",
	bandB:       "有疑点",
	bandC:       "可疑",
	bandD:       "高度可疑",
	bandUnknown: "未知",
}

// R9: value only orders reports, band is the conclusion. The lower bound of each
// band is inclusive and the list is ordered from best to worst.
var scoreBandThresholds = []struct {
	Band string
	Min  int
}{
	{bandA, 85},
	{bandB, 70},
	{bandC, 50},
	{bandD, 0},
}

// Axis weights are a wire contract: the frontend renders them as-is. This table is
// the single source of truth for the three axis codes, labels and weights.
var scoreAxisOrder = []struct {
	Code   string
	Label  string
	Weight int
}{
	{axisDeclaration, "声明一致性", 40},
	{axisBehavior, "行为风险", 35},
	{axisUsage, "使用真实性", 25},
}

// newScoreAxis builds an axis from the wire table so a weight can never drift
// between the declaration and the scoring code.
func newScoreAxis(code string) scoreAxis {
	for _, spec := range scoreAxisOrder {
		if spec.Code == code {
			return scoreAxis{Code: spec.Code, Label: spec.Label, Weight: spec.Weight,
				Deductions: []scoreDeduction{}}
		}
	}
	return scoreAxis{Code: code, Deductions: []scoreDeduction{}}
}

// Axis-internal weight tables. A label may appear in exactly one table; the
// virtual_build_markers exception is handled explicitly in declarationAxis().
// behaviorScoreTable is the priced part of the behavior axis: six labels, each with a
// nominal point value on the axis's own 0–100 scale.
//
// Two of the ten profile labels are deliberately NOT here — see
// behaviorDisplayOnlyLabels. They stay in the profile (the console shows them) but they
// are not priced and they do not enter this axis's coverage denominator, because a
// coverage number that counts channels nobody scores is measuring the wrong thing.
var behaviorScoreTable = []struct {
	Label    string
	Code     string
	Points   int
	Decisive bool
	Detail   string
}{
	{"hook_injection", "HOOK_INJECTION", 25, false, "hook 或非原生挂载痕迹不是 none"},
	{"debugger_attached", "DEBUGGER_ATTACHED", 20, false, "调试器已连接（直连标志或 TracerPid）"},
	{"selinux_permissive", "SELINUX_PERMISSIVE", 15, false, "SELinux 处于宽容模式"},
	{"root_manager_visible", "ROOT_MANAGER_VISIBLE", 12, false, "可见 root 管理器包"},
	{"multi_open", "MULTI_OPEN", 8, false, "运行在分身／工作资料中"},
	{"virtual_build_markers", "VIRTUAL_BUILD_MARKERS", 35, true, "构建标记指向模拟器或虚拟设备"},
}

// structuralVirtualPoints prices a *self-contradiction*, not a name match.
//
// It exists because VIRTUAL_BUILD_MARKERS is answered by the device itself: it reads
// cpu.hardware / system.product / system.device, three strings an emulator chooses. LDPlayer
// 9 reports qcom / RMX5010 / unicorn and the 35-point decisive rule never fires — measured,
// report ce1bdc7f-f128-4e8b-a225-bbeb2bee7c35, verdict `?`.
//
// The channels behind this constant are different in kind: cpu.cpuInfo is a /proc read the
// emulator passes through from its host, and system.boardPlatform asks whether the platform
// string is a plausible SoC codename at all. Only the first is expensive to fake.
//
// CORRECTION, measured on LDPlayer 9 over adb: system.boardPlatform is read from the
// property ro.board.platform, so it costs one `setprop` — the same price as the three keys
// the blocklist already reads. An earlier version of this comment called it a build
// artifact and implied both channels had to be rewritten by different mechanisms. That was
// wrong. What actually holds is:
//
//	channel 1 (cpuInfo):        /proc/cpuinfo, -r--r--r--, shell writes are denied
//	channel 2 (boardPlatform):  ro.board.platform, one setprop clears it
//
// So the rule's real strength is one hard channel plus one soft one, not two hard ones. Set
// ro.board.platform to a real codename and channel 2 goes blind; the 35 points then rest
// entirely on channel 1. TestRedteamFakingPlatformAloneIsCheap and
// TestRedteamCpuInfoSurvivesPlatformRewrite pin that boundary.
//
// Same 35 points and decisive as the blocklist rule, and the two are mutually exclusive in
// scoring: see structuralVirtualDeduction, which stays silent when the marker rule already
// hit, so one device is never charged twice for one cause (R2).
const structuralVirtualPoints = 35

// behaviorDisplayOnlyLabels are the profile labels this axis reports but does not price.
// Naming them is the whole point: an omission that is written down can be reviewed, and
// TestScoreBehaviorAccountsForEveryLabel fails if a new label is added to the profile and
// silently dropped here — which is exactly what happened to these two.
//
// Why not price them:
//   - software_drm: a Widevine L3 tier is a playback capability, not a disguise signal.
//     The clean MI 8 anchor reports L3; pricing it would turn a stock device into a
//     "有疑点" one, i.e. a false positive on the negative control.
//   - rom_verification: verity off / debuggable is a real state, but on its own it says
//     the bootloader is unlocked, which is a normal choice rather than evidence of a
//     misdescribed device. Worth showing, not worth a band.
//
// The cost of this choice is documented in docs/SECURITY-SCORE.md §2.3 and §5.2: the
// behavior axis has six priced labels, not eight, and its coverage is 6-based.
var behaviorDisplayOnlyLabels = []string{"rom_verification", "software_drm"}

const (
	declarationHardwarePoints = 30
	declarationIdentityPoints = 25
	// declarationIdentitySkuPoints prices the SKU-only identity branch. It is smaller
	// than the app-uid branch on purpose: a SKU split is documented real behaviour on
	// some devices, so it is a finding worth recording but not proof of a disguise.
	declarationIdentitySkuPoints = 15
	declarationOverlayPoints     = 15
	usageFreshBootPoints         = 12
)

// usageAgedRomYears is the "old ROM" window from the rule text: a partition built at
// least three years before the report was captured, on a device that has booted at most
// twice, is a contradiction. It is a window rather than a fixed year on purpose — a
// hardcoded 2021 silently stops firing as time passes and starts firing on devices that
// were merely sampled early.
const usageAgedRomYears = 3

// usageAgedRomFallbackYear is used only when the report carries no usable capture time.
// It matches the original fixture set so archived reports keep their historical verdicts
// instead of silently flipping when the window became relative.
const usageAgedRomFallbackYear = 2021

const usageFreshBootCeiling = 2

// usageSdkYears maps the API level a device *shipped* with to the year that API level
// was current. This is U2's whole input, and it is a table rather than `2017 + (sdk-26)`
// on purpose: the arithmetic form drifts one year off around every release cadence change
// and silently mislabels a whole generation.
//
// Why this signal is worth having at all, given U1 already reads partition dates:
// `partitionBuildDates` describes the *image*, and an attacker who flashes a current ROM
// makes it current. `initialSdk` describes the *device generation*: it reports the API level
// the hardware shipped with, so a 2017 phone running a 2024 image still reports sdk 27.
// U1 is spoofed by flashing; U2 requires additionally changing a property.
//
// Do not overstate this. An earlier version of this comment claimed U2 "is not spoofable
// without lying about the hardware itself, which the declaration axis already prices". That
// was wrong on both counts, and a red-team review caught it: `initialSdk` is read from
// `ro.product.first_api_level` (SecurityObservations.kt), which `resetprop` rewrites as
// easily as any other property, and `hardwareKeys` in hardware_facts.go does not include it,
// so the declaration axis never cross-checks it. U2 raises the cost of a disguise by one
// step; it does not make the disguise impossible, and nothing else in the pipeline would
// notice a lie here.
//
// The years are the calendar year each API level was released as stable. Only levels this
// field set can actually observe are listed; an unlisted level means "unknown generation",
// which is deliberately not the same as "new".
var usageSdkYears = map[int]int{
	26: 2017, 27: 2017, 28: 2018, 29: 2019, 30: 2020,
	31: 2021, 32: 2021, 33: 2022, 34: 2023, 35: 2024,
}

// usageSdkYear resolves an `system.initialSdk` reading to a release year.
func usageSdkYear(raw string) (int, bool) {
	sdk, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0, false
	}
	year, ok := usageSdkYears[sdk]
	return year, ok
}

// R8: below this overall coverage no number is published.
const scoreCoverageFloor = 0.5

type scoreDeduction struct {
	Code   string   `json:"code"`
	Label  string   `json:"label"`
	Axis   string   `json:"axis"`
	Points int      `json:"points"`
	Keys   []string `json:"keys"`
	Detail string   `json:"detail"`
}

type scoreAxis struct {
	Code   string `json:"code"`
	Label  string `json:"label"`
	Weight int    `json:"weight"`
	// Score is a pointer because an unscored report must emit JSON null here, never
	// a comfortable 100. Coverage stays a plain number: how much was readable is
	// orthogonal to whether a score is published.
	Score      *int             `json:"score"`
	Coverage   float64          `json:"coverage"`
	Deductions []scoreDeduction `json:"deductions"`
	// computed is the axis arithmetic before the publication gate. It never reaches
	// the wire; it exists so a test can check the math of an axis that a thin report
	// did not publish.
	computed int
}

type scoreCap struct {
	Code   string `json:"code"`
	Band   string `json:"band"`
	Reason string `json:"reason"`
}

type scoreUndetermined struct {
	Axis   string   `json:"axis"`
	Keys   []string `json:"keys"`
	Reason string   `json:"reason"`
}

type deviceScore struct {
	Version       string              `json:"version"`
	Value         *int                `json:"value"`
	Band          string              `json:"band"`
	BandLabel     string              `json:"bandLabel"`
	Coverage      float64             `json:"coverage"`
	CoverageLabel string              `json:"coverageLabel"`
	Decisive      bool                `json:"decisive"`
	Axes          []scoreAxis         `json:"axes"`
	Caps          []scoreCap          `json:"caps"`
	Undetermined  []scoreUndetermined `json:"undetermined"`
}

// orderScoreAxes makes each axis's deduction ledger deterministic and readable:
// heaviest first (so the biggest reason is the first thing read), then by code so equal
// weights never depend on map order. Deductions are never truncated — a ledger that
// silently drops entries is worse than a long one, because the reader cannot tell it
// happened.
func orderScoreAxes(axes []scoreAxis) {
	for i := range axes {
		sort.SliceStable(axes[i].Deductions, func(a, b int) bool {
			left, right := axes[i].Deductions[a], axes[i].Deductions[b]
			if left.Points != right.Points {
				return left.Points > right.Points
			}
			return left.Code < right.Code
		})
	}
}

// orderScoreUndetermined groups the gaps by axis, then by reason, then by key, so the
// same report always lists the same gaps in the same order. Keys are also sorted and
// de-duplicated inside each gap: a key that two channels failed to read is one gap.
func orderScoreUndetermined(gaps []scoreUndetermined) {
	axisRank := map[string]int{axisDeclaration: 0, axisBehavior: 1, axisUsage: 2}
	for i := range gaps {
		sort.Strings(gaps[i].Keys)
		gaps[i].Keys = dedupeStrings(gaps[i].Keys)
	}
	sort.SliceStable(gaps, func(a, b int) bool {
		left, right := gaps[a], gaps[b]
		if axisRank[left.Axis] != axisRank[right.Axis] {
			return axisRank[left.Axis] < axisRank[right.Axis]
		}
		if left.Reason != right.Reason {
			return left.Reason < right.Reason
		}
		return strings.Join(left.Keys, ",") < strings.Join(right.Keys, ",")
	})
}

func dedupeStrings(values []string) []string {
	if len(values) < 2 {
		return values
	}
	out := values[:1]
	for _, value := range values[1:] {
		if value != out[len(out)-1] {
			out = append(out, value)
		}
	}
	return out
}

// buildDeviceScore projects the already-computed labels plus the usage fields into
// the three axes. parameters are only read for system.bootCount /
// system.partitionBuildDates / system.initialSdk; every other number comes from
// labels.
func buildDeviceScore(parameters []Parameter, labels []profileLabel, capturedAt int64) deviceScore {
	out := deviceScore{
		Version:      scoreVersion,
		Axes:         []scoreAxis{},
		Caps:         []scoreCap{},
		Undetermined: []scoreUndetermined{},
	}
	declaration, declarationCaps, declarationUndetermined := declarationAxis(labels)
	behavior, behaviorCaps, behaviorUndetermined := behaviorAxis(labels, parameters)
	usage, usageUndetermined := usageAxis(parameters, capturedAt, virtualEvidenceConfirmed(labels, parameters))
	out.Axes = []scoreAxis{declaration, behavior, usage}
	out.Caps = append(append(out.Caps, declarationCaps...), behaviorCaps...)
	out.Undetermined = append(append(out.Undetermined, declarationUndetermined...), behaviorUndetermined...)
	out.Undetermined = append(out.Undetermined, usageUndetermined...)
	out.Decisive = len(out.Caps) > 0
	// Order is part of the contract, not cosmetics: two captures of the same device must
	// produce byte-identical documents, otherwise a golden diff cannot tell "the device
	// changed" from "the map iteration order changed".
	orderScoreAxes(out.Axes)
	orderScoreUndetermined(out.Undetermined)
	// Caps keep the order they were produced in — the decisive reasons read as a
	// sequence — but are sorted by code so two captures of the same device cannot
	// differ only because a map was walked differently.
	sort.SliceStable(out.Caps, func(a, b int) bool { return out.Caps[a].Code < out.Caps[b].Code })

	// R7: only axes with enough coverage enter the weighted average, so an axis that
	// was barely read cannot water down a real finding with its unearned 100. The one
	// exception is an axis that carries a deduction: a recorded inconsistency is a
	// fact no matter how few sibling channels answered, and dropping it because its
	// coverage is thin would hide exactly the kind of finding this axis exists to
	// price. Coverage itself stays weighted over all three axes because it answers
	// "how much of the picture is decidable".
	weighted, weights := 0.0, 0.0
	coverageSum, coverageWeights := 0.0, 0.0
	for _, axis := range out.Axes {
		coverageSum += float64(axis.Weight) * axis.Coverage
		coverageWeights += float64(axis.Weight)
		if axis.Score == nil {
			continue
		}
		if axis.Coverage >= scoreCoverageFloor || len(axis.Deductions) > 0 {
			weighted += float64(axis.Weight) * float64(*axis.Score)
			weights += float64(axis.Weight)
		}
	}
	out.Coverage = roundScore(divide(coverageSum, coverageWeights))

	// R8: too little evidence means no number at all, never a comfortable 100. The
	// axes drop their scores too, so no surface can render a number that was never
	// published; their coverage stays visible, because that is *why* there is no
	// number.
	// R10: an axis that read nothing *and* found nothing is a blind spot, not a clean one.
	// Averaging the other axes over it publishes a number that was never actually earned.
	//
	// This began as a declaration-only rule (the 40%-weight axis that answers "does this
	// device tell the truth about itself"), but the same asymmetry was exploitable on every
	// axis: R7 drops an axis whose coverage is below the floor, which renormalises the
	// weights onto the axes that *did* answer — so deleting evidence made the number go up.
	// A red-team test showed the exact shape on a real MI 8: keeping the usage inputs scored
	// 97/B, deleting them scored 100/A. Same device, same day, three points better for
	// hiding the evidence. Extending the rule to all three axes closes that direction.
	//
	// "Blind" means read nothing *and found nothing*: an axis that recorded a deduction is
	// not blind, it is thin, and R7 already keeps its finding in play.
	axisBlind := ""
	for _, axis := range out.Axes {
		if axis.Coverage < scoreCoverageFloor && len(axis.Deductions) == 0 {
			axisBlind = axis.Code
			break
		}
	}
	// Two strengths of R10, because the two cases lose different things.
	//
	// A blind *declaration* axis withholds the number. It is the axis that answers "does this
	// device tell the truth about itself", it carries 40% of the weight, and averaging the
	// other two clean axes over it is how an unlooked-at picture turns into "100 / A".
	//
	// A blind behaviour or usage axis only forbids the top band (below) and keeps the number,
	// because withholding there would hide a genuine finding: a device with hook injection and
	// a debugger attached is a D, and turning that into "?" because the usage axis was thin
	// would lose the one thing the report did see.
	//
	// The declaration withhold is itself conditional on nothing else having decided the band,
	// and that limit is the fix for a real capture rather than a refinement. Its whole
	// justification is "do not publish a *comfortable* result for a picture nobody looked at";
	// once a decisive cap has pinned the band at D there is no comfort left to protect.
	// Measured on LDPlayer 9: the declaration axis read 1 of 3 units and found nothing, overall
	// coverage was 0.73, a decisive virtual-build cap had already fixed the band at D — and the
	// document still came out `band=D, value=null`, so the one thing a reviewer asks next ("how
	// much was actually deducted?") was missing, and two D-grade reports could not be ordered
	// against each other. §13 F5 rules the other way for exactly this case: a decisive hit
	// keeps its value as a sort key, because the band already carries the conclusion.
	//
	// R8 (coverage below the floor) and the weights==0 guard still withhold unconditionally:
	// there the absence of a number is the finding, not a formatting choice.
	declarationBlind := false
	for _, axis := range out.Axes {
		if axis.Code == axisDeclaration && axis.Coverage < scoreCoverageFloor && len(axis.Deductions) == 0 {
			declarationBlind = true
		}
	}
	if out.Coverage < scoreCoverageFloor || weights == 0 || (declarationBlind && !out.Decisive) {
		out.Band = bandUnknown
		out.BandLabel = scoreBandLabels[bandUnknown]
		out.CoverageLabel = scoreCoverageLabel(out.Coverage)
		for i := range out.Axes {
			out.Axes[i].Score = nil
		}
		// R5 applies here too. A decisive hit is proof that does not need coverage to
		// be true: a build that names itself an emulator is an emulator whether or not
		// the declaration axis was readable. Withholding the number is correct, but the
		// band is not a number — it is the conclusion, and the conclusion is D. Leaving
		// it as "?" published a document that said decisive=true, caps=[...], band="?"
		// at the same time, and the console rendered "已直接压到 D" next to
		// "数据不足，未给分".
		if out.Decisive {
			out.Band = bandD
			out.BandLabel = scoreBandLabels[bandD]
		}
		return out
	}
	value := int(math.Round(divide(weighted, weights)))
	out.Value = &value
	out.Band = scoreBandOf(value)
	out.BandLabel = scoreBandLabels[out.Band]
	out.CoverageLabel = scoreCoverageLabel(out.Coverage)

	// R7 leaves a thin axis out of the weighted average, so it must leave its *score* out of
	// the document too. Publishing `declaration: 100, coverage: 0.33` next to a value that
	// was computed without it makes the document un-recomputable: on the android-34 AVD the
	// three printed axis scores give (40×100 + 35×65 + 25×100)/100 = 82.75, while the
	// published value is 80, and a reviewer has no way to tell which number is wrong. Null
	// here means the same thing it means under R8 — "this number is not part of the value" —
	// so the rule a reader applies is uniform: sum the axes that have a score, weighted,
	// divided by their weights.
	for i := range out.Axes {
		if out.Axes[i].Coverage < scoreCoverageFloor && len(out.Axes[i].Deductions) == 0 {
			out.Axes[i].Score = nil
		}
	}

	// R11: "一致" is a statement that nothing disagreed. A report that carries any
	// deduction, however small, has something that disagreed, so it cannot wear that
	// word no matter how high the weighted number came out. The band drops to B and
	// the number stays untouched, because the number is a sort key and the band is
	// the conclusion.
	if out.Band == bandA {
		for _, axis := range out.Axes {
			if len(axis.Deductions) > 0 {
				out.Band = bandB
				out.BandLabel = scoreBandLabels[bandB]
				break
			}
		}
	}

	// R10 (extended): a blind axis — read nothing, found nothing — forbids "一致". R7 already
	// keeps such an axis out of the average, which renormalises the remaining weights upward;
	// on its own that let an attacker *gain* by deleting evidence (a real MI 8 scored 97/B
	// with the usage inputs present and 100/A with them removed). Forbidding only the top
	// band is the narrow fix: the number still publishes, so a genuine D caused by a
	// readable axis is not hidden behind "?", but "nothing disagreed" can never be claimed
	// about a picture that was partly never looked at.
	if out.Band == bandA && axisBlind != "" {
		out.Band = bandB
		out.BandLabel = scoreBandLabels[bandB]
	}

	// R5: a decisive hit caps the band at D. It is not averaged away and it is not
	// diluted by the other axes; the number stays as a sort key only.
	if out.Decisive {
		out.Band = bandD
		out.BandLabel = scoreBandLabels[bandD]
	}
	return out
}

func divide(value, weight float64) float64 {
	if weight == 0 {
		return 0
	}
	return value / weight
}

func roundScore(value float64) float64 {
	return math.Round(value*100) / 100
}

func scoreBandOf(value int) string {
	for _, threshold := range scoreBandThresholds {
		if value >= threshold.Min {
			return threshold.Band
		}
	}
	return bandD
}

func scoreCoverageLabel(coverage float64) string {
	switch {
	case coverage >= 0.9:
		return "充分可判"
	case coverage >= 0.6:
		return "部分可判"
	case coverage >= scoreCoverageFloor:
		return "勉强可判"
	default:
		return "证据不足"
	}
}

func scoreLabelByCode(labels []profileLabel, code string) (profileLabel, bool) {
	for _, label := range labels {
		if label.Code == code {
			return label, true
		}
	}
	return profileLabel{Code: code, State: "insufficient"}, false
}

// R1: a deduction may only cite rows that were actually archived. Available rows
// are preferred; a label with no readable row still cites its real keys so the
// reviewer can open the report and see why nothing was measurable.
func scoreAvailableKeys(label profileLabel) []string {
	keys := []string{}
	for _, row := range label.Evidence {
		if row.Status == "AVAILABLE" && strings.TrimSpace(row.Value) != "" &&
			!strings.EqualFold(strings.TrimSpace(row.Value), "unknown") {
			keys = append(keys, row.Key)
		}
	}
	if len(keys) == 0 {
		for _, row := range label.Evidence {
			keys = append(keys, row.Key)
		}
	}
	return keys
}

func scoreEvidenceSummary(label profileLabel, keys []string) string {
	wanted := map[string]bool{}
	for _, key := range keys {
		wanted[key] = true
	}
	parts := []string{}
	for _, row := range label.Evidence {
		if !wanted[row.Key] || row.Status != "AVAILABLE" || row.Value == "" {
			continue
		}
		parts = append(parts, row.Key+"="+row.Value)
	}
	return strings.Join(parts, "；")
}

// R4: every row that could not answer becomes a named gap on the axis, carrying the
// archived status as the reason so the client can distinguish "not collected" from
// "collected but rejected".
// scoreUnreadableKeys returns only the evidence rows that could not be read. Unlike
// scoreUndeterminedFor it never falls back to the readable keys, so it can be used on a
// label that already fired: a hit still has gaps worth naming, and §5.1 requires them.
func scoreUnreadableKeys(label profileLabel) ([]string, string) {
	keys := []string{}
	reason := ""
	for _, row := range label.Evidence {
		if row.Status == "AVAILABLE" && strings.TrimSpace(row.Value) != "" &&
			!strings.EqualFold(strings.TrimSpace(row.Value), "unknown") {
			continue
		}
		keys = append(keys, row.Key)
		reason = scoreReasonRank(row.Status, reason)
	}
	if reason == "" && len(keys) > 0 {
		reason = "UNAVAILABLE"
	}
	return keys, reason
}

func scoreUndeterminedFor(axis string, label profileLabel) scoreUndetermined {
	gap := scoreUndetermined{Axis: axis, Keys: []string{}}
	reason := ""
	for _, row := range label.Evidence {
		if row.Status == "AVAILABLE" && strings.TrimSpace(row.Value) != "" &&
			!strings.EqualFold(strings.TrimSpace(row.Value), "unknown") {
			continue
		}
		gap.Keys = append(gap.Keys, row.Key)
		reason = scoreReasonRank(row.Status, reason)
	}
	if len(gap.Keys) == 0 {
		gap.Keys = scoreAvailableKeys(label)
	}
	if reason == "" {
		reason = "UNAVAILABLE"
	}
	gap.Reason = reason
	return gap
}

// scoreReasonProfileUnset is the fifth undetermined reason (§13 F12). The other four are
// field states (UNAVAILABLE / RESTRICTED / ERROR / NOT_ARCHIVED) and answer "why could the
// app not read it". This one answers a different question: the app read it fine, and *we*
// never wrote down what it should have been. Collapsing the two would tell an operator to
// go re-sample a device when the actual fix is to fill in the registry.
//
// The frontend enumerates this code explicitly (§8.4); a value outside the known set falls
// through to showing the raw code, which is the safe direction.
const scoreReasonProfileUnset = "PROFILE_UNSET"

// profileUnsetKeys returns the evidence rows whose channel the registry left unset, in
// evidence order so the output is deterministic.
func profileUnsetKeys(label profileLabel) []string {
	unset := map[string]bool{}
	for _, basis := range label.Basis {
		if key, ok := strings.CutPrefix(basis, "profile_unset:"); ok {
			unset[key] = true
		}
	}
	keys := []string{}
	for _, row := range label.Evidence {
		if unset[row.Key] {
			keys = append(keys, row.Key)
		}
	}
	return keys
}

// scoreReasonRank keeps the most specific status when a label has several gaps:
// a rejected read explains more than a field the client never sent.
func scoreReasonRank(status, current string) string {
	rank := map[string]int{"": 0, "NOT_ARCHIVED": 1, "ERROR": 2, "UNAVAILABLE": 3, "RESTRICTED": 4}
	if rank[status] >= rank[current] {
		return status
	}
	return current
}

// R6: the deduction total of one axis is capped at that axis's weight, so an axis
// can lose at most its own share and never goes negative.
func finalizeScoreAxis(axis *scoreAxis, decided, total int) {
	sum := 0
	for _, deduction := range axis.Deductions {
		sum += deduction.Points
	}
	// R6: a deduction's points are on a 0–100 scale *inside* the axis, and the axis
	// weight is only the axis's share of the cross-axis average. The two are different
	// units and must not be converted into each other:
	//
	//   - Normalising by weight ("share of budget survived") makes one hook hit on the
	//     35-weight behaviour axis cost 25/35 = 71% of the axis, i.e. an axis score of 29.
	//     A single finding would then outweigh nine clean channels, which is not what a
	//     25-point nominal value means.
	//   - Capping the sum at the weight instead makes the worst declaration axis 60 and
	//     the worst possible device total 66, so D is reachable only through a decisive
	//     cap and "everything disagrees" can never get there on its own.
	//
	// Clamping the sum at 100 gives both properties: the axis spans the full 0–100 range,
	// and the nominal points keep the meaning they were chosen with.
	applied := sum
	if applied > 100 {
		applied = 100
	}
	score := 100 - applied
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	axis.computed = score
	axis.Score = &score
	if total > 0 {
		axis.Coverage = roundScore(float64(decided) / float64(total))
	}
	if axis.Deductions == nil {
		axis.Deductions = []scoreDeduction{}
	}
}

// nonOverlayBasis strips the overlay channel out of a hardware verdict's basis. The
// overlay disagreement is priced on its own at 15 points, so leaving it inside the
// 30-point channel conflict would charge one fact twice under two identical field keys.
func nonOverlayBasis(basis []string) []string {
	out := []string{}
	for _, b := range basis {
		if b == "overlay_codename" {
			continue
		}
		// `unregistered_soc:` entries name a channel that was never compared, because the
		// SoC is not in the registry. They share the Basis slice with real conflict bases,
		// and this function decides who pays the 30-point HARDWARE_CHANNEL_CONFLICT. An
		// omission is not a disagreement: counting it here would charge every unregistered
		// device for a comparison that never happened.
		if strings.HasPrefix(b, "unregistered_soc:") {
			continue
		}
		out = append(out, b)
	}
	return out
}

// foreignProfileAttribution reports whether the hardware conflict was decided by the
// foreign-profile branch, and which measured channels carried it. It reads the basis the
// hardware verdict published instead of re-deriving it: re-asking hardwareFactsLabel
// with a restricted evidence view was a second implementation of the same question, and
// it would silently misattribute the moment hardware_facts.go learned a new rule that a
// single measured channel can decide.
func foreignProfileAttribution(label profileLabel) (bool, []string) {
	const prefix = "foreign_profile:"
	keys := []string{}
	for _, basis := range label.Basis {
		if !strings.HasPrefix(basis, prefix) {
			continue
		}
		if channel := strings.TrimPrefix(basis, prefix); channel != "" {
			keys = append(keys, channel)
		}
	}
	if len(keys) == 0 {
		return false, nil
	}
	return true, keys
}

// overlayCodenameState projects the overlay channel out of the hardware label's own
// evidence rows. It is a plain string comparison of two archived declarations, not a
// hardware inference, and it answers a different question than the conflict label:
// "was the codename rewritten for this app?" rather than "does the SoC add up?".
func overlayCodenameState(label profileLabel) (state string, keys []string, detail string, reason string) {
	rows := map[string]profileEvidence{}
	for _, row := range label.Evidence {
		rows[row.Key] = row
	}
	device, overlay := rows["system.device"], rows["environment.overlayDeviceCodename"]
	readable := func(row profileEvidence) bool {
		return row.Status == "AVAILABLE" && usableIdentity(row.Value) != ""
	}
	if !readable(device) || !readable(overlay) {
		// Name the side that could not answer, not the side that did.
		for _, row := range []profileEvidence{device, overlay} {
			if readable(row) {
				continue
			}
			keys = append(keys, row.Key)
			reason = scoreReasonRank(row.Status, reason)
		}
		if len(keys) == 0 {
			keys = []string{"system.device", "environment.overlayDeviceCodename"}
		}
		if reason == "" {
			reason = "UNAVAILABLE"
		}
		return "insufficient", keys, "", reason
	}
	if identityComparableForm(strings.TrimSpace(device.Value)) != identityComparableForm(strings.TrimSpace(overlay.Value)) {
		return "hit", []string{"system.device", "environment.overlayDeviceCodename"},
			fmt.Sprintf("system.device=%s 与 environment.overlayDeviceCodename=%s 不一致", device.Value, overlay.Value), ""
	}
	return "not_observed", nil, "", ""
}

func declarationAxis(labels []profileLabel) (scoreAxis, []scoreCap, []scoreUndetermined) {
	axis := newScoreAxis(axisDeclaration)
	caps := []scoreCap{}
	undetermined := []scoreUndetermined{}
	decided, total := 0, 0

	// hardware_declaration_conflict: 30 points; decisive only on the foreign-profile
	// branch. The branch comes from the basis the hardware verdict published, so this
	// layer never re-derives a hardware judgement of its own.
	//
	// The overlay codename is one of the hardware label's own channels, but it is priced
	// separately below at 15 points because it answers a different question (was the
	// codename rewritten for this app?) than "does the SoC add up?". So it is removed
	// from the 30-point side here: a label that fired *only* on the codename must not
	// collect 30 + 15 for one disagreement over two identical keys. That is the same root
	// cause counted twice, which R2 forbids.
	hardware, _ := scoreLabelByCode(labels, "hardware_declaration_conflict")
	total++
	switch hardware.State {
	case "hit":
		decided++
		conflictBasis := nonOverlayBasis(hardware.Basis)
		if foreign, keys := foreignProfileAttribution(hardware); foreign {
			detail := "实测 " + scoreEvidenceSummary(hardware, keys) + " 与另一颗已登记 SoC 的画像值一致"
			axis.Deductions = append(axis.Deductions, scoreDeduction{Code: "FOREIGN_PROFILE",
				Label: hardware.Code, Axis: axis.Code, Points: declarationHardwarePoints, Keys: keys, Detail: detail})
			caps = append(caps, scoreCap{Code: "DECISIVE_FOREIGN_PROFILE", Band: bandD, Reason: detail})
		} else if len(conflictBasis) > 0 {
			keys := scoreAvailableKeys(hardware)
			detail := "多条独立通道互相矛盾（" + strings.Join(conflictBasis, "、") + "）：" +
				scoreEvidenceSummary(hardware, keys)
			axis.Deductions = append(axis.Deductions, scoreDeduction{Code: "HARDWARE_CHANNEL_CONFLICT",
				Label: hardware.Code, Axis: axis.Code, Points: declarationHardwarePoints, Keys: keys, Detail: detail})
		}
		// Only the overlay channel fired: the 15-point overlay deduction below is the
		// whole price of it, and no 30-point hardware deduction is added on top.
		// Either way, name the channels that stayed unreadable (§5.1).
		if gaps, reason := scoreUnreadableKeys(hardware); len(gaps) > 0 {
			undetermined = append(undetermined, scoreUndetermined{Axis: axis.Code,
				Keys: gaps, Reason: reason})
		}
	case "not_observed":
		decided++
	default:
		undetermined = append(undetermined, scoreUndeterminedFor(axis.Code, hardware))
	}
	// PROFILE_UNSET is published regardless of the label's aggregate state, and that is
	// deliberate. The state answers "is there a conflict?" — one confirming channel is
	// enough to answer it. This gap answers a different question: "was every registered
	// channel actually checked?" A device can be not_observed on the strength of
	// ram_dispersion alone while its capacity channel was never compared to anything,
	// and hiding that behind the aggregate state is how a reader concludes a channel was
	// verified when it was merely never evaluated.
	//
	// It is not folded into the state machine because doing so would make an unset
	// expectation look like an unanswered capture, which would drop coverage on devices
	// whose capture is perfectly fine — `sdm845` has no capacities by design.
	if keys := profileUnsetKeys(hardware); len(keys) > 0 {
		undetermined = append(undetermined, scoreUndetermined{Axis: axis.Code,
			Keys: keys, Reason: scoreReasonProfileUnset})
	}

	// identity_conflict: two branches with very different weight. A model/device
	// disagreement means the app's own view of the hardware contradicts the boot
	// hardware — that is decisive. A SKU-only disagreement is a real finding but a
	// legitimately explainable one: on the Pixel 6 the shell and the app uid report
	// different SKUs by design, so treating it as decisive would flag an honest device.
	// The branch is decided by which pair actually disagreed, not by the label alone.
	identity, _ := scoreLabelByCode(labels, "identity_conflict")
	total++
	switch identity.State {
	case "hit":
		decided++
		keys, detail := identityConflictEvidence(identity)
		// A one-sided identity pair is a different finding than a disagreeing one, and it
		// must carry its own explanation: `identityConflictEvidence` walks the pairs by
		// value, and a blank side never matches, so it would return an empty detail here.
		if asymmetry := identityAsymmetryDetail(identity); asymmetry != "" {
			detail = asymmetry
			if keys == nil {
				keys = []string{"identity_asymmetry"}
			}
		}
		points, code := declarationIdentityPoints, "IDENTITY_APP_UID"
		decisive := true
		if skuOnlyIdentityConflict(identity) {
			points, code, decisive = declarationIdentitySkuPoints, "IDENTITY_SKU", false
		}
		axis.Deductions = append(axis.Deductions, scoreDeduction{Code: code,
			Label: identity.Code, Axis: axis.Code, Points: points, Keys: keys, Detail: detail})
		if gaps, reason := scoreUnreadableKeys(identity); len(gaps) > 0 {
			undetermined = append(undetermined, scoreUndetermined{Axis: axis.Code,
				Keys: gaps, Reason: reason})
		}
		if decisive {
			caps = append(caps, scoreCap{Code: "DECISIVE_IDENTITY_APP_UID", Band: bandD, Reason: detail})
		}
	case "not_observed":
		decided++
	default:
		undetermined = append(undetermined, scoreUndeterminedFor(axis.Code, identity))
	}

	// overlay_codename: 15 points, projected from the hardware label's evidence rows.
	//
	// The deduction's Label is hardware_declaration_conflict, not "overlay_codename": an
	// overlay codename mismatch is one channel of that label (§13 F2), and the contract
	// says a channel does not become a label. Emitting "overlay_codename" here invented a
	// twelfth label name that no profile emits and no document lists — the ledger then
	// showed a label the reader could not look up anywhere else.
	overlayState, overlayKeys, overlayDetail, overlayReason := overlayCodenameState(hardware)
	total++
	switch overlayState {
	case "hit":
		decided++
		axis.Deductions = append(axis.Deductions, scoreDeduction{Code: "OVERLAY_CODENAME_MISMATCH",
			Label: hardware.Code, Axis: axis.Code, Points: declarationOverlayPoints,
			Keys: overlayKeys, Detail: overlayDetail})
	case "not_observed":
		decided++
	default:
		undetermined = append(undetermined, scoreUndetermined{Axis: axis.Code, Keys: overlayKeys, Reason: overlayReason})
	}

	// virtual_build_markers belongs to the behavior axis and is deducted there, so the
	// declaration axis never touches it (R2: one root cause, one hit). The frontend
	// pins undetermined[].reason to the four field states, so this is deliberately not
	// emitted as a fifth reason code: the reader can already see the marker in the
	// behavior ledger, and inventing a status would corrupt the reason enum.

	finalizeScoreAxis(&axis, decided, total)
	return axis, caps, undetermined
}

// identityConflictEvidence names the exact pair that disagreed. The comparison only
// uses the same declaration helpers the label used (usableIdentity,
// identityComparableForm, applicableIdentityPairs); it never inspects hardware.
// skuOnlyIdentityConflict reports whether the only identity pair that disagreed is the
// SKU pair. `identityConflictEvidence` walks appIdentityPairs in order, so a conflict
// that never touched system.model / system.device is SKU-only.
func skuOnlyIdentityConflict(label profileLabel) bool {
	rows := map[string]profileEvidence{}
	for _, row := range label.Evidence {
		rows[row.Key] = row
	}
	read := func(key string) string {
		if row, ok := rows[key]; ok && row.Status == "AVAILABLE" {
			return row.Value
		}
		return ""
	}
	sawConflict := false
	for _, pair := range applicableIdentityPairs(read) {
		left, right := usableIdentity(read(pair[0])), usableIdentity(read(pair[1]))
		if left == "" || right == "" {
			continue
		}
		if identityComparableForm(left) == identityComparableForm(right) {
			continue
		}
		sawConflict = true
		if pair[0] != "system.sku" {
			return false
		}
	}
	return sawConflict
}

// identityAsymmetryDetail returns the explanation of a one-sided identity pair, or "" when
// the label carries no such finding. `identityConflictEvidence` cannot report this case: it
// compares two usable values, and an asymmetry has only one.
//
// The wording matters. It must not say "tampered" — the score cannot know that. It must say
// what was observed: both sides of the same declaration were read successfully, and only one
// of them produced a value. A reader can then decide whether that is a ROM quirk or a deleted
// property.
func identityAsymmetryDetail(label profileLabel) string {
	for _, row := range label.Evidence {
		if row.Key == "identity_asymmetry" {
			return row.Value
		}
	}
	return ""
}

func identityConflictEvidence(label profileLabel) ([]string, string) {
	rows := map[string]profileEvidence{}
	for _, row := range label.Evidence {
		rows[row.Key] = row
	}
	read := func(key string) string {
		if row, ok := rows[key]; ok && row.Status == "AVAILABLE" {
			return row.Value
		}
		return ""
	}
	keys := []string{}
	details := []string{}
	for _, pair := range applicableIdentityPairs(read) {
		left, right := usableIdentity(read(pair[0])), usableIdentity(read(pair[1]))
		if left == "" || right == "" {
			continue
		}
		if identityComparableForm(left) != identityComparableForm(right) {
			keys = append(keys, pair[0], pair[1])
			details = append(details, fmt.Sprintf("%s=%s 与 %s=%s", pair[0], left, pair[1], right))
		}
	}
	if len(keys) == 0 {
		keys = scoreAvailableKeys(label)
	}
	detail := strings.Join(details, "；")
	if detail == "" {
		detail = "app 侧声明与属性读数不一致"
	}
	return keys, detail
}

func behaviorAxis(labels []profileLabel, parameters []Parameter) (scoreAxis, []scoreCap, []scoreUndetermined) {
	axis := newScoreAxis(axisBehavior)
	caps := []scoreCap{}
	undetermined := []scoreUndetermined{}
	decided, total := 0, 0
	markerHit := false
	for _, rule := range behaviorScoreTable {
		label, _ := scoreLabelByCode(labels, rule.Label)
		total++
		switch label.State {
		case "hit":
			decided++
			keys := scoreAvailableKeys(label)
			detail := rule.Detail + "：" + scoreEvidenceSummary(label, keys)
			axis.Deductions = append(axis.Deductions, scoreDeduction{Code: rule.Code, Label: rule.Label,
				Axis: axis.Code, Points: rule.Points, Keys: keys, Detail: detail})
			// §5.1: a hit still has to name the rows it could not read. Otherwise the
			// administrator sees "hook detected" and never learns that the mount-hint row
			// was RESTRICTED, which is the difference between one channel and two.
			if gaps, reason := scoreUnreadableKeys(label); len(gaps) > 0 {
				undetermined = append(undetermined, scoreUndetermined{Axis: axis.Code,
					Keys: gaps, Reason: reason})
			}
			if rule.Decisive {
				caps = append(caps, scoreCap{Code: "DECISIVE_VIRTUAL_BUILD", Band: bandD, Reason: detail})
				markerHit = true
			}
		case "not_observed":
			decided++
		default:
			undetermined = append(undetermined, scoreUndeterminedFor(axis.Code, label))
		}
	}
	// One cause, one deduction: the structural channel only speaks when the blocklist
	// stayed silent. It adds itself after the table so the deduction order stays stable.
	//
	// It must still be *finalized*, which is why the axis is finalized after this point
	// rather than before it: appending a 35-point deduction to an axis whose score was
	// already computed printed a document that contradicted itself — deductions summing to
	// 50 next to an axis score of 85 (= 100 − 15), and a weighted total that could not be
	// recomputed from either. Measured on LDPlayer 9, where the structural channel is the
	// one that fires: the axis claimed 85 while its own ledger said 50.
	if deduction, ok := structuralVirtualDeduction(parameters, markerHit); ok {
		axis.Deductions = append(axis.Deductions, deduction)
		caps = append(caps, scoreCap{Code: "DECISIVE_VIRTUAL_BUILD", Band: bandD, Reason: deduction.Detail})
	}
	finalizeScoreAxis(&axis, decided, total)
	return axis, caps, undetermined
}

// virtualEvidenceConfirmed reports whether this capture has already been identified as a
// virtual device, by either of the two channels the behaviour axis prices.
//
// It exists so the usage axis can ask "is this machine already known to be an emulator?"
// without re-deriving the verdict: the marker label is read from the labels that were
// already computed, and the structural channel from the same two parameters the deduction
// reads. No third opinion is formed here.
func virtualEvidenceConfirmed(labels []profileLabel, parameters []Parameter) bool {
	if marker, ok := scoreLabelByCode(labels, "virtual_build_markers"); ok && marker.State == "hit" {
		return true
	}
	return len(structuralVirtualEvidence(structuralVirtualRead(parameters))) > 0
}

// structuralVirtualRead collects the two structural channel readings from the archive.
// Shared by the deduction and by the usage-axis suppression so both ask the same question
// from the same evidence; a second reader would be a second definition.
func structuralVirtualRead(parameters []Parameter) map[string]string {
	values := make(map[string]string, 2)
	for _, key := range []string{"cpu.cpuInfo", "system.boardPlatform"} {
		for _, p := range parameters {
			if p.Group+"."+p.Key != key || p.Status != "AVAILABLE" || p.Value == nil {
				continue
			}
			values[key] = *p.Value
			break
		}
	}
	return values
}

// structuralVirtualDeduction is the escape hatch for an emulator that defeats the blocklist.
//
// It is silent when the marker rule already hit: one cause, one deduction (R2). It is also
// silent when neither structural channel has anything to say, which is the normal case for
// a real handset and must stay that way — a channel that reports "unrecognised" as evidence
// would fire on every ARM part we have not seen yet.
func structuralVirtualDeduction(parameters []Parameter, markerHit bool) (scoreDeduction, bool) {
	if markerHit {
		return scoreDeduction{}, false
	}
	values := structuralVirtualRead(parameters)
	keys := make([]string, 0, 2)
	for _, key := range []string{"cpu.cpuInfo", "system.boardPlatform"} {
		if strings.TrimSpace(values[key]) != "" {
			keys = append(keys, key)
		}
	}
	basis := structuralVirtualEvidence(values)
	if len(basis) == 0 {
		return scoreDeduction{}, false
	}
	// The detail names the measurement, not a verdict. "This is an emulator" is a
	// conclusion; "cpuInfo reports a desktop part while the device declares a handset" is
	// what was observed, and the reader can disagree with it.
	detail := "设备自相矛盾：" + strings.Join(basis, "、")
	if cpuInfoContradictsHandset(values["cpu.cpuInfo"]) {
		detail += "（cpu.cpuInfo=" + strings.TrimSpace(values["cpu.cpuInfo"]) + "）"
	}
	if boardPlatformIsGeneric(values["system.boardPlatform"]) {
		detail += "（system.boardPlatform=" + strings.TrimSpace(values["system.boardPlatform"]) + "）"
	}
	return scoreDeduction{
		Code:   "STRUCTURAL_VIRTUAL_EVIDENCE",
		Label:  "structural_virtual_evidence",
		Axis:   axisBehavior,
		Points: structuralVirtualPoints,
		Keys:   keys,
		Detail: detail,
	}, true
}

var partitionYearPattern = regexp.MustCompile(`([0-9]{4})-[0-9]{2}-[0-9]{2}`)

// oldestPartitionYear reads the earliest build date in system.partitionBuildDates.
// The oldest partition is the honest answer to "how old is this ROM".
func oldestPartitionYear(value string) (int, bool) {
	oldest := 0
	for _, match := range partitionYearPattern.FindAllStringSubmatch(value, -1) {
		year, err := strconv.Atoi(match[1])
		if err != nil {
			continue
		}
		if oldest == 0 || year < oldest {
			oldest = year
		}
	}
	return oldest, oldest > 0
}

// usageAxis v1 scores only what the current field set already archives: boot count
// against partition build dates and the shipping SDK level. It deliberately adds no
// collection.
//
// virtualized suppresses FRESH_BOOT_ON_AGED_ROM and nothing else. The rule asks whether a
// device with almost no cold boots is claiming a generation older than itself, and on an
// emulator that shape is guaranteed rather than suspicious: an AVD carries
// ro.product.first_api_level from the system image it was built from, so an android-14
// image on an "SDK 28" device is the normal, documented layout — and a freshly created
// instance starts at bootCount 1–2. Measured on LDPlayer 9: initialSdk 28 against an
// android-14 image, bootCount 2, so U2 charged 12 points for being an emulator.
//
// That is the same fact the behaviour axis already charges 35 points for, decisively. One
// cause, one deduction (R2) is the rule this file applies everywhere else, and an emulator
// is not made more suspicious by also looking like a fresh install — it *is* one.
//
// The suppression is deliberately one-way: it is gated on virtual evidence having been
// confirmed by an independent channel, so a real 2017 phone reset once still gets its 12
// points and no attacker can reach the suppression by claiming to be an emulator (claiming
// it costs 35 decisive points and a D).
func usageAxis(parameters []Parameter, capturedAt int64, virtualized bool) (scoreAxis, []scoreUndetermined) {
	axis := newScoreAxis(axisUsage)
	undetermined := []scoreUndetermined{}
	rows := map[string]profileEvidence{}
	for _, parameter := range parameters {
		row := profileEvidence{Key: parameter.Group + "." + parameter.Key, Status: parameter.Status,
			Reason: parameter.Reason, Errno: parameter.Errno}
		if parameter.Status == "AVAILABLE" && parameter.Value != nil {
			row.Value = strings.TrimSpace(*parameter.Value)
		}
		rows[row.Key] = row
	}
	readable := func(key string) (profileEvidence, bool) {
		row, ok := rows[key]
		if !ok {
			return profileEvidence{Key: key, Status: "NOT_ARCHIVED"}, false
		}
		if row.Status != "AVAILABLE" || row.Value == "" || strings.EqualFold(row.Value, "unknown") {
			return row, false
		}
		return row, true
	}

	// Coverage is the decidable rate of the axis's *derived* label, not of its raw
	// fields. The label is FRESH_BOOT_ON_AGED_ROM, and it is decidable only when a boot
	// count AND at least one generation signal are usable — a boot count alone answers
	// nothing, so counting it as half the axis handed an unearned 100 to the weighted
	// average. Reading one of two fields is 0.5, which is exactly R7's floor, so the
	// half-read axis used to pass the gate and lift a C to a B.
	//
	// The "generation signal" is now satisfied by *either* an aged partition date (U1) or
	// an old shipping SDK (U2). That is a widening of the decidable set, not a widening of
	// the deduction: a device with a current image but a 2017 SDK is now decidable and
	// clean, where before it was undecidable. Undecidable and clean must not be confused,
	// and this is the direction that makes fewer devices fall out of the total.
	decided, total := 0, 1
	bootRow, bootOK := readable("system.bootCount")
	if !bootOK {
		undetermined = append(undetermined, scoreUndetermined{Axis: axis.Code,
			Keys: []string{bootRow.Key}, Reason: scoreReasonOr(bootRow.Status, "UNAVAILABLE")})
	}
	dateRow, dateOK := readable("system.partitionBuildDates")
	sdkRow, sdkOK := readable("system.initialSdk")
	sdkYear, sdkYearOK := 0, false
	if sdkOK {
		sdkYear, sdkYearOK = usageSdkYear(sdkRow.Value)
	}
	// Every signal that was readable but unusable gets named. A readable-but-unmapped SDK
	// is its own gap: treating it as "not present" would hide the fact that we looked and
	// could not interpret what we saw.
	dateYear, dateYearOK := 0, false
	if dateOK {
		dateYear, dateYearOK = oldestPartitionYear(dateRow.Value)
		if !dateYearOK {
			undetermined = append(undetermined, scoreUndetermined{Axis: axis.Code,
				Keys: []string{dateRow.Key}, Reason: "UNPARSEABLE_PARTITION_DATES"})
		}
	} else {
		undetermined = append(undetermined, scoreUndetermined{Axis: axis.Code,
			Keys: []string{dateRow.Key}, Reason: scoreReasonOr(dateRow.Status, "UNAVAILABLE")})
	}
	if !sdkOK {
		undetermined = append(undetermined, scoreUndetermined{Axis: axis.Code,
			Keys: []string{sdkRow.Key}, Reason: scoreReasonOr(sdkRow.Status, "UNAVAILABLE")})
	} else if !sdkYearOK {
		undetermined = append(undetermined, scoreUndetermined{Axis: axis.Code,
			Keys: []string{sdkRow.Key}, Reason: "UNMAPPED_SDK_LEVEL"})
	}

	// U1 and U2 are independent *checks*, not alternatives. An earlier version chained them
	// with `else if`, which silently disabled U2 whenever the partition dates were readable
	// — i.e. exactly on the devices U2 exists for. The image date says nothing about the
	// device's generation, so one being present must never suppress the other.
	if bootOK && (dateYearOK || sdkYearOK) {
		decided = 1
		bootCount, err := strconv.Atoi(bootRow.Value)
		cutoff := usageAgedRomCutoff(capturedAt)
		// A virtualized capture keeps its coverage (the signal was readable and did answer)
		// but is not priced: see the function comment. `decided` is deliberately left at 1,
		// because "we could tell" and "we charged for it" are different statements and only
		// the second one is being suppressed.
		if err == nil && bootCount <= usageFreshBootCeiling && !virtualized {
			agedImage := dateYearOK && dateYear <= cutoff
			agedDevice := sdkYearOK && sdkYear <= cutoff
			switch {
			case agedImage:
				// U1: the image itself is old. Preferred explanation when both fire, because
				// a partition date is direct evidence rather than a release-year inference.
				keys := []string{"system.bootCount", "system.partitionBuildDates"}
				if sdkOK {
					keys = append(keys, sdkRow.Key)
				}
				axis.Deductions = append(axis.Deductions, scoreDeduction{
					Code: "FRESH_BOOT_ON_AGED_ROM", Label: "fresh_boot_on_aged_rom",
					Axis: axis.Code, Points: usageFreshBootPoints, Keys: keys,
					Detail: fmt.Sprintf("分区最早建于 %d 年，距采样已满 %d 年，开机次数只有 %d 次",
						dateYear, usageAgedRomYears, bootCount)})
			case agedDevice:
				// U2: the *device* is old while the image is current or unknown. This is the
				// shape a ROM-flashing attacker produces, and the one U1 cannot see.
				axis.Deductions = append(axis.Deductions, scoreDeduction{
					Code: "FRESH_BOOT_ON_AGED_ROM", Label: "fresh_boot_on_aged_rom",
					Axis: axis.Code, Points: usageFreshBootPoints,
					Keys: []string{"system.bootCount", sdkRow.Key},
					Detail: fmt.Sprintf("出厂 SDK %s 对应 %d 年，距采样已满 %d 年，开机次数只有 %d 次",
						sdkRow.Value, sdkYear, usageAgedRomYears, bootCount)})
			}
		}
	}
	finalizeScoreAxis(&axis, decided, total)
	return axis, undetermined
}

// usageAgedRomCutoff turns the "three years before capture" window into the oldest
// partition year that still counts as aged. A report with no usable capture time falls
// back to the original fixed boundary, so archived fixtures keep their verdicts instead
// of flipping the moment the window became relative.
func usageAgedRomCutoff(capturedAt int64) int {
	if capturedAt <= 0 {
		return usageAgedRomFallbackYear
	}
	return time.UnixMilli(capturedAt).UTC().Year() - usageAgedRomYears
}

func scoreReasonOr(status, fallback string) string {
	if status == "" {
		return fallback
	}
	return status
}

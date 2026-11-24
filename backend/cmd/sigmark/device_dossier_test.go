package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDossierChecklistMatchesIngestDictionary(t *testing.T) {
	known := map[string]bool{}
	for _, f := range dictionary() {
		known[f.Key] = true
	}
	seen := map[string]bool{}
	for _, rule := range dossierChecklist {
		if !known[rule.key] || seen[rule.key] {
			t.Errorf("unknown or duplicate checklist key: %s", rule.key)
		}
		seen[rule.key] = true
	}
}

func TestDossierEvidenceAndApplicability(t *testing.T) {
	p := Report{SchemaVersion: 4, FieldSetVersion: 10, AndroidAPI: 27, CapturedAt: 1700000000000}
	value := func(group, key, text string) Parameter {
		return Parameter{Group: group, Key: key, Label: key, Source: "fixture", Status: "AVAILABLE", Value: &text}
	}
	errno := 13
	p.Parameters = []Parameter{
		value("system", "buildId", "ROM B"),
		{Group: "system", Key: "selinux", Status: "RESTRICTED", Reason: "ACCESS_DENIED", Errno: &errno, Source: "/sys/fs/selinux/enforce"},
		{Group: "battery", Key: "energyCounter", Status: "UNAVAILABLE", Reason: "INTERFACE_UNSUPPORTED"},
		{Group: "memory", Key: "availableRam", Status: "ERROR", Reason: "READ_FAILED"},
		value("environment", "capturePlan", "standard"), value("environment", "captureLocationAccess", "approximate"),
		value("environment", "captureLocationSwitch", "enabled"),
		value("system", "partition_product", "observed build"),
	}
	p.Feedback = "never include the operator note"
	row := storedReport{ID: "selected", Report: p}
	sheet := buildDossier("one", row)
	if sheet.BuildID != "ROM B" || sheet.CapturedAt != p.CapturedAt || sheet.ReportID != row.ID || sheet.Context.Location != "approximate" {
		t.Fatalf("metadata not tied to source: %+v", sheet)
	}
	if len(sheet.Categories) != 12 {
		t.Fatal("expected all categories, even when empty")
	}
	system := sheet.Categories[0]
	if system.Counts != (dossierCounts{Available: 2, Restricted: 1}) || system.Fields[1].Errno == nil ||
		*system.Fields[1].Errno != 13 || system.Fields[1].Reason != "ACCESS_DENIED" || system.Fields[1].Source != "/sys/fs/selinux/enforce" {
		t.Fatalf("lost archive evidence: %+v", system)
	}
	if sheet.Categories[2].Counts.Errors != 1 || sheet.Categories[2].Fields[0].Kind != "snapshot" ||
		sheet.Categories[4].Counts.Unavailable != 1 || sheet.Categories[4].Fields[0].Reason != "INTERFACE_UNSUPPORTED" {
		t.Fatal("incorrect error or unavailable derivation")
	}
	gaps := func(d assetDossier) map[string]dossierGap {
		m := map[string]dossierGap{}
		for _, c := range d.Categories {
			for _, g := range c.Gaps {
				m[g.Group+"."+g.Key] = g
			}
		}
		return m
	}
	m := gaps(sheet)
	for key, code := range map[string]string{
		"system.partitionCount": "API_BELOW_MINIMUM", "system.release": "NOT_RECORDED",
		"cellular.cellDiagnostics": "PRECISE_LOCATION_NOT_GRANTED", "cellular.cellLTEBandwidth": "API_BELOW_MINIMUM",
		"media.avcFirstFrame": "OTHER_CAPTURE_PLAN", "network.checkEndTransport": "OTHER_CAPTURE_PLAN",
	} {
		if m[key].Code != code {
			t.Errorf("%s: %+v, want %s", key, m[key], code)
		}
	}
	if _, exists := m["system.selinux"]; exists || system.ChecklistSaved != 2 || system.ChecklistScope != 4 ||
		sheet.Categories[7].ChecklistScope != 0 {
		t.Fatal("explicit states should count as saved; unknown or inapplicable gaps should not enter the denominator")
	}
	encoded, err := json.Marshal(sheet)
	if err != nil || strings.Contains(string(encoded), p.Feedback) {
		t.Fatal("derived contract should not include report feedback")
	}
	p = Report{SchemaVersion: 1, Metrics: []Metric{{Key: "system.selinux", Status: "RESTRICTED", Reason: "ACCESS_DENIED"}}}
	old := buildDossier("one", storedReport{Report: p})
	m = gaps(old)
	if m["system.selinux"].Code != "OLDER_FIELD_SET" || m["system.selinux"].StatusOnly == nil ||
		old.Categories[0].Counts.Restricted != 0 || old.Categories[0].ChecklistScope != 0 {
		t.Fatal("status-only evidence must not become a full field")
	}
	p = Report{SchemaVersion: 4, FieldSetVersion: 9}
	m = gaps(buildDossier("one", storedReport{Report: p}))
	if m["network.checkEndTransport"].Code != "OLDER_FIELD_SET" || m["system.partitionCount"].Code != "API_UNKNOWN" ||
		m["media.avcFirstFrame"].Code != "PLAN_UNKNOWN" || m["cellular.cellDiagnostics"].Code != "ACCESS_UNKNOWN" {
		t.Fatal("unknown and older field sets should not be guessed")
	}
}

func TestDossierLocationRequirements(t *testing.T) {
	rule := dossierRule{key: "cellular.cellLTEBandwidth", fine: true, minAPI: 28}
	field := dictionaryField{MinSchema: 2}
	p := Report{SchemaVersion: 4, FieldSetVersion: 10, AndroidAPI: 29}
	for _, c := range []struct {
		access dossierContext
		noCell bool
		want   string
	}{
		{dossierContext{Location: "precise", Switch: "disabled"}, false, "LOCATION_SWITCH_OFF"},
		{dossierContext{Location: "precise", Switch: "enabled"}, false, "NOT_RECORDED"},
		{dossierContext{Location: "precise"}, false, "ACCESS_UNKNOWN"},
		{dossierContext{Location: "not_granted", Switch: "disabled"}, false, "PRECISE_LOCATION_NOT_GRANTED"},
		{dossierContext{Location: "precise", Switch: "enabled"}, true, "CELLULAR_NOT_OBSERVED"},
	} {
		if got := dossierGapCode(p, field, rule, c.access, c.noCell); got != c.want {
			t.Errorf("%+v: got %s, want %s", c.access, got, c.want)
		}
	}
}

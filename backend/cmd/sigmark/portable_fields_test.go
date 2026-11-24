package main

import "testing"

func TestPortableFields(t *testing.T) {
	for _, tc := range []struct{ group, key, value, invalid string }{
		{"battery", "present", "yes", "maybe"},
		{"battery", "cycleCount", "0", "-1"},
		{"cellular", "dataSubscriptionService", "有服务", "LTE"},
	} {
		p := Parameter{Group: tc.group, Key: tc.key, Label: tc.key, Source: "fixture", Status: "AVAILABLE", Value: &tc.value}
		if !p.valid(4, 16) || p.valid(4, 15) {
			t.Fatalf("incorrect field-set handling for %s.%s", tc.group, tc.key)
		}
		p.Value = &tc.invalid
		if p.valid(4, 16) {
			t.Fatalf("accepted invalid value for %s.%s", tc.group, tc.key)
		}
		p.Value, p.Status, p.Reason = nil, "UNAVAILABLE", "NOT_REPORTED"
		if !p.valid(4, 16) {
			t.Fatalf("rejected observed no-data state for %s.%s", tc.group, tc.key)
		}
	}
}

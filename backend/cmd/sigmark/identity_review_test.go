package main

import "testing"

func TestBuildIdentityReview(t *testing.T) {
	claim := func(value string) *string { return &value }
	report := Report{
		Model: "Example 9", CapturedAt: 1800000000000,
		Parameters: []Parameter{
			{Group: "system", Key: "device", Status: "AVAILABLE", Value: claim("test_device")},
			{Group: "system", Key: "initialSdk", Status: "RESTRICTED"},
		},
	}
	in := identityReviewInput{
		Observer: "ADB_SHELL", Confirmed: true, ObservedAt: report.CapturedAt + 300000,
		Readings: map[string]*string{
			"system.model": claim("Example 8"), "system.device": claim("TEST_DEVICE"), "system.initialSdk": claim("30"),
		},
	}
	got, ok := buildIdentityReview("example", report, in)
	if !ok || got.Compared != 2 || got.Different != 1 || got.Pairs[2].State != "missing" {
		t.Fatalf("unexpected comparison: %+v", got)
	}
	in.ObservedAt++
	if _, ok := buildIdentityReview("example", report, in); ok {
		t.Fatal("out-of-window evidence accepted")
	}
	in.ObservedAt--
	in.Confirmed = false
	if _, ok := buildIdentityReview("example", report, in); ok {
		t.Fatal("unconfirmed device association accepted")
	}
	in.Confirmed = true
	in.Readings["system.initialSdk"] = claim("0")
	if _, ok := buildIdentityReview("example", report, in); ok {
		t.Fatal("invalid reading accepted")
	}
	delete(in.Readings, "system.initialSdk")
	in.Readings["environment.androidIdSha256"] = claim("not allowed")
	if _, ok := buildIdentityReview("example", report, in); ok {
		t.Fatal("disallowed field accepted")
	}
}

package main

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
)

func TestArchiveDictionaryMatchesAndroidRegistry(t *testing.T) {
	name := fmt.Sprintf("../../../app/src/test/resources/lan-projection-v%d.txt", latestFieldSet)
	b, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("run this contract check from a full SigMark checkout: %v", err)
	}
	want := strings.Fields(string(b))
	got := make([]string, 0, len(want))
	for _, entry := range dictionary() {
		got = append(got, entry.Key)
		if entry.WireType != "string_or_null" || entry.Temporal == "" || entry.Sensitivity == "" ||
			entry.Scope != "lan_projection" || entry.MinSchema < 2 || entry.SinceFieldSet > latestFieldSet {
			t.Errorf("incomplete LAN contract: %+v", entry)
		}
	}
	slices.Sort(got)
	if !slices.Equal(want, got) {
		t.Fatalf("Android LAN projection/backend archive drift: registry=%v, dictionary=%v", want, got)
	}
}

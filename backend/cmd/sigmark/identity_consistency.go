package main

import "strings"

// Compare the same declaration twice under the app identity. Board/platform
// and hardware/boot hardware are distinct fields, not interchangeable values.
var appIdentityPairs = [][2]string{
	{"system.model", "system.propertyModel"},
	{"system.device", "system.propertyDevice"},
	{"system.sku", "system.hardwareSku"},
}

func identityComparableForm(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= 'A' && r <= 'Z' {
			return r + ('a' - 'A')
		}
		return r
	}, s)
}

func usableIdentity(s string) string {
	s = strings.TrimSpace(s)
	if oneOf(identityComparableForm(s), "", "unknown", "null", "none", "n/a", "-") {
		return ""
	}
	return s
}

func applicableIdentityPairs(read func(string) string) [][2]string {
	if compactIntRange(strings.TrimSpace(read("system.api")), 1, 30) && usableIdentity(read("system.sku")) == "" {
		return appIdentityPairs[:len(appIdentityPairs)-1]
	}
	return appIdentityPairs
}

func compareAppIdentity(pairs [][2]string, read func(string) string) (compared int, conflicts []identityPair) {
	conflicts = []identityPair{}
	for _, pair := range pairs {
		left, right := usableIdentity(read(pair[0])), usableIdentity(read(pair[1]))
		if left == "" || right == "" {
			continue
		}
		compared++
		if identityComparableForm(left) != identityComparableForm(right) {
			conflicts = append(conflicts, identityPair{LeftKey: pair[0], RightKey: pair[1], Left: left, Right: right})
		}
	}
	return
}

// oneSidedIdentity finds the pairs where one side produced a usable reading and the other
// produced nothing, *with both sides present in the archive*. That third condition is the
// whole point: it separates "this device cannot read the property" from "this property was
// made to disappear".
//
// The distinction is not cosmetic. Every earlier report in the store with a one-sided pair
// (field sets 16 and 20, seven reports) is one-sided because `propertyModel` / `propertyDevice`
// / `hardwareSku` did not exist in that field set yet — the row is absent, not empty. A blank
// row where the field set *does* define the key is a different animal: the collector asked,
// the archive has a slot for the answer, and the answer is nothing.
//
// Both sides of a pair are read by the same process in the same pass, from the same two
// sources (`Build.MODEL` vs the `ro.product.model` property). A pair that is readable on one
// side and blank on the other is not a partial reading — it is an asymmetry that the reading
// process cannot produce on its own. Deleting one property used to make `compareAppIdentity`
// skip the pair, which dropped the axis coverage and erased the finding: a confirmed disguise
// became indistinguishable from a clean device (measured: 100/A → 90/D → blanking one property
// → 100/A). This function is what closes that route.
func oneSidedIdentity(pairs [][2]string, value func(string) (string, string)) (oneSided []identityPair, present int) {
	oneSided = []identityPair{}
	for _, pair := range pairs {
		leftRaw, leftStatus := value(pair[0])
		rightRaw, rightStatus := value(pair[1])
		if leftStatus == "NOT_ARCHIVED" || rightStatus == "NOT_ARCHIVED" {
			// The field set does not define one of the keys, so there is no reading to
			// compare and no absence to interpret.
			continue
		}
		present++
		// Only a successful read counts. RESTRICTED means the OS refused the collector, and
		// ERROR means the read failed; neither is evidence about the value. Treating those as
		// asymmetry would punish a device for a permission the app never had.
		if leftStatus != "AVAILABLE" || rightStatus != "AVAILABLE" {
			continue
		}
		left, right := usableIdentity(leftRaw), usableIdentity(rightRaw)
		switch {
		case left == "" && right == "":
			// Both sides came back empty. That is a device/collection limitation, not
			// tampering: an attacker who blanks one side leaves the other readable.
		case left == "" || right == "":
			oneSided = append(oneSided, identityPair{LeftKey: pair[0], RightKey: pair[1], Left: left, Right: right})
		}
	}
	return
}

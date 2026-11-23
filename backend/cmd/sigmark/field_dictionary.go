package main

import "net/http"

const latestFieldSet = 10

type dictionaryField struct {
	Key           string `json:"key"`
	MinSchema     int    `json:"minSchemaVersion"`
	SinceFieldSet int    `json:"sinceFieldSet,omitempty"`
	Unit          string `json:"unit,omitempty"`
}

var fieldUnits = map[string]string{
	"system.patch": "YYYY-MM-DD", "system.vendorSpl": "YYYY-MM-DD", "system.systemSpl": "YYYY-MM-DD",
	"runtime.vulkanVersion": "version", "media.avcElapsed": "ms", "media.avcFixture": "fixture_id",
	"media.avcFirstFrame": "outcome_code", "media.avcStage": "stage_code",
	"environment.capturePlan": "plan_code", "environment.capturePhoneAccess": "authorization_code",
	"environment.captureLocationAccess": "authorization_code", "environment.captureLocationSwitch": "switch_code",
	"network.wifiFrequency": "MHz", "cellular.cellLTEBandwidth": "kHz",
	"network.checkElapsed": "ms", "network.checkStartTransport": "transport_code", "network.checkEndTransport": "transport_code",
}

func dictionary() []dictionaryField {
	legacy, diagnostic, versioned := map[string]bool{}, map[string]bool{}, map[string]int{}
	for g, keys := range parameterKeys {
		for _, k := range keys {
			legacy[g+"."+k] = true
		}
	}
	for g, keys := range diagnosticKeys {
		for _, k := range keys {
			diagnostic[g+"."+k] = true
		}
	}
	for _, p := range versionedParameters {
		versioned[p.group+"."+p.key] = p.since
	}
	keys := coverageFieldKeys()
	items := make([]dictionaryField, 0, len(keys))
	for _, key := range keys {
		// Static parameters started with schema 2; schema 1 metrics are status-only.
		row := dictionaryField{Key: key, Unit: fieldUnits[key]}
		switch {
		case legacy[key]:
			row.MinSchema = 2
		case diagnostic[key]:
			row.MinSchema = 3
		default:
			row.MinSchema, row.SinceFieldSet = 4, versioned[key]
		}
		items = append(items, row)
	}
	return items
}

func (_ server) fieldDictionary(w http.ResponseWriter, _ *http.Request) {
	send(w, http.StatusOK, map[string]any{
		"schemaVersion": 1, "latestFieldSet": latestFieldSet, "items": dictionary(),
		"readingStates": []string{"AVAILABLE", "RESTRICTED", "UNAVAILABLE", "ERROR"},
		"dynamic":       map[string]any{"pattern": "^system\\.partition_[a-z0-9_]{1,32}$", "minSchemaVersion": 4, "sinceFieldSet": 7, "maxPerReport": 24},
	})
}

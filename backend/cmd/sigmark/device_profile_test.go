package main

import "testing"

func profileField(group, key, value string) Parameter {
	return Parameter{Group: group, Key: key, Value: &value, Source: "fixture", Status: "AVAILABLE"}
}

func TestDeviceProfileLabels(t *testing.T) {
	const hit, no, unknown = "hit", "not_observed", "insufficient"
	hw := profileField("cpu", "hardware", "qcom")
	device := profileField("system", "device", "dipper")
	product := profileField("system", "product", "dipper")
	denied := profileField("system", "selinux", "Permissive（宽容模式）") // ignore even a stray value on a rejected read
	errno := 13
	denied.Status, denied.Errno, denied.Reason = "RESTRICTED", &errno, "ACCESS_DENIED"
	cases := []struct {
		name  string
		input []Parameter
		want  [3]string
	}{
		{"empty archive", nil, [3]string{unknown, unknown, unknown}},
		{"partial declarations", []Parameter{hw, device}, [3]string{unknown, unknown, unknown}},
		{"field names are scoped", []Parameter{hw, device, profileField("other", "product", "ranchu")}, [3]string{unknown, unknown, unknown}},
		{"unknown value is missing evidence", []Parameter{hw, device, profileField("system", "product", " UnKnOwN ")}, [3]string{unknown, unknown, unknown}},
		{"explicit declaration suffices", []Parameter{profileField("cpu", "hardware", " RANCHU ")}, [3]string{hit, unknown, unknown}},
		{"configuration may declare an emulator product", []Parameter{hw, device, profileField("system", "product", "sdk_gphone64_x86_64")}, [3]string{hit, unknown, unknown}},
		{"three nonmatching declarations", []Parameter{hw, device, product}, [3]string{no, unknown, unknown}},
		{"custom build and empty SIM do not classify a physical target", []Parameter{hw, device, product,
			profileField("system", "type", "userdebug"), profileField("environment", "flashLock", "0"),
			profileField("cellular", "simState", "无卡"), profileField("sensors", "count", "0")}, [3]string{no, unknown, unknown}},
		{"irrelevant build characteristics", []Parameter{profileField("app", "appDebuggable", "是"), profileField("cpu", "abis", "x86_64"), denied}, [3]string{unknown, unknown, unknown}},
		{"unexpected mode vocabulary", []Parameter{profileField("system", "selinux", "not recorded"), profileField("app", "debuggerConnected", "?")}, [3]string{unknown, unknown, unknown}},
		{"explicit positive", []Parameter{profileField("system", "selinux", "Permissive（宽容模式）"), profileField("app", "debuggerConnected", "是")}, [3]string{unknown, hit, hit}},
		{"explicit negative", []Parameter{profileField("system", "selinux", "Enforcing（强制模式）"), profileField("app", "debuggerConnected", "否")}, [3]string{unknown, no, no}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := profileSignals(c.input)
			if len(got) != len(c.want) {
				t.Fatal(got)
			}
			for i, w := range c.want {
				if got[i].State != w {
					t.Errorf("%s = %s, want %s", got[i].Code, got[i].State, w)
				}
			}
		})
	}
	labels := profileSignals([]Parameter{denied})
	e := labels[1].Evidence[0]
	if e.Status != "RESTRICTED" || e.Errno == nil || *e.Errno != 13 || e.Value != "" || e.Source != "fixture" || e.Reason != "ACCESS_DENIED" {
		t.Errorf("rejected observation lost provenance or retained a value: %+v", e)
	}
	if e := labels[2].Evidence[0]; e.Key != "app.debuggerConnected" || e.Status != "NOT_ARCHIVED" {
		t.Errorf("missing archived field: %+v", e)
	}
}

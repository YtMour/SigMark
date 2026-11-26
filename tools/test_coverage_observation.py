import unittest
from subprocess import CompletedProcess
from unittest.mock import patch

from coverage_observation import battery_values, collect, sysfs_tenths


class SelinuxObservationTest(unittest.TestCase):
    def test_reads_mode_without_collecting_additional_device_fields(self):
        responses = [("device", 0), ("Test phone", 0), ("Enforcing", 0)]
        with patch("coverage_observation.subprocess.run") as run:
            run.side_effect = [CompletedProcess([], code, stdout) for stdout, code in responses]
            report = collect(["adb", "-s", "fixture"], selinux_only=True)
        self.assertEqual([c.args[0][3:] for c in run.call_args_list],
                         [["get-state"], ["shell", "getprop", "ro.product.model"], ["shell", "getenforce"]])
        self.assertEqual(report["schema"], "sigmark-adb-evidence/1")
        self.assertEqual(report["observer"], "ADB_SHELL")
        self.assertEqual({key: value for key, value in report["readings"].items() if value is not None},
                         {"system.selinux": "Enforcing"})

    def test_failed_system_read_stays_null(self):
        with patch("coverage_observation.subprocess.run") as run:
            run.side_effect = [CompletedProcess([], 0, "device"), CompletedProcess([], 0, "Test phone"),
                               CompletedProcess([], 1, "Disabled")]
            report = collect(["adb", "-s", "fixture"], selinux_only=True)
        self.assertIsNone(report["readings"]["system.selinux"])


class ExtendedObservationTest(unittest.TestCase):
    def test_optional_identity_and_failed_reads_preserve_other_fields(self):
        outputs = {
            ("get-state",): (0, "device"),
            ("shell", "getprop", "ro.product.model"): (0, "unknown"),
            ("shell", "getprop", "ro.product.device"): (0, "Example_Pro"),
            ("shell", "getprop", "ro.product.first_api_level"): (0, "0"),
            ("shell", "getenforce"): (1, "Permission denied"),
            ("shell", "dumpsys", "battery"): (0, "voltage: 4105\ntemperature: 260"),
        }

        def fake_run(command, **_):
            code, stdout = outputs.get(tuple(command[3:]), (1, "Not supported"))
            return CompletedProcess(command, code, stdout)

        with patch("coverage_observation.subprocess.run", side_effect=fake_run):
            report = collect(["adb", "-s", "test-device"])
        self.assertEqual(report["schema"], "sigmark-adb-evidence/6")
        self.assertIsNone(report["model"])
        self.assertEqual(report["readings"]["system.device"], "Example_Pro")
        self.assertIsNone(report["readings"]["system.initialSdk"])
        self.assertIsNone(report["readings"]["system.selinux"])
        self.assertEqual(report["readings"]["battery.voltage"], "4105")
        self.assertNotIn("test-device", str(report))


class BatteryValuesTest(unittest.TestCase):
    def test_only_explicit_allowlisted_values(self):
        self.assertEqual(
            battery_values("Current Battery Service state:\n  voltage: 4119\n  temperature: 280\n  level: 78\n  serial: private"),
            {"battery.temperature": "280", "battery.voltage": "4119"},
        )

    def test_ambiguous_or_out_of_range(self):
        self.assertEqual(
            battery_values("temperature: 280\ntemperature: 290\nvoltage: -1"),
            {"battery.temperature": None, "battery.voltage": None},
        )


class SysfsTemperatureTest(unittest.TestCase):
    def test_driver_tenths_are_bounded_and_exact(self):
        self.assertEqual(sysfs_tenths("265\n"), "265")
        self.assertEqual(sysfs_tenths("-50"), "-50")
        self.assertEqual(sysfs_tenths("1200"), "1200")

    def test_denied_missing_and_malformed_nodes_stay_null(self):
        for raw in ("", "Permission denied", "0265", "265\n266", "1201", "-501", "265.0"):
            self.assertIsNone(sysfs_tenths(raw), raw)


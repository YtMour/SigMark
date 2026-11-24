import unittest

from coverage_observation import battery_values, sysfs_tenths


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


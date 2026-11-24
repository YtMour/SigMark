import unittest

from root_observation import battery_tenths, policy_digest, valid_property


class PolicyDigestTest(unittest.TestCase):
    def test_sha256sum_line_is_parsed(self):
        hex64 = "b" * 64
        self.assertEqual(policy_digest(hex64 + "  /sys/fs/selinux/policy"), "sha256:" + hex64)
        self.assertEqual(policy_digest(hex64 + " *policy"), "sha256:" + hex64)

    def test_other_outputs_are_rejected(self):
        for raw in ("", "Permission denied", "ABC" * 20, "b" * 63, "sha256:" + "b" * 64):
            self.assertIsNone(policy_digest(raw), raw)


class RootReadingTest(unittest.TestCase):
    def test_battery_tenths_bounds(self):
        self.assertEqual(battery_tenths("265"), "265")
        self.assertEqual(battery_tenths("-50"), "-50")
        for raw in ("", "1201", "-501", "0265", "265.0"):
            self.assertIsNone(battery_tenths(raw), raw)

    def test_property_placeholders_are_absent(self):
        pattern = r"[a-z0-9_.-]{1,32}"
        self.assertEqual(valid_property(pattern, "mt6985"), "mt6985")
        for raw in (None, "unknown", "NULL", "MT6985", "bad value"):
            self.assertIsNone(valid_property(pattern, raw), raw)

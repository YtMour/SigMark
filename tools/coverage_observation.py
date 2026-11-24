"""Emit a local, allowlisted comparison file from one connected test device.

Uses the device's existing ADB shell diagnostics; no app privileges are changed.
Never serializes ADB selector, full command output, or protected node contents.
"""
import argparse
from datetime import datetime, timezone
import json
import re
import subprocess
from pathlib import Path


FIELDS = {
    "system.patch": ("ro.build.version.security_patch", r"\d{4}-\d{2}-\d{2}"),
    "system.vendorSpl": ("ro.vendor.build.security_patch", r"\d{4}-\d{2}-\d{2}"),
    "environment.verifiedBoot": ("ro.boot.verifiedbootstate", r"green|yellow|orange|red"),
    "environment.flashLock": ("ro.boot.flash.locked", r"0|1"),
    "environment.vbmetaState": ("ro.boot.vbmeta.device_state", r"locked|unlocked"),
    # Field set 17. These are the same keys the app archives, but observed by the
    # shell domain; the panel keeps both identities apart and never fills the app row.
    "system.bootloader": ("ro.bootloader", r"[A-Za-z0-9._+\- ]{1,80}"),
    "environment.verityMode": ("ro.boot.veritymode", r"[a-z0-9_.-]{1,32}"),
    "environment.buildDebuggable": ("ro.debuggable", r"0|1"),
    # Field set 19 identity declarations; shell view only, compared side by side.
    "system.boardPlatform": ("ro.board.platform", r"[a-z0-9_.-]{1,32}"),
    "system.bootHardware": ("ro.boot.hardware", r"[a-z0-9_.-]{1,32}"),
    "system.hardwareSku": ("ro.boot.hardware.sku", r"[A-Za-z0-9._-]{1,32}"),
}

SYSFS_BATTERY_TEMP = ("/sys/class/power_supply/battery/temp", "/sys/class/power_supply/bms/temp")


def sysfs_tenths(raw):
    """Parse one power_supply temp node (0.1 °C) through format and range checks."""
    text = raw.strip()
    if not re.fullmatch(r"0|-?[1-9][0-9]{0,3}", text):
        return None
    value = int(text)
    return str(value) if -500 <= value <= 1200 else None


def battery_values(raw):
    limits = {"temperature": (-500, 1200), "voltage": (1000, 15000)}
    values = {}
    for label, bounds in limits.items():
        matches = re.findall(r"^\s*" + label + r":\s*(-?[0-9]{1,5})\s*$", raw, re.M)
        n = int(matches[0]) if len(matches) == 1 else None
        values["battery."+label] = str(n) if n is not None and bounds[0] <= n <= bounds[1] else None
    return values


def collect(adb):
    def capture(*args):
        try:
            result = subprocess.run([*adb, *args], capture_output=True, text=True, encoding="utf8",
                                    errors="replace", timeout=5, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return ""
        return result.stdout.strip() if result.returncode == 0 else ""

    if capture("get-state") != "device":
        raise ValueError("Select a connected ADB test device.")
    model = capture("shell", "getprop", "ro.product.model")
    if not model or len(model) > 100 or not model.isprintable():
        raise ValueError("No valid model was returned by the device.")
    start = datetime.now(timezone.utc)
    readings = {}
    for key, (prop, pattern) in FIELDS.items():
        value = capture("shell", "getprop", prop)
        valid = re.fullmatch(pattern, value, re.ASCII) is not None
        # "unknown"/"null" are placeholders, not readings (the App normalizes them away).
        readings[key] = value if valid and value.lower() not in {"unknown", "null"} else None
    mode = capture("shell", "getenforce")
    readings["system.selinux"] = mode if mode in {"Enforcing", "Permissive", "Disabled"} else None
    # 'dumpsys battery' without arguments is a read-only service query.
    battery = capture("shell", "dumpsys", "battery")
    # When Android reports that BatteryService updates are stopped, these
    # values may be test overrides instead of current observations.
    readings.update(battery_values(battery if "UPDATES STOPPED" not in battery.upper() else ""))
    # The driver node is refused to untrusted_app; shell may still read it (and on
    # some ROMs even shell is denied, in which case the value stays null).
    node = None
    for path in SYSFS_BATTERY_TEMP:
        node = sysfs_tenths(capture("shell", "cat", path))
        if node is not None:
            break
    readings["battery.sysBatteryTemp"] = node
    return {"schema": "sigmark-adb-evidence/4", "observer": "ADB_SHELL", "model": model,
            "observedAtEpochMs": int(start.timestamp() * 1000), "readings": readings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True, help="Connected test device selected in adb devices.")
    parser.add_argument("--output", required=True, type=Path, help="New local JSON filename.")
    args = parser.parse_args()
    try:
        value = collect(["adb", "-s", args.serial])
        with args.output.open("x", encoding="utf8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    except (ValueError, OSError) as err:
        parser.exit(2, f"{err}\n")


if __name__ == "__main__":
    main()

"""Emit a root-view observation file for one connected test device.

This is an opt-in external channel, not something the App can read. It needs a
rooted device (or a shell where `su -c` works), and the result is always kept
apart from the App archive: the panel shows it as `ROOT`, never fills an App
field and never changes a risk label.

The file contains only the allowlisted readings below. It never includes serial
numbers, account data, app lists or arbitrary file contents.
"""
import argparse
from datetime import datetime, timezone
import json
import re
import subprocess
from pathlib import Path

PROPERTIES = {
    "system.patch": ("ro.build.version.security_patch", r"\d{4}-\d{2}-\d{2}"),
    "system.vendorSpl": ("ro.vendor.build.security_patch", r"\d{4}-\d{2}-\d{2}"),
    "environment.verifiedBoot": ("ro.boot.verifiedbootstate", r"green|yellow|orange|red"),
    "environment.flashLock": ("ro.boot.flash.locked", r"0|1"),
    "environment.vbmetaState": ("ro.boot.vbmeta.device_state", r"locked|unlocked"),
    "environment.verityMode": ("ro.boot.veritymode", r"[a-z0-9_.-]{1,32}"),
    "environment.buildDebuggable": ("ro.debuggable", r"0|1"),
    "system.bootloader": ("ro.bootloader", r"[A-Za-z0-9._+\- ]{1,80}"),
    "system.boardPlatform": ("ro.board.platform", r"[a-z0-9_.-]{1,32}"),
    "system.bootHardware": ("ro.boot.hardware", r"[a-z0-9_.-]{1,32}"),
    "system.hardwareSku": ("ro.boot.hardware.sku", r"[A-Za-z0-9._-]{1,32}"),
}
SYSFS_BATTERY_TEMP = ("/sys/class/power_supply/battery/temp", "/sys/class/power_supply/bms/temp")
POLICY_PATH = "/sys/fs/selinux/policy"


def policy_digest(raw):
    """Return `sha256:<hex>` from a `sha256sum` line, or None."""
    match = re.match(r"^([0-9a-f]{64})\s+", raw.strip())
    return "sha256:" + match.group(1) if match else None


def battery_tenths(raw):
    text = raw.strip()
    if not re.fullmatch(r"0|-?[1-9][0-9]{0,3}", text):
        return None
    value = int(text)
    return str(value) if -500 <= value <= 1200 else None


def valid_property(pattern, value):
    if value is None or value.lower() in {"unknown", "null"}:
        return None
    return value if re.fullmatch(pattern, value, re.ASCII) else None


def collect(adb, root):
    def run(*command):
        try:
            result = subprocess.run([*adb, *command], capture_output=True, text=True,
                                    encoding="utf8", errors="replace", timeout=8, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return ""
        return result.stdout.strip() if result.returncode == 0 else ""

    def capture(*command):
        # One shell string: `su -c 'getprop ro.x'` needs the command as a single argument.
        return run("shell", root + " " + " ".join(command))

    if run("get-state") != "device":
        raise ValueError("Select a connected ADB test device.")
    model = capture("getprop", "ro.product.model")
    if not model or len(model) > 100 or not model.isprintable():
        raise ValueError("No valid model was returned by the device.")
    start = datetime.now(timezone.utc)
    readings = {}
    for key, (prop, pattern) in PROPERTIES.items():
        readings[key] = valid_property(pattern, capture("getprop", prop) or None)
    mode = capture("getenforce")
    if mode not in {"Enforcing", "Permissive", "Disabled"}:
        raise ValueError("root view did not return a SELinux mode; check su and the policy.")
    readings["system.selinux"] = mode
    readings["system.selinuxPolicy"] = policy_digest(capture("sha256sum", POLICY_PATH))
    if not readings["system.selinuxPolicy"]:
        raise ValueError("root view could not hash the SELinux policy; check su and the policy.")
    node = None
    for path in SYSFS_BATTERY_TEMP:
        node = battery_tenths(capture("cat", path))
        if node is not None:
            break
    readings["battery.sysBatteryTemp"] = node
    return {"schema": "sigmark-adb-evidence/5", "observer": "ROOT", "model": model,
            "observedAtEpochMs": int(start.timestamp() * 1000), "readings": readings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True, help="Connected test device selected in adb devices.")
    parser.add_argument("--output", required=True, type=Path, help="New local JSON filename.")
    parser.add_argument("--su", default="su -c",
                        help="Command prefix that yields root (default: 'su -c').")
    args = parser.parse_args()
    try:
        value = collect(["adb", "-s", args.serial], args.su)
        with args.output.open("x", encoding="utf8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    except (ValueError, OSError) as err:
        parser.exit(2, f"{err}\n")


if __name__ == "__main__":
    main()

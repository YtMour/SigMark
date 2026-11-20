"""Capture a local report from Android's connected ADB shell."""
import argparse
from datetime import datetime, timezone
import json
import subprocess


def observe(adb, argument, accepted=None):
    source = "adb shell " + " ".join(argument)
    value = None
    try:
        process = subprocess.run([*adb, "shell", *argument], capture_output=True,
                                 text=True, encoding="utf-8", errors="replace", timeout=6)
        output = process.stdout.strip()
        if process.returncode != 0:
            status = "ERROR"
            detail = "ADB shell returned nonzero exit status."
        elif not output or (accepted is not None and output not in accepted):
            status = "UNAVAILABLE"
            detail = "Shell emitted no recognized value."
        else:
            status, value, detail = "AVAILABLE", output[:200], None
    except (OSError, subprocess.TimeoutExpired) as error:
        status, detail = "ERROR", type(error).__name__
    return dict(source=source, status=status, value=value, detail=detail)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", help="ADB serial when more than one test device is connected")
    args = parser.parse_args()
    adb = ["adb", "-s", args.serial] if args.serial else ["adb"]
    try:
        connected = subprocess.run([*adb, "get-state"], capture_output=True, text=True, timeout=6)
    except (OSError, subprocess.TimeoutExpired):
        parser.exit(2, "ADB is unavailable or timed out.\n")
    if connected.returncode != 0 or connected.stdout.strip() != "device":
        parser.exit(2, "Select a connected, authorized ADB device.\n")
    rows = {
        "selinux": observe(adb, ["getenforce"], {"Enforcing", "Permissive", "Disabled"}),
        "androidApi": observe(adb, ["getprop", "ro.build.version.sdk"]),
        "buildType": observe(adb, ["getprop", "ro.build.type"]),
        "verifiedBoot": observe(adb, ["getprop", "ro.boot.verifiedbootstate"]),
    }
    print(json.dumps(dict(schemaVersion=1, observer="ADB_SHELL",
                          capturedAt=datetime.now(timezone.utc).isoformat(), observations=rows), indent=2))


if __name__ == "__main__":
    main()

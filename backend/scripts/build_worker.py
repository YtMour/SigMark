"""Queue worker and artifact registration for the SigMark Android build host."""
import argparse
from contextlib import contextmanager
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
from threading import Event, Thread
import time
from urllib.parse import urlsplit
import uuid

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
DATA = BACKEND / "build-data"
CATALOG = BACKEND / "build-catalog" / "versions.json"
SNAPSHOTS = CATALOG.parent / "snapshots"
COMMIT = re.compile(r"[a-f0-9]{40}")
BUILD_ID = re.compile(r"[a-f0-9]{32}")
SELECTION = re.compile(r"[\w./-]{1,100}")
ENV_KEYS = (
    "PATH", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT",
    "TEMP", "TMP", "TMPDIR", "LOCALAPPDATA", "APPDATA", "JAVA_HOME",
    "ANDROID_HOME", "ANDROID_SDK_ROOT", "GRADLE_USER_HOME", "LANG",
)


def atomic_json(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, mode="w", encoding="utf-8") as out:
        tmp = Path(out.name)
        json.dump(data, out, ensure_ascii=False)
    try:
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def git_output(*args):
    return subprocess.check_output(["git", "-C", str(REPO), *args], text=True, timeout=30).strip()


def origin_arg(value):
    import ipaddress
    try:
        u = urlsplit(value)
        ip = ipaddress.IPv4Address(u.hostname)
        ranges = ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
        if (u.scheme == "http" and ip.compressed == u.hostname and u.port
                and value == f"http://{ip}:{u.port}"
                and (ip.compressed == "127.0.0.1" or any(ip in ipaddress.ip_network(r) for r in ranges))):
            return value
    except (ValueError, TypeError, AttributeError):
        pass
    raise argparse.ArgumentTypeError("Use an HTTP private IPv4 origin with an explicit port.")


def approve(ref, name):
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    if not SELECTION.fullmatch(ref) or ref.startswith("-"):
        raise ValueError("Use a local ref, tag or commit.")
    commit = git_output("rev-parse", "--verify", ref + "^{commit}")
    gradle = git_output("show", commit + ":app/build.gradle.kts")
    register_source(commit, name, gradle)
    print("Approved", commit)


def register_source(source_id, name, gradle, **extra):
    if not name.strip() or len(name) > 80 or any(ord(c) < 32 for c in name):
        raise ValueError("Invalid source display name.")
    items = json.loads(CATALOG.read_text(encoding="utf-8")) if CATALOG.is_file() else []
    version = re.search(r'(?m)^\s*versionName\s*=\s*"([0-9.]+)"', gradle)
    entry = dict(name=name.strip(), commit=source_id, profiles="SIGMARK_BUILD_PROFILE_V1" in gradle, **extra)
    if version:
        entry["version"] = version.group(1)
    atomic_json(CATALOG, [entry] + [
        i for i in items if i["commit"] != source_id and i["name"] != name.strip()
    ][:49])


def snapshot(name):
    """Explicitly register a frozen copy of local Android build inputs, not the working tree itself."""
    paths = (
        "app/src", "app/build.gradle.kts", "gradle/wrapper", "gradle/libs.versions.toml",
        "build.gradle.kts", "settings.gradle.kts", "gradle.properties", "gradlew", "gradlew.bat",
    )
    picked = subprocess.check_output(["git", "-C", str(REPO), "ls-files", "-z", "--cached", "--others",
                                      "--exclude-standard", "--", *paths], timeout=30).decode("utf-8").split("\0")
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    total = 0
    gradle = None
    with tempfile.TemporaryDirectory(dir=SNAPSHOTS) as scratch:
        temp = Path(scratch) / "source.tar"
        with tarfile.open(temp, "w") as archive:
            for path in sorted(set(picked) - {""}):
                relative = Path(path)
                if (relative.is_absolute() or ".." in relative.parts or relative.name == "local.properties"
                        or relative.name.startswith(".env") or relative.suffix.lower() in {".jks", ".keystore", ".p12", ".pem"}):
                    raise ValueError("Unexpected private file among Android build inputs.")
                file = REPO / path
                if not file.exists():
                    continue  # An intentional deletion in the local source.
                if not file.is_file() or file.resolve() != file.absolute():
                    raise ValueError("Only regular checkout files are supported.")
                size = file.stat().st_size
                if total + size > 96 * 1024 * 1024:
                    raise ValueError("Source snapshot exceeds size limit.")
                data = file.read_bytes()
                total += len(data)
                if total > 96 * 1024 * 1024:
                    raise ValueError("Source snapshot exceeds size limit.")
                info = tarfile.TarInfo(path)
                info.size, info.mode = len(data), (0o755 if path == "gradlew" else 0o644)
                archive.addfile(info, io.BytesIO(data))
                if path == "app/build.gradle.kts":
                    gradle = data.decode("utf-8")
        if not gradle:
            raise ValueError("Android build configuration was not included.")
        with temp.open("rb") as file:
            digest = hashlib.file_digest(file, "sha256").hexdigest()
        destination = SNAPSHOTS / (digest + ".tar")
        if not destination.exists():
            temp.replace(destination)
        register_source(digest[:40], name, gradle, snapshotSha256=digest)
        print("Registered source snapshot", digest)


def android_tools():
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not sdk:
        raise RuntimeError("ANDROID_HOME is required")
    tools = Path(sdk) / "build-tools" / "36.0.0"
    return tools / ("aapt.exe" if os.name == "nt" else "aapt"), tools / ("apksigner.bat" if os.name == "nt" else "apksigner")


def register_artifact(folder, job, apk, origin):
    aapt, signer = android_tools()
    result = subprocess.check_output([str(aapt), "dump", "badging", str(apk)], text=True, encoding="utf-8", errors="replace", timeout=20)
    version = re.search(r"(?m)^package: name='com\.sigmark\.app' versionCode='([0-9]+)' versionName='([0-9.]+)'", result)
    if not version or "application-debuggable" not in result:
        raise ValueError("Expected a SigMark Android debug APK.")
    profile = job.get("profile") or {}
    if profile.get("version") and (version.group(2) != profile["version"]
            or int(version.group(1)) != profile["versionCode"]):
        raise ValueError("APK version does not match its requested profile.")
    verified = subprocess.check_output([str(signer), "verify", "--print-certs", str(apk)],
                                        text=True, encoding="utf-8", errors="replace", timeout=30)
    cert = re.search(r"(?im)^Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})$", verified)
    if cert is None or re.search(r"(?m)^Signer #2 certificate SHA-256", verified):
        raise ValueError("Expected one verified APK signer.")
    import shutil
    size = apk.stat().st_size
    if not 0 < size <= 128 * 1024 * 1024:
        raise ValueError("APK size outside supported range.")
    target = folder / "sigmark.apk"
    with apk.open("rb") as src:
        sha = hashlib.file_digest(src, "sha256").hexdigest()
        src.seek(0)
        with target.open("xb") as dst:
            shutil.copyfileobj(src, dst)
    job.update(state="succeeded", version=version.group(2), versionCode=int(version.group(1)), sha256=sha, size=size,
               origin=origin, signerSha256=cert.group(1).lower())
    atomic_json(folder / "job.json", job)
    print("Artifact ready", job["id"], job["version"], sha)


def process(folder, job, origin):
    job.update(state="running")
    atomic_json(folder / "job.json", job)
    try:
        commit = job["commit"]
        allowed = {item["commit"]: item for item in json.loads(CATALOG.read_text(encoding="utf-8"))}
        if not COMMIT.fullmatch(commit) or commit not in allowed:
            raise ValueError("Source revision is no longer approved.")
        environment = {key: os.environ[key] for key in ENV_KEYS if key in os.environ}
        profile = job.get("profile") or {}
        name, code = profile.get("version", ""), profile.get("versionCode", 0)
        if name or code:
            if (not allowed[commit].get("profiles") or not isinstance(name, str)
                    or not re.fullmatch(r"[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}", name)
                    or type(code) is not int or not 0 < code <= 2_100_000_000):
                raise ValueError("Invalid version profile.")
        with tempfile.TemporaryDirectory(prefix="sigmark-build-") as scratch:
            scratch = Path(scratch)
            export = scratch / "src.tar"
            src = scratch / "src"
            src.mkdir()
            digest = allowed[commit].get("snapshotSha256")
            if digest is not None:
                import shutil
                if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or digest[:40] != commit:
                    raise ValueError("Invalid source snapshot ID.")
                shutil.copyfile(SNAPSHOTS / (digest + ".tar"), export)
                with export.open("rb") as file:
                    if hashlib.file_digest(file, "sha256").hexdigest() != digest:
                        raise ValueError("Source snapshot checksum mismatch.")
            else:
                subprocess.run(["git", "-C", str(REPO), "archive", "--format=tar", "--output", str(export), commit],
                               check=True, timeout=60)
            with tarfile.open(export) as archive:
                archive.extractall(src, filter="data")
            args = [f"-PSIGMARK_LAN_URL={origin}", ":app:assembleDebug", "--no-daemon", "--console=plain"]
            if name:
                args += [f"-PSIGMARK_VERSION_NAME={name}", f"-PSIGMARK_VERSION_CODE={code}"]
            if profile.get("checks") is True:
                args += [":app:testDebugUnitTest", ":app:lintDebug"]
            wrapper = [str(src / "gradlew.bat")] if os.name == "nt" else ["sh", str(src / "gradlew")]
            with (folder / "build.log").open("wb") as log:
                subprocess.run(wrapper + args, cwd=src, env=environment, stdout=log,
                               stderr=subprocess.STDOUT, check=True, timeout=900)
            register_artifact(folder, job, src / "app/build/outputs/apk/debug/app-debug.apk", origin)
    except Exception as exc:
        job.update(state="failed", message="构建失败，详见构建主机 build.log（" + type(exc).__name__ + "）。")
        atomic_json(folder / "job.json", job)
        print("Build failed", job["id"], type(exc).__name__, flush=True)


@contextmanager
def worker_lock():
    with (DATA / "worker.lock").open("a+b") as lock:
        lock.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def work(origin, once):
    while True:
        for folder in sorted((DATA / "jobs").iterdir()):
            if not BUILD_ID.fullmatch(folder.name) or not folder.is_dir():
                continue
            try:
                job = json.loads((folder / "job.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if job.get("state") == "running":
                job.update(state="failed", message="上次构建工作进程中断，可重新提交。")
                atomic_json(folder / "job.json", job)
            if job.get("state") != "queued" or job.get("id") != folder.name:
                continue
            process(folder, job, origin)
        if once:
            return
        time.sleep(2)


@contextmanager
def report_worker_presence():
    stopped = Event()
    heartbeat = DATA / "worker-heartbeat.json"

    def tick():
        while not stopped.is_set():
            atomic_json(heartbeat, datetime.datetime.now(datetime.UTC).isoformat())
            stopped.wait(4)

    thread = Thread(target=tick, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stopped.set()
        thread.join()
        heartbeat.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    approve_cmd = sub.add_parser("approve")
    approve_cmd.add_argument("ref")
    approve_cmd.add_argument("name")
    snapshot_cmd = sub.add_parser("snapshot")
    snapshot_cmd.add_argument("name")
    worker = sub.add_parser("work")
    worker.add_argument("--origin", type=origin_arg, required=True)
    worker.add_argument("--once", action="store_true")
    publish = sub.add_parser("import-apk")
    publish.add_argument("file", type=Path)
    publish.add_argument("--origin", type=origin_arg, required=True)
    publish.add_argument("--name", default="本地验证 APK")
    publish.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    (DATA / "jobs").mkdir(parents=True, exist_ok=True)
    if args.command == "approve":
        approve(args.ref, args.name)
    elif args.command == "snapshot":
        snapshot(args.name)
    elif args.command == "work":
        with worker_lock(), report_worker_presence():
            work(args.origin, args.once)
    else:
        id_ = uuid.uuid4().hex
        folder = DATA / "jobs" / id_
        folder.mkdir()
        job = dict(id=id_, name=args.name, commit="", state="importing",
                   createdAt=datetime.datetime.now(datetime.UTC).isoformat())
        register_artifact(folder, job, args.file.resolve(), args.origin)
        if args.publish:
            current = DATA / "current.json"
            if current.exists():
                old_id = json.loads(current.read_text(encoding="utf-8"))
                if not re.fullmatch(r"[a-f0-9]{32}", old_id):
                    raise ValueError("Invalid current publication.")
                old = json.loads((DATA / "jobs" / old_id / "job.json").read_text(encoding="utf-8"))
                if job["versionCode"] <= old.get("versionCode",0) or (old.get("signerSha256") and old["signerSha256"] != job["signerSha256"]):
                    raise ValueError("Publication must advance versionCode with the same signer.")
                if re.fullmatch(r"[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}", old.get("version","")) and re.fullmatch(r"[a-f0-9]{64}",old.get("signerSha256","")):
                    history = DATA / "published-signers"
                    history.mkdir(exist_ok=True)
                    atomic_json(history / f"{old['version']}-{int(old['versionCode'])}.json", old["signerSha256"])
            atomic_json(DATA / "current.json", id_)


if __name__ == "__main__":
    main()

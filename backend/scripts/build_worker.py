"""Queue worker and artifact registration for the SigMark Android build host."""
import argparse
from contextlib import contextmanager
import datetime
import hashlib
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
    if not COMMIT.fullmatch(commit) or not name.strip() or len(name) > 80 or any(ord(c) < 32 for c in name):
        raise ValueError("Invalid commit or display name.")
    items = json.loads(CATALOG.read_text(encoding="utf-8")) if CATALOG.is_file() else []
    atomic_json(CATALOG, [{"name": name.strip(), "commit": commit}] + [
        i for i in items if i["commit"] != commit and i["name"] != name.strip()
    ][:49])
    print("Approved", commit)


def android_tools():
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not sdk:
        raise RuntimeError("ANDROID_HOME is required")
    tools = Path(sdk) / "build-tools" / "36.0.0"
    return tools / ("aapt.exe" if os.name == "nt" else "aapt"), tools / ("apksigner.bat" if os.name == "nt" else "apksigner")


def register_artifact(folder, job, apk, origin):
    aapt, signer = android_tools()
    result = subprocess.check_output([str(aapt), "dump", "badging", str(apk)], text=True, encoding="utf-8", errors="replace", timeout=20)
    version = re.search(r"(?m)^package: name='com\.sigmark\.app' .+?versionName='([0-9.]+)'", result)
    if not version or "application-debuggable" not in result:
        raise ValueError("Expected a SigMark Android debug APK.")
    subprocess.run([str(signer), "verify", str(apk)], check=True, timeout=30, stdout=subprocess.DEVNULL)
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
    job.update(state="succeeded", version=version.group(1), sha256=sha, size=size, origin=origin)
    atomic_json(folder / "job.json", job)
    print("Artifact ready", job["id"], job["version"], sha)


def process(folder, job, origin):
    job.update(state="running")
    atomic_json(folder / "job.json", job)
    try:
        commit = job["commit"]
        allowed = {item["commit"] for item in json.loads(CATALOG.read_text(encoding="utf-8"))}
        if not COMMIT.fullmatch(commit) or commit not in allowed:
            raise ValueError("Source revision is no longer approved.")
        environment = {key: os.environ[key] for key in ENV_KEYS if key in os.environ}
        with tempfile.TemporaryDirectory(prefix="sigmark-build-") as scratch:
            scratch = Path(scratch)
            export = scratch / "src.tar"
            src = scratch / "src"
            src.mkdir()
            subprocess.run(["git", "-C", str(REPO), "archive", "--format=tar", "--output", str(export), commit],
                           check=True, timeout=60)
            with tarfile.open(export) as archive:
                archive.extractall(src, filter="data")
            args = [f"-PSIGMARK_LAN_URL={origin}", ":app:assembleDebug", "--no-daemon", "--console=plain"]
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
            atomic_json(DATA / "current.json", id_)


if __name__ == "__main__":
    main()

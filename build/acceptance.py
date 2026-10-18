#!/usr/bin/env python3
"""Release acceptance gate for the installed 可爱大肥鱼桌宠 build.

Every check below maps to a user-visible promise. A release may only be uploaded
after this gate passes on a freshly installed copy.

Usage:
    python build/acceptance.py                       # reuse a running instance if healthy
    python build/acceptance.py --fresh               # stop, start, test, stop
    python build/acceptance.py --install-dir D:\\x   # explicit install root
    python build/acceptance.py --json out.json       # machine-readable report

Exit code 0 only when every required check passed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_INSTALL = None  # resolved from the uninstall registry key unless --install-dir is given
APP_ID = "BlueHairMaid"
OLLAMA_API = "http://127.0.0.1:11434"
VISION_RE = re.compile(r"(vl|vision|llava|minicpm-?v|moondream|pixtral|internvl|gemma3|llama3\.2-vision)", re.I)


def installed_dir() -> Path:
    """Read InstallLocation from the per-user uninstall key (no hard-coded paths)."""
    import winreg

    with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                        rf"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{APP_ID}") as key:
        location, _ = winreg.QueryValueEx(key, "InstallLocation")
    return Path(location)


# ---------------------------------------------------------------- helpers
def http(url: str, data=None, token: str | None = None, timeout: float = 20.0):
    headers = {}
    body = None
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8", "replace")


def http_json(url: str, data=None, token=None, timeout: float = 20.0):
    status, text = http(url, data=data, token=token, timeout=timeout)
    return status, json.loads(text)


def wait_until(fn, timeout: float, interval: float = 0.5, desc: str = ""):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            value = fn()
            if value:
                return value
        except Exception as exc:  # noqa: BLE001 - probe loop
            last = exc
        time.sleep(interval)
    raise TimeoutError(f"timeout waiting for {desc or fn} (last error: {last})")


def clean_env(install: Path, user_root: Path) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("DSH_") and k != "ELECTRON_RUN_AS_NODE"}
    env["DSH_HOME"] = str(user_root)
    env["DSH_PET_ELECTRON_PATH"] = str(install / "electron" / "electron.exe")
    env["ELECTRON_RUN_AS_NODE"] = "1"
    speech = install / "speech"
    env["DSH_SPEECH_DIR"] = str(speech)
    env["DSH_PET_SHERPA_ADDON"] = str(speech / "sherpa" / "sherpa-onnx.node")
    env["DSH_PET_SILERO_MODEL"] = str(speech / "sensevoice" / "models" / "silero" / "silero_vad.onnx")
    env["DSH_PET_NODE"] = str(install / "node" / "bin" / "node.exe")
    return env


class Gate:
    def __init__(self, install: Path, user_root: Path, seed_local_model: bool = False):
        self.install = install
        self.user_root = user_root
        self.data_root = user_root / "dsh-pet"
        self.results: list[dict] = []
        self.console_proc: subprocess.Popen | None = None
        self.runner_proc: subprocess.Popen | None = None
        self.started = False
        self.helper_token: str | None = None
        self.seed_local_model = seed_local_model
        self.seeded_model: str | None = None

    def seed_ollama_config(self):
        """Point an isolated data root at the first local model so chat/screen-watch can run.

        Only for throwaway user roots: this rewrites screen-watch/state.json. A preference for
        a vision-capable model keeps the optional screen-watch check meaningful too.
        """
        try:
            _, tags = http_json(f"{OLLAMA_API}/api/tags", timeout=3)
        except Exception as exc:  # noqa: BLE001 - Ollama is optional
            raise RuntimeError(f"Ollama not reachable at {OLLAMA_API}: {exc}") from exc
        models = [m.get("name") for m in tags.get("models", []) if m.get("name")]
        if not models:
            raise RuntimeError("Ollama is running but has no local model")
        model = next((m for m in models if VISION_RE.search(m)), models[0])
        state = {
            "brain": "local", "trigger": "manual", "verbosity": "auto", "running": False,
            "intervalSec": 20, "minGapSec": 45, "changeThreshold": 10, "maxCallsPerHour": 35,
            "localProvider": "ollama", "localModel": model, "quipModel": model,
            "localApi": OLLAMA_API,
        }
        path = self.data_root / "screen-watch" / "state.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        self.seeded_model = model
        return model

    # ---------------------------------------------------------- checks
    def check(self, name: str, fn=None, required: bool = True):
        """Run one check; usable directly (check(name, fn)) or as a decorator."""
        if fn is None:
            def wrap(func):
                self.check(name, func, required)
                return func
            return wrap
        try:
            detail = fn()
            self.results.append({"name": name, "ok": True, "detail": detail, "required": required})
            print(f"[PASS] {name}: {detail}")
        except Exception as exc:  # noqa: BLE001 - report every failure
            self.results.append({"name": name, "ok": False, "detail": str(exc), "required": required})
            print(f"[FAIL] {name}: {exc}")
        return fn

    # ---------------------------------------------------------- start/stop
    def start(self):
        install, user_root = self.install, self.user_root
        env = clean_env(install, user_root)
        if self.seed_local_model:
            model = self.seed_ollama_config()
            print(f"seeded local brain: {model}")
        logs = user_root / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        self.console_proc = subprocess.Popen(
            [str(install / "electron" / "electron.exe"), str(install / "launcher")],
            cwd=str(install), env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        self.runner_proc = subprocess.Popen(
            [str(install / "electron" / "electron.exe"), str(install / "standalone" / "main.mjs")],
            cwd=str(install / "standalone"), env=env,
            stdout=open(logs / "acceptance-runner.log", "ab"),
            stderr=open(logs / "acceptance-runner.err.log", "ab"),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
            | getattr(subprocess, "DETACHED_PROCESS", 0),
        )
        self.started = True

    def stop(self):
        for proc in (self.runner_proc, self.console_proc):
            if proc and proc.poll() is None:
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                               capture_output=True, check=False)
        # runner may have detached; stop via the documented script when present
        stop_js = self.install / "standalone" / "stop-pet.mjs"
        if stop_js.exists():
            env = clean_env(self.install, self.user_root)
            subprocess.run([str(self.install / "electron" / "electron.exe"), str(stop_js)],
                           cwd=str(self.install / "standalone"), env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=False)

    # ---------------------------------------------------------- probes
    def load_token(self):
        ctl = self.data_root / "helper-control.json"
        if not ctl.exists():
            raise RuntimeError(f"missing {ctl}")
        data = json.loads(ctl.read_text(encoding="utf-8"))
        self.helper_token = data.get("token")
        return data

    def health(self):
        status, data = http_json("http://127.0.0.1:3080/health", timeout=3)
        if not data.get("ok"):
            raise RuntimeError(f"/health not ok: {data}")
        return data

    def helper_state(self):
        if not self.helper_token:
            self.load_token()
        _, data = http_json("http://127.0.0.1:3099/state?pet=main", token=self.helper_token)
        return data

    def tts(self):
        state = self.helper_state()
        raw = state.get("state", {}).get("dsh-pet-tts-main")
        if isinstance(raw, str):
            raw = json.loads(raw)
        if not raw:
            raise RuntimeError("no dsh-pet-tts-main state")
        return raw

    # ---------------------------------------------------------- scenarios
    def run(self):
        self.check("install.app_version", self._check_app_version)
        self.check("install.electron", self._check_electron)
        self.check("install.node", self._check_node)
        self.check("install.speech_models", self._check_speech)
        self.check("install.animations", self._check_animations)
        self.check("install.uninstaller", self._check_uninstaller)
        self.check("runtime.health", self._check_health)
        self.check("runtime.helper_state", self._check_helper)
        self.check("runtime.bubble", self._check_bubble)
        self.check("runtime.tts", self._check_tts)
        self.check("runtime.chat", self._check_chat)
        self.check("runtime.screen_watch", self._check_screen_watch, required=False)
        self.check("runtime.update_feed", self._check_update_feed, required=False)

    # -- install checks
    def _check_app_version(self):
        pkg = json.loads((self.install / "app" / "package.json").read_text(encoding="utf-8"))
        if not pkg.get("version"):
            raise RuntimeError("no version in app/package.json")
        return pkg["version"]

    def _check_electron(self):
        exe = self.install / "electron" / "electron.exe"
        if not exe.exists():
            raise RuntimeError("electron.exe missing")
        out = subprocess.run([str(exe), "--version"], capture_output=True, text=True, timeout=60)
        return (out.stdout or out.stderr).strip().splitlines()[0]

    def _check_node(self):
        exe = self.install / "node" / "bin" / "node.exe"
        if not exe.exists():
            raise RuntimeError("node.exe missing")
        out = subprocess.run([str(exe), "-v"], capture_output=True, text=True, timeout=60)
        return out.stdout.strip()

    def _check_speech(self):
        root = self.install / "speech"
        need = [
            root / "sherpa" / "sherpa-onnx.node",
            root / "sensevoice" / "models" / "silero" / "silero_vad.onnx",
        ]
        missing = [str(p) for p in need if not p.exists()]
        if missing:
            raise RuntimeError("missing: " + ", ".join(missing))
        total = sum(f.stat().st_size for f in root.rglob("*") if f.is_file())
        return f"{total / 1048576:.0f} MB"

    def _check_animations(self):
        webm = list((self.install / "app" / "assets" / "webm").glob("*.webm"))
        if len(webm) < 100:
            raise RuntimeError(f"only {len(webm)} animations")
        return f"{len(webm)} clips"

    def _check_uninstaller(self):
        un = self.install / "Uninstall.exe"
        if not un.exists():
            raise RuntimeError("Uninstall.exe missing")
        return f"{un.stat().st_size} bytes"

    # -- runtime checks
    def _check_health(self):
        return wait_until(lambda: self.health()["mode"], 120, desc="standalone /health") and "standalone"

    def _check_helper(self):
        state = wait_until(lambda: self.helper_state().get("state"), 120, desc="helper /state")
        self.helper_token = self.helper_token or None
        return f"{len(state)} state keys"

    def _check_bubble(self):
        ts_before = None
        _, before = http_json("http://127.0.0.1:3080/dsh-pet-7340/broadcast?pet=main")
        ts_before = before.get("ts")
        http("http://127.0.0.1:3080/dsh-pet-7340/say",
             data={"petId": "main", "text": "验收：气泡测试"})
        after = wait_until(
            lambda: (lambda b: b if b.get("ts") != ts_before else None)(
                http_json("http://127.0.0.1:3080/dsh-pet-7340/broadcast?pet=main")[1]),
            20, desc="broadcast ts change",
        )
        return f"ts {ts_before} -> {after.get('ts')}"

    def _check_tts(self):
        before = self.tts().get("last") or {}
        http("http://127.0.0.1:3080/dsh-pet-7340/say",
             data={"petId": "main", "text": "验收：语音合成测试"})
        after = wait_until(
            lambda: (lambda s: s if (s.get("last") or {}).get("ts") != before.get("ts") else None)(self.tts()),
            40, desc="tts last.ts change",
        )
        last = after["last"]
        if not last.get("bytes"):
            raise RuntimeError(f"tts produced no audio: {last}")
        return f"{last['bytes']} bytes in {last.get('ms')} ms"

    def _check_chat(self):
        status, data = http_json("http://127.0.0.1:3080/dsh-pet-7340/chat",
                                 data={"text": "验收：说一句话"})
        if not data.get("ok") or not data.get("reply"):
            raise RuntimeError(f"chat failed: {str(data)[:200]}")
        return f"reply {len(data['reply'])} chars"

    def _check_screen_watch(self):
        state_file = self.data_root / "screen-watch" / "state.json"
        if not state_file.exists():
            raise RuntimeError("screen-watch not configured")
        cfg = json.loads(state_file.read_text(encoding="utf-8"))
        last_at = cfg.get("lastAt") or 0
        http("http://127.0.0.1:3080/dsh-pet-7340/chat", data={"text": "点评一下"})
        state = wait_until(
            lambda: (lambda c: c if (c.get("lastAt") or 0) > last_at else None)(
                json.loads(state_file.read_text(encoding="utf-8"))),
            120, desc="screen-watch run",
        )
        result = state.get("lastResult") or {}
        if not result.get("ok"):
            raise RuntimeError(f"screen-watch failed: {str(result)[:200]}")
        return f"brain={state.get('brain')} say={str(result.get('say'))[:30]}"

    def _check_update_feed(self):
        req = urllib.request.Request(
            "https://api.github.com/repos/12we21/cute-fat-fish-pet/releases/latest",
            headers={"User-Agent": "cute-fat-fish-pet-acceptance"},
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        tag = data.get("tag_name", "")
        names = [a["name"] for a in data.get("assets", [])]
        need = [f"cute-fat-fish-pet-{tag.lstrip('v')}-setup.exe", "cute-fat-fish-pet-setup.exe"]
        missing = [n for n in need if n not in names]
        if missing:
            raise RuntimeError(f"latest {tag} missing assets: {missing}")
        built = json.loads((self.install / "app" / "package.json").read_text(encoding="utf-8")).get("version", "")
        try:
            latest_v = tuple(int(x) for x in tag.lstrip("v").split("."))
            built_v = tuple(int(x) for x in built.split("."))
        except ValueError:
            latest_v = built_v = ()
        if latest_v and built_v and latest_v < built_v:
            raise RuntimeError(f"latest release is {tag}, older than the build {built}")
        return f"latest {tag} with {len(names)} assets (build {built})"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--install-dir", default=None)
    ap.add_argument("--user-root", default=None)
    ap.add_argument("--fresh", action="store_true", help="stop and restart the pet for the run")
    ap.add_argument("--seed-local-model", action="store_true",
                    help="throwaway user roots only: point screen-watch/state.json at the first Ollama model")
    ap.add_argument("--json", default=None, help="write a JSON report here")
    args = ap.parse_args()

    install = Path(args.install_dir) if args.install_dir else installed_dir()
    user_root = Path(args.user_root) if args.user_root else Path(os.environ["APPDATA"]) / APP_ID
    default_root = Path(os.environ["APPDATA"]) / APP_ID
    if args.seed_local_model and user_root.resolve() == default_root.resolve():
        sys.exit("--seed-local-model would rewrite the real user configuration; give --user-root")
    print(f"install: {install}")
    print(f"user root: {user_root}")

    gate = Gate(install, user_root, seed_local_model=args.seed_local_model)
    try:
        if args.fresh:
            gate.stop()
            time.sleep(2)
            gate.start()
        gate.run()
    finally:
        if args.fresh:
            gate.stop()

    failed = [r for r in gate.results if not r["ok"] and r["required"]]
    report = {
        "install": str(install),
        "version": next((r["detail"] for r in gate.results if r["name"] == "install.app_version" and r["ok"]), None),
        "started_by_gate": gate.started,
        "results": gate.results,
        "failed_required": len(failed),
        "verdict": "PASS" if not failed else "FAIL",
        "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    if args.json:
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nVERDICT: {report['verdict']} ({len(gate.results) - len(failed)}/{len(gate.results)} checks passed)")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())

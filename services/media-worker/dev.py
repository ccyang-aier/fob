"""Local-only lifecycle helper. Never prints credentials or changes global Python."""
import json
import os
import secrets
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env.local"
RUNTIME = ROOT / ".runtime"
PYTHON = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
OPENER = build_opener(ProxyHandler({}))


def environment() -> dict[str, str]:
    if not ENV_FILE.exists():
        raise RuntimeError("Run python services/media-worker/dev.py init first.")
    return dict(line.split("=", 1) for line in ENV_FILE.read_text().splitlines() if line and not line.startswith("#"))


def init() -> None:
    if ENV_FILE.exists():
        print("Existing ignored Media Worker credentials reused.")
        return
    subprocess.run(["git", "check-ignore", ".env.local"], cwd=ROOT, check=True, capture_output=True)
    values = {
        "MEDIA_WORKER_TOKEN": secrets.token_hex(32), "MEDIA_WORKER_HOST": "127.0.0.1",
        "MEDIA_WORKER_PORT": "8920", "MEDIA_WORKER_DEVICE": "cpu",
        "MEDIA_WORKER_DOWNLOAD_ORIGINS": "http://127.0.0.1:59010",
    }
    with ENV_FILE.open("x") as output:
        output.write("# Generated development secret; do not commit.\n")
        output.write("".join(f"{key}={value}\n" for key, value in values.items()))
    if os.name != "nt":
        ENV_FILE.chmod(0o600)
    print("Created ignored Media Worker development configuration; credentials not displayed.")


def request(config: dict[str, str], path: str, *, authenticated: bool = True, body: bytes | None = None):
    headers = {"authorization": f"Bearer {config['MEDIA_WORKER_TOKEN']}"} if authenticated else {}
    if body is not None:
        headers["content-type"] = "application/json"
    url = f"http://127.0.0.1:{config.get('MEDIA_WORKER_PORT', '8910')}{path}"
    try:
        with OPENER.open(Request(url, data=body, headers=headers), timeout=5) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def verify(config: dict[str, str]) -> None:
    status, health = request(config, "/health", authenticated=False)
    assert status == 200 and health == {"service": "fob-media-worker", "status": "ok"}
    status, capabilities = request(config, "/v1/capabilities")
    assert status == 200 and isinstance(capabilities["operations"], list)
    status, error = request(config, "/v1/process", authenticated=False, body=b"{}")
    assert status == 401 and error["error"]["code"] == "unauthorized"
    status, error = request(config, "/v1/process", body=b'{"unexpected":"must-not-be-echoed"}')
    assert status == 422 and error["error"]["code"] == "invalid_request"
    assert "must-not-be-echoed" not in json.dumps(error)
    print(f"PASS live HTTP: health, authenticated capabilities, 401, strict 422; processors={capabilities['operations']}.")


def start(config: dict[str, str]) -> None:
    if not PYTHON.exists():
        raise RuntimeError("Create .venv and install requirements.txt before starting.")
    try:
        status, health = request(config, "/health", authenticated=False)
        if status == 200 and health.get("service") == "fob-media-worker":
            verify(config)
            print("Existing Media Worker reused.")
            return
    except (URLError, TimeoutError, OSError):
        pass
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", int(config.get("MEDIA_WORKER_PORT", "8910")))) == 0:
            raise RuntimeError("The requested port is already in use; existing process was not modified.")
    RUNTIME.mkdir(exist_ok=True)
    # Keep the validated service resident without Uvicorn's Windows reload
    # supervisor: its CTRL_C_EVENT path hangs in this hidden development session.
    flags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS if os.name == "nt" else 0
    with (RUNTIME / "server.log").open("ab") as log:
        process = subprocess.Popen([str(PYTHON), "-m", "media_worker"], cwd=ROOT,
                                   env={**os.environ, **config}, stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=log, creationflags=flags,
                                   start_new_session=os.name != "nt")
    for _ in range(50):
        if process.poll() is not None:
            raise RuntimeError("Media Worker failed to start; inspect its local .runtime/server.log.")
        try:
            verify(config)
            (RUNTIME / "server.pid").write_text(str(process.pid))
            print(f"Media Worker running at http://127.0.0.1:{config.get('MEDIA_WORKER_PORT', '8910')} (PID {process.pid}).")
            return
        except (URLError, TimeoutError, OSError):
            time.sleep(0.2)
    process.terminate()
    process.wait(timeout=10)
    raise RuntimeError("Media Worker did not become ready; only the new process was stopped.")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) == 2 else ""
    try:
        if command == "init":
            init()
        elif command == "start":
            start(environment())
        elif command in ("verify", "status"):
            verify(environment())
        else:
            raise RuntimeError("Usage: dev.py init|start|verify|status")
    except Exception as error:
        # HTTP and validation internals must not expose bearer tokens.
        print(str(error) if isinstance(error, RuntimeError) else "Media Worker development command failed.", file=sys.stderr)
        sys.exit(1)

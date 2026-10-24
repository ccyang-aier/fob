import asyncio
import os
import socket
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx

from tests.test_worker import CONTENT, TOKEN, payload, wait_for_child


class Source(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", str(len(CONTENT)))
        self.end_headers()
        self.wfile.write(CONTENT)

    def log_message(self, _format, *args):
        pass  # Resource URLs are intentionally never logged.


async def test_real_http_timeout_cancel_and_client_disconnect(tmp_path):
    source = ThreadingHTTPServer(("127.0.0.1", 0), Source)
    thread = threading.Thread(target=source.serve_forever, daemon=True)
    thread.start()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    source_origin = f"http://127.0.0.1:{source.server_port}"
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    server = subprocess.Popen([sys.executable, "-m", "uvicorn", "tests.http_fixture:create_app", "--factory",
                               "--host", "127.0.0.1", "--port", str(port), "--no-access-log"],
                              cwd=Path(__file__).resolve().parents[1], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              creationflags=flags, env={**os.environ, "MEDIA_WORKER_TOKEN": TOKEN,
                                                       "MEDIA_WORKER_DOWNLOAD_ORIGINS": source_origin,
                                                       "MEDIA_WORKER_TEMP_DIR": str(tmp_path),
                                                       "MEDIA_WORKER_TASK_TIMEOUT_SECONDS": "30"})
    try:
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=10,
                                    headers={"authorization": f"Bearer {TOKEN}"}) as client:
            async with asyncio.timeout(10):
                while True:
                    assert server.poll() is None, "Fixture HTTP server did not start"
                    try:
                        if (await client.get("/health")).status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(0.05)
            denied = await client.get("/v1/capabilities", headers={"authorization": "bad"})
            assert denied.status_code == 401
            timed_out = await client.post("/v1/process", json=payload(source_origin, timeoutMs=100))
            assert timed_out.status_code == 504 and timed_out.json()["error"]["code"] == "task_timeout"
            assert not list(tmp_path.iterdir())

            body = payload(source_origin, timeoutMs=30_000)
            task = asyncio.create_task(client.post("/v1/process", json=body))
            await wait_for_child(tmp_path)
            cancelled = await client.delete(f"/v1/tasks/{body['requestId']}")
            assert cancelled.status_code == 200
            assert (await task).status_code == 499
            assert not list(tmp_path.iterdir())

            disconnected = asyncio.create_task(client.post("/v1/process", json=payload(source_origin, timeoutMs=30_000)))
            await wait_for_child(tmp_path)
            disconnected.cancel()
            await asyncio.gather(disconnected, return_exceptions=True)
            async with asyncio.timeout(3):
                while list(tmp_path.iterdir()):
                    await asyncio.sleep(0.05)
            assert (await client.get("/health")).status_code == 200
    finally:
        server.terminate()
        await asyncio.to_thread(server.wait, 10)
        await asyncio.to_thread(source.shutdown)
        source.server_close()
        thread.join(timeout=2)

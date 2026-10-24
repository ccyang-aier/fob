import asyncio
import hashlib
import multiprocessing
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode
from uuid import uuid4

import httpx
import pytest

from media_worker.app import create_app
from media_worker.config import Settings
from media_worker.processors import ProcessorRegistry, ProcessorSpec

TOKEN = "test-only-token-" + "x" * 32
CONTENT = b"W01 transport fixture, not a document recognition result."


def payload(origin="http://storage.test", content=CONTENT, **changes):
    now = datetime.now(UTC).replace(microsecond=0)
    query = urlencode({"X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Date": now.strftime("%Y%m%dT%H%M%SZ"),
                       "X-Amz-Expires": "300", "X-Amz-Signature": "a" * 64,
                       "X-Amz-Credential": "fixture/date/region/s3/aws4_request", "X-Amz-SignedHeaders": "host"})
    return {"requestId": str(uuid4()), "operation": "parse_document", "timeoutMs": 10_000,
            "resource": {"url": f"{origin}/fixture.pdf?{query}", "expiresAt": (now + timedelta(seconds=300)).isoformat(),
                         "sha256": hashlib.sha256(content).hexdigest(), "size": len(content), "mime": "application/pdf"}, **changes}


class Bytes(httpx.AsyncByteStream):
    def __init__(self, content=CONTENT, delay=0):
        self.content = content
        self.delay = delay

    async def __aiter__(self):
        if self.delay:
            await asyncio.sleep(self.delay)
        yield self.content


@asynccontextmanager
async def running(tmp_path, processor="echo", handler=None, **overrides):
    settings = Settings(token=TOKEN, download_origins=("http://storage.test",), temp_dir=tmp_path, **overrides)
    registry = ProcessorRegistry()
    if processor is not None:
        registry.register("parse_document", ProcessorSpec("test-ipc-only", f"tests.probes:{processor}"))
    if handler is None:
        handler = lambda request: httpx.Response(200, stream=Bytes())
    downloader = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app = create_app(settings, registry, downloader)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://worker",
                                    headers={"authorization": f"Bearer {TOKEN}"}) as client:
            yield app, client
    assert not list(tmp_path.iterdir()), "Temporary task files leaked"
    assert not multiprocessing.active_children(), "Processor child leaked"


def test_configuration_cpu_gpu_and_secret_redaction():
    base = {"MEDIA_WORKER_TOKEN": TOKEN, "MEDIA_WORKER_DOWNLOAD_ORIGINS": "http://127.0.0.1:59000"}
    assert Settings.from_environment(base).device == "cpu"
    gpu = Settings.from_environment({**base, "MEDIA_WORKER_DEVICE": "cuda", "MEDIA_WORKER_DEVICE_INDEX": "1", "MEDIA_WORKER_COMPUTE_TYPE": "float16"})
    assert gpu.device_index == 1 and gpu.compute_type == "float16"
    for invalid in ({"MEDIA_WORKER_TOKEN": "secret"}, {"MEDIA_WORKER_DEVICE": "unknown"},
                    {"MEDIA_WORKER_DOWNLOAD_ORIGINS": "https://storage.test/path"}, {"MEDIA_WORKER_MAX_CONCURRENCY": "0"},
                    {"MEDIA_WORKER_COMPUTE_TYPE": "float16"}):
        with pytest.raises(ValueError) as error:
            Settings.from_environment({**base, **invalid})
        assert TOKEN not in str(error.value) and "secret" not in str(error.value)


async def test_health_auth_strict_input_and_missing_real_processors(tmp_path):
    async with running(tmp_path, processor=None) as (_, client):
        assert (await client.get("/health", headers={"authorization": ""})).json()["status"] == "ok"
        assert (await client.get("/v1/capabilities")).json()["operations"] == []
        denied = await client.post("/v1/process", json=payload(), headers={"authorization": "wrong"})
        assert denied.status_code == 401
        invalid = await client.post("/v1/process", json={**payload(), "unexpected": "secret-value"})
        assert invalid.status_code == 422 and "secret-value" not in invalid.text
        unsupported = await client.post("/v1/process", json=payload())
        assert unsupported.status_code == 503 and unsupported.json()["error"]["code"] == "processor_unavailable"


async def test_real_child_result_cleanup_and_correlation(tmp_path):
    async with running(tmp_path) as (_, client):
        body = payload()
        response = await client.post("/v1/process", json=body)
        assert response.status_code == 200, response.text
        assert response.json()["requestId"] == body["requestId"]
        assert response.json()["assetHash"] == body["resource"]["sha256"]
        assert response.json()["derived"] == {"status": "ready", "markdown": CONTENT.decode()}


@pytest.mark.parametrize("change", ["origin", "expired", "ttl", "unsigned", "userinfo", "duplicate_signature", "oversize"])
async def test_download_allowlist_expiry_signature_and_declared_size(tmp_path, change):
    calls = []
    async with running(tmp_path, handler=lambda request: calls.append(request) or httpx.Response(200, stream=Bytes()), max_bytes=1024) as (_, client):
        body = payload()
        resource = body["resource"]
        if change == "origin": resource["url"] = resource["url"].replace("storage.test", "169.254.169.254")
        if change == "expired": resource["expiresAt"] = "2000-01-01T00:00:00Z"
        if change == "ttl": resource["url"] = resource["url"].replace("X-Amz-Expires=300", "X-Amz-Expires=999999")
        if change == "unsigned": resource["url"] = "http://storage.test/fixture.pdf"
        if change == "userinfo": resource["url"] = resource["url"].replace("http://", "http://attacker@")
        if change == "duplicate_signature": resource["url"] += "&X-Amz-Signature=" + "b" * 64
        if change == "oversize": resource["size"] = 1025
        response = await client.post("/v1/process", json=body)
        assert response.status_code == (413 if change == "oversize" else 422)
        assert not calls


@pytest.mark.parametrize("case,code", [("redirect", "redirect_forbidden"), ("overflow", "resource_too_large"),
                                      ("hash", "hash_mismatch"), ("short", "size_mismatch"),
                                      ("encoded", "invalid_resource"), ("length", "size_mismatch"),
                                      ("timeout", "download_timeout")])
async def test_streaming_download_limits_and_cleanup(tmp_path, case, code):
    def handler(_request):
        if case == "redirect": return httpx.Response(302, headers={"location": "http://forbidden.test"})
        if case == "overflow": return httpx.Response(200, stream=Bytes(CONTENT * 2))
        if case == "hash": return httpx.Response(200, stream=Bytes(b"x" * len(CONTENT)))
        if case == "short": return httpx.Response(200, stream=Bytes(CONTENT[:-1]))
        if case == "encoded": return httpx.Response(200, headers={"content-encoding": "gzip"}, stream=Bytes())
        if case == "length": return httpx.Response(200, headers={"content-length": "999"}, stream=Bytes())
        return httpx.Response(200, stream=Bytes(delay=1))
    async with running(tmp_path, handler=handler, download_timeout_seconds=0.05) as (_, client):
        response = await client.post("/v1/process", json=payload())
        assert response.json()["error"]["code"] == code, response.text


@pytest.mark.parametrize("processor,code", [("failure", "processing_failed"), ("oversized", "result_too_large"), ("invalid", "processing_failed")])
async def test_processor_failure_and_output_limits(tmp_path, processor, code):
    async with running(tmp_path, processor=processor, max_response_bytes=1024) as (_, client):
        response = await client.post("/v1/process", json=payload())
        assert response.json()["error"]["code"] == code
        assert "sensitive" not in response.text


async def wait_for_child(tmp_path):
    async with asyncio.timeout(8):
        while not list(tmp_path.glob("*/child.pid")):
            await asyncio.sleep(0.02)


async def test_cancel_concurrency_and_duplicate_request(tmp_path):
    async with running(tmp_path, processor="slow", max_concurrency=1) as (app, client):
        body = payload()
        processing = asyncio.create_task(client.post("/v1/process", json=body))
        await wait_for_child(tmp_path)
        duplicate = await client.post("/v1/process", json=body)
        assert duplicate.status_code == 409
        busy = await client.post("/v1/process", json=payload())
        assert busy.status_code == 429 and busy.json()["error"]["retryable"]
        cancel = await client.delete(f"/v1/tasks/{body['requestId']}")
        assert cancel.status_code == 200 and cancel.json()["cancelled"]
        response = await processing
        assert response.status_code == 499 and response.json()["error"]["code"] == "task_cancelled"
        assert not app.state.active_requests
        assert (await client.delete(f"/v1/tasks/{body['requestId']}")).status_code == 404


async def test_task_deadline_reclaims_child_and_temporary_files(tmp_path):
    async with running(tmp_path, processor="slow", task_timeout_seconds=1.5) as (_, client):
        response = await client.post("/v1/process", json=payload())
        assert response.status_code == 504 and response.json()["error"]["code"] == "task_timeout"


async def test_request_byte_limit_and_wrong_mime(tmp_path):
    async with running(tmp_path, max_request_bytes=1024) as (_, client):
        oversized = await client.post("/v1/process", content=b"x" * 1025, headers={"content-type": "application/json"})
        assert oversized.status_code == 413
        body = payload()
        body["resource"]["mime"] = "text/html"
        assert (await client.post("/v1/process", json=body)).status_code == 422


async def test_chunked_request_limit_and_strict_numeric_types(tmp_path):
    async with running(tmp_path, max_request_bytes=1024) as (_, client):
        async def chunks():
            yield b"x" * 600
            yield b"x" * 600
        response = await client.post("/v1/process", content=chunks(), headers={"content-type": "application/json"})
        assert response.status_code == 413
        body = payload()
        body["resource"]["size"] = str(len(CONTENT))
        assert (await client.post("/v1/process", json=body)).status_code == 422


async def test_service_shutdown_cancels_active_processors(tmp_path):
    async with running(tmp_path, processor="slow") as (_, client):
        processing = asyncio.create_task(client.post("/v1/process", json=payload()))
        await wait_for_child(tmp_path)
    response = await processing
    assert response.status_code == 499


async def test_processor_cannot_accidentally_read_worker_token(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_WORKER_TOKEN", TOKEN)
    async with running(tmp_path, processor="secret_free") as (_, client):
        response = await client.post("/v1/process", json=payload())
        assert response.status_code == 200
    assert __import__("os").environ["MEDIA_WORKER_TOKEN"] == TOKEN

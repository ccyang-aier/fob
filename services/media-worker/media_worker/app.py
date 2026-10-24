import asyncio
import hmac
import time
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Receive, Scope, Send

from .config import Settings
from .contracts import DOCUMENT_TYPES, MEDIA_TYPES, ProcessRequest, ProcessResponse, RequestId
from .download import download_resource, validate_resource
from .errors import WorkerError
from .processors import ProcessorInput, ProcessorRegistry, default_registry, run_processor


class RequestGuard:
    """Authenticate before parsing bounded JSON; never echo submitted values."""

    def __init__(self, app: ASGIApp, settings: Settings):
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        try:
            headers = dict(scope["headers"])
            if scope["path"].startswith("/v1/"):
                expected = f"Bearer {self.settings.token.get_secret_value()}".encode()
                if not hmac.compare_digest(headers.get(b"authorization", b""), expected):
                    raise WorkerError("unauthorized", "Media Worker authentication is required.", 401)
            if scope["path"] == "/v1/process" and scope["method"] == "POST":
                if headers.get(b"content-type", b"").split(b";", 1)[0].strip().lower() != b"application/json":
                    raise WorkerError("invalid_request", "A JSON request body is required.", 415)
                if headers.get(b"content-encoding", b"identity").lower() != b"identity":
                    raise WorkerError("invalid_request", "Encoded request bodies are not permitted.", 415)
                length = headers.get(b"content-length")
                if length and (not length.isdigit() or int(length) > self.settings.max_request_bytes):
                    raise WorkerError("request_too_large", "Request body exceeds its byte limit.", 413)
                body = bytearray()
                async with asyncio.timeout(10):
                    while True:
                        message = await receive()
                        if message["type"] == "http.disconnect":
                            return
                        body.extend(message.get("body", b""))
                        if len(body) > self.settings.max_request_bytes:
                            raise WorkerError("request_too_large", "Request body exceeds its byte limit.", 413)
                        if not message.get("more_body", False):
                            break
                delivered = False

                async def bounded_receive():
                    nonlocal delivered
                    if not delivered:
                        delivered = True
                        return {"type": "http.request", "body": bytes(body), "more_body": False}
                    return await receive()

                await self.app(scope, bounded_receive, send)
                return
            await self.app(scope, receive, send)
        except WorkerError as error:
            await error.response()(scope, receive, send)
        except TimeoutError:
            await WorkerError("request_timeout", "Request body exceeded its deadline.", 408).response()(scope, receive, send)


def create_app(settings: Settings | None = None, registry: ProcessorRegistry | None = None,
               download_client: httpx.AsyncClient | None = None) -> FastAPI:
    settings = settings or Settings.from_environment()
    registry = registry if registry is not None else default_registry()
    active: dict[str, asyncio.Task[ProcessResponse]] = {}
    closing = False

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal closing
        app.state.download_client = download_client or httpx.AsyncClient(
            trust_env=False, follow_redirects=False,
            timeout=httpx.Timeout(settings.download_timeout_seconds, connect=10),
            limits=httpx.Limits(max_connections=settings.max_concurrency),
        )
        try:
            yield
        finally:
            closing = True
            for task in list(active.values()):
                task.cancel()
            await asyncio.gather(*list(active.values()), return_exceptions=True)
            await app.state.download_client.aclose()

    app = FastAPI(title="Fob Media Worker", version="1.0.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)
    app.add_middleware(RequestGuard, settings=settings)
    app.state.active_requests = active

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _error: RequestValidationError):
        return WorkerError("invalid_request", "Request does not match the media processing contract.", 422).response()

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, error: HTTPException):
        return WorkerError("invalid_request", "The requested HTTP route or method is not available.", error.status_code).response()

    @app.get("/health")
    async def health():
        return {"service": "fob-media-worker", "status": "ok"}

    @app.get("/v1/capabilities")
    async def capabilities():
        return {
            "operations": registry.operations(), "device": settings.device,
            "deviceIndex": settings.device_index, "computeType": settings.compute_type,
            "limits": {"maxBytes": settings.max_bytes, "maxRequestBytes": settings.max_request_bytes,
                       "maxResponseBytes": settings.max_response_bytes, "maxConcurrency": settings.max_concurrency,
                       "taskTimeoutMs": int(settings.task_timeout_seconds * 1000),
                       "maxResourceTtlSeconds": settings.max_resource_ttl_seconds},
        }

    async def execute(body: ProcessRequest) -> ProcessResponse:
        spec = registry.require(body.operation)
        started = time.monotonic()
        suffix = {**MEDIA_TYPES, **DOCUMENT_TYPES}[body.resource.mime]
        with TemporaryDirectory(prefix="fob-media-", dir=settings.temp_dir) as directory:
            source = Path(directory) / f"source{suffix}"
            await download_resource(body.resource, source, settings, app.state.download_client)
            output = await run_processor(spec, ProcessorInput(
                source=source, mime=body.resource.mime, language=body.language, device=settings.device,
                device_index=settings.device_index, compute_type=settings.compute_type, cpu_threads=settings.cpu_threads,
            ), settings)
            response = ProcessResponse(requestId=body.requestId, operation=body.operation,
                                       assetHash=body.resource.sha256, **output.model_dump(exclude_none=True), processor=spec.name,
                                       elapsedMs=int((time.monotonic() - started) * 1000))
            if len(response.model_dump_json(exclude_none=True).encode()) > settings.max_response_bytes:
                raise WorkerError("result_too_large", "Media output exceeds the response limit.", 413)
            return response

    @app.post("/v1/process", response_model=ProcessResponse, response_model_exclude_none=True)
    async def process(body: ProcessRequest, request: Request):
        watcher = None
        task = None
        try:
            if closing:
                raise WorkerError("worker_unavailable", "Media Worker is shutting down.", 503, retryable=True)
            validate_resource(body.resource, settings)
            registry.require(body.operation)
            if body.requestId in active:
                raise WorkerError("duplicate_request", "This request is already active.", 409)
            if len(active) >= settings.max_concurrency:
                raise WorkerError("worker_busy", "Media Worker concurrency limit is reached.", 429, retryable=True)
            task = asyncio.create_task(execute(body))
            active[body.requestId] = task

            async def cancel_on_disconnect():
                while not task.done():
                    if await request.is_disconnected():
                        task.cancel()
                        return
                    await asyncio.sleep(0.1)

            watcher = asyncio.create_task(cancel_on_disconnect())
            return await asyncio.wait_for(task, min(body.timeoutMs / 1000, settings.task_timeout_seconds))
        except TimeoutError:
            return WorkerError("task_timeout", "Media processing exceeded its deadline.", 504, retryable=True).response(body.requestId)
        except asyncio.CancelledError:
            return WorkerError("task_cancelled", "Media processing was cancelled.", 499).response(body.requestId)
        except WorkerError as error:
            return error.response(body.requestId)
        except Exception:
            return WorkerError("processing_failed", "Media processing failed.", 500, retryable=True).response(body.requestId)
        finally:
            if watcher:
                watcher.cancel()
                await asyncio.gather(watcher, return_exceptions=True)
            if task is not None:
                if not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
                active.pop(body.requestId, None)

    @app.delete("/v1/tasks/{request_id}")
    async def cancel(request_id: RequestId):
        task = active.get(request_id)
        if task is None:
            return WorkerError("task_not_found", "No active task has this request ID.", 404).response(request_id)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return {"requestId": request_id, "cancelled": True}

    return app

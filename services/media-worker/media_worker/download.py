import asyncio
import hashlib
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl

import httpx

from .config import Settings, origin
from .contracts import Resource
from .errors import WorkerError


def validate_resource(resource: Resource, settings: Settings) -> None:
    try:
        url = httpx.URL(resource.url)
        if origin(resource.url) not in settings.download_origins:
            raise ValueError()
        values = parse_qsl(url.query.decode("ascii"), keep_blank_values=True)
        query = dict(values)
        if len(query) != len(values):
            raise ValueError()
        if query.get("X-Amz-Algorithm") != "AWS4-HMAC-SHA256":
            raise ValueError()
        if not re.fullmatch(r"[a-f0-9]{64}", query.get("X-Amz-Signature", "")):
            raise ValueError()
        if not query.get("X-Amz-Credential") or "host" not in query.get("X-Amz-SignedHeaders", "").split(";"):
            raise ValueError()
        signed_at = datetime.strptime(query["X-Amz-Date"], "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
        ttl = int(query["X-Amz-Expires"])
        expires_at = datetime.fromisoformat(resource.expiresAt.replace("Z", "+00:00"))
        now = datetime.now(UTC)
        if not 0 < ttl <= settings.max_resource_ttl_seconds:
            raise ValueError()
        if signed_at > now + timedelta(seconds=30) or expires_at <= now:
            raise ValueError()
        if abs((signed_at + timedelta(seconds=ttl) - expires_at).total_seconds()) > 1:
            raise ValueError()
    except (ValueError, KeyError, UnicodeError, httpx.InvalidURL):
        raise WorkerError("invalid_resource", "A short-lived S3 URL from an allowed origin is required.", 422) from None
    if resource.size > settings.max_bytes:
        raise WorkerError("resource_too_large", "Resource exceeds the configured byte limit.", 413)


async def download_resource(resource: Resource, target: Path, settings: Settings, client: httpx.AsyncClient) -> None:
    validate_resource(resource, settings)
    digest = hashlib.sha256()
    received = 0
    try:
        async with asyncio.timeout(settings.download_timeout_seconds):
            async with client.stream("GET", resource.url, headers={"Accept-Encoding": "identity"}, follow_redirects=False) as response:
                if response.is_redirect:
                    raise WorkerError("redirect_forbidden", "Resource redirects are not permitted.", 422)
                if response.status_code != 200:
                    raise WorkerError("download_failed", "Resource download was not successful.", 502, retryable=response.status_code >= 500)
                if response.headers.get("content-encoding", "identity").lower() != "identity":
                    raise WorkerError("invalid_resource", "Encoded download bodies are not permitted.", 422)
                declared_length = response.headers.get("content-length")
                if declared_length is not None and (not declared_length.isdecimal() or int(declared_length) != resource.size):
                    raise WorkerError("size_mismatch", "Resource size did not match its declaration.", 422)
                with target.open("xb") as output:
                    async for chunk in response.aiter_raw():
                        received += len(chunk)
                        if received > min(resource.size, settings.max_bytes):
                            raise WorkerError("resource_too_large", "Downloaded resource exceeds its byte limit.", 413)
                        output.write(chunk)
                        digest.update(chunk)
    except (TimeoutError, httpx.TimeoutException):
        raise WorkerError("download_timeout", "Resource download exceeded its deadline.", 504, retryable=True) from None
    except httpx.HTTPError:
        raise WorkerError("download_failed", "Resource download failed.", 502, retryable=True) from None
    if received != resource.size:
        raise WorkerError("size_mismatch", "Resource size did not match its declaration.", 422)
    if digest.hexdigest() != resource.sha256:
        raise WorkerError("hash_mismatch", "Resource SHA-256 did not match its declaration.", 422)

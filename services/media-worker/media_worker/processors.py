"""Trusted synchronous processors run in disposable, cancellable child processes.

W02/W03 register real implementations in default_registry(). Client requests
cannot choose import paths. No mock transcription is installed in production.
"""
import asyncio
import importlib
import json
import multiprocessing
import os
import signal
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .config import Settings
from .contracts import Operation, ProcessorOutput
from .errors import WorkerError


@dataclass(frozen=True)
class ProcessorInput:
    source: Path
    mime: str
    language: str | None
    device: str
    device_index: int
    compute_type: str
    cpu_threads: int


@dataclass(frozen=True)
class ProcessorSpec:
    name: str
    entrypoint: str
    options: dict = field(default_factory=dict)
    unavailable_code: str | None = None


PROCESSOR_FAILURES = {
    "dependency_missing": ("The media processor dependency is missing or cannot be loaded.", 503, False),
    "model_unavailable": ("The configured local model is missing or invalid; prepare the model before processing.", 503, False),
    "device_unavailable": ("The configured compute device or precision is unavailable.", 503, False),
    "invalid_media": ("The media input cannot be decoded or contains no audio samples.", 422, False),
    "media_too_long": ("Decoded media duration exceeds the configured limit.", 413, False),
    "unsupported_language": ("The configured model does not support the requested language.", 422, False),
    "invalid_document": ("The document is corrupt, encrypted, unsafe, or does not match its declared format.", 422, False),
    "empty_document": ("The document contains no extractable content.", 422, False),
    "document_limit_exceeded": ("The document exceeds its page, archive, image, or input limits.", 413, False),
    "unsupported_document_content": ("A document picture cannot be extracted by the configured local pipeline.", 422, False),
}


class ProcessorFailure(Exception):
    """Only stable, known error codes cross the child-process boundary."""
    def __init__(self, code: str):
        if code not in PROCESSOR_FAILURES:
            raise ValueError("Unknown processor failure code")
        self.code = code
        super().__init__(code)


def processor_error(code: str) -> WorkerError:
    message, status, retryable = PROCESSOR_FAILURES[code]
    return WorkerError(code, message, status, retryable=retryable)


class ProcessorRegistry:
    def __init__(self) -> None:
        self._entries: dict[Operation, ProcessorSpec] = {}

    def register(self, operation: Operation, spec: ProcessorSpec) -> None:
        if operation not in ("transcribe", "parse_document") or operation in self._entries:
            raise ValueError("Unknown or duplicate processor operation")
        if not spec.name or ":" not in spec.entrypoint:
            raise ValueError("Processor needs a name and module:function entrypoint")
        self._entries[operation] = spec

    def require(self, operation: Operation) -> ProcessorSpec:
        if operation not in self._entries:
            raise WorkerError("processor_unavailable", "The requested media processor is not installed.", 503)
        spec = self._entries[operation]
        if spec.unavailable_code:
            raise processor_error(spec.unavailable_code)
        return spec

    def operations(self) -> list[Operation]:
        return sorted(operation for operation, spec in self._entries.items() if spec.unavailable_code is None)


def default_registry() -> ProcessorRegistry:
    from .docling import docling_spec
    from .whisper import whisper_spec
    registry = ProcessorRegistry()
    registry.register("transcribe", whisper_spec())
    registry.register("parse_document", docling_spec())
    return registry


def _child_entry(spec: ProcessorSpec, source: ProcessorInput, result_path: Path, result_limit: int) -> None:
    os.environ.pop("MEDIA_WORKER_TOKEN", None)
    if os.name != "nt":
        os.setsid()
    os.environ["OMP_NUM_THREADS"] = str(source.cpu_threads)
    os.environ["MKL_NUM_THREADS"] = str(source.cpu_threads)
    # Libraries must not print signed URLs, content, or credentials to service logs.
    with open(os.devnull, "w") as sink:
        os.dup2(sink.fileno(), 1)
        os.dup2(sink.fileno(), 2)
        try:
            module_name, function_name = spec.entrypoint.split(":", 1)
            processor = getattr(importlib.import_module(module_name), function_name)
            output = ProcessorOutput.model_validate(processor(source, **spec.options))
            result = output.model_dump(exclude_none=True)
            encoded = json.dumps(result, ensure_ascii=False).encode("utf-8")
            if len(encoded) > result_limit:
                encoded = b'{"error":"result_too_large"}'
        except ProcessorFailure as error:
            encoded = json.dumps({"error": error.code}).encode()
        except Exception:
            # Model errors can contain file paths or source data; keep the wire error stable.
            encoded = b'{"error":"processing_failed"}'
        result_path.write_bytes(encoded)


def _stop_process(process: multiprocessing.Process) -> None:
    if process.is_alive():
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW, check=False, timeout=5)
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                process.kill()
        process.join(timeout=5)
        if process.is_alive():
            process.kill()
            process.join(timeout=5)
    else:
        process.join()
    process.close()


async def run_processor(spec: ProcessorSpec, source: ProcessorInput, settings: Settings) -> ProcessorOutput:
    result_path = source.source.parent / "result.json"
    process = multiprocessing.get_context("spawn").Process(
        target=_child_entry, args=(spec, source, result_path, settings.max_response_bytes),
    )
    process.start()
    try:
        while process.is_alive():
            await asyncio.sleep(0.05)
        if process.exitcode != 0 or not result_path.is_file():
            raise WorkerError("processing_failed", "Media processor failed.", 502, retryable=True)
        if result_path.stat().st_size > settings.max_response_bytes:
            raise WorkerError("result_too_large", "Media output exceeds the response limit.", 413)
        result = json.loads(result_path.read_bytes())
        if result.get("error") == "result_too_large":
            raise WorkerError("result_too_large", "Media output exceeds the response limit.", 413)
        if "error" in result:
            if result["error"] in PROCESSOR_FAILURES:
                raise processor_error(result["error"])
            raise WorkerError("processing_failed", "Media processor failed.", 502, retryable=True)
        return ProcessorOutput.model_validate(result)
    finally:
        # No detached model threads or ffmpeg children may outlive cancellation.
        await asyncio.to_thread(_stop_process, process)

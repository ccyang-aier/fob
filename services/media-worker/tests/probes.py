"""Test-only IPC probes. These are not Whisper/Docling implementations."""
import os
import time

from media_worker.processors import ProcessorInput


def echo(source: ProcessorInput):
    return {"derived": {"status": "ready", "markdown": source.source.read_text()}}


def slow(source: ProcessorInput):
    (source.source.parent / "child.pid").write_text(str(os.getpid()))
    time.sleep(30)
    return echo(source)


def failure(_source: ProcessorInput):
    raise RuntimeError("A model failure containing sensitive input must never be exposed")


def oversized(_source: ProcessorInput):
    return {"derived": {"status": "ready", "markdown": "x" * 4096}}


def invalid(_source: ProcessorInput):
    return {"derived": {"status": "ready", "transcript": [{"start": 5.0, "end": 1.0, "text": "invalid"}]}}


def secret_free(source: ProcessorInput):
    assert "MEDIA_WORKER_TOKEN" not in os.environ
    return echo(source)

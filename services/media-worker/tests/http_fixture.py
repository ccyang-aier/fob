"""Only used by live HTTP tests; never imported by the production entrypoint."""
from media_worker.app import create_app as make_app
from media_worker.config import Settings
from media_worker.processors import ProcessorRegistry, ProcessorSpec


def create_app():
    registry = ProcessorRegistry()
    registry.register("parse_document", ProcessorSpec("test-cancellation-only", "tests.probes:slow"))
    return make_app(Settings.from_environment(), registry)

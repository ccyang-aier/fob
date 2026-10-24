import wave
from pathlib import Path

import pytest

from media_worker.processors import ProcessorFailure, ProcessorInput, ProcessorRegistry, processor_error
from media_worker.whisper import decode_bounded_audio, transcribe, whisper_spec
from media_worker.whisper_config import WhisperSettings


def source(path: Path, language="en"):
    return ProcessorInput(path, "audio/wav", language, "cpu", 0, "auto", 2)


def wav(path: Path, seconds: int):
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b"\0\0" * (seconds * 16000))


def test_whisper_configuration_is_strict_and_isolated(tmp_path):
    config = WhisperSettings.from_environment({"MEDIA_WORKER_WHISPER_MODEL": "base", "MEDIA_WORKER_WHISPER_CACHE_DIR": str(tmp_path),
                                                "MEDIA_WORKER_WHISPER_VAD_FILTER": "false", "MEDIA_WORKER_WHISPER_BEAM_SIZE": "3"})
    assert config.directory == tmp_path / "base" and config.beam_size == 3 and not config.vad_filter
    assert not config.is_prepared()
    for values in ({"MEDIA_WORKER_WHISPER_MODEL": "untrusted/repository"}, {"MEDIA_WORKER_WHISPER_BEAM_SIZE": "0"},
                   {"MEDIA_WORKER_WHISPER_MAX_AUDIO_SECONDS": "0"}, {"MEDIA_WORKER_WHISPER_MAX_DOWNLOAD_BYTES": "0"}):
        with pytest.raises(ValueError):
            WhisperSettings.from_environment(values)


def test_missing_dependency_and_model_are_observable(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_WORKER_WHISPER_CACHE_DIR", str(tmp_path))
    missing_model = whisper_spec()
    assert missing_model.unavailable_code == "model_unavailable"
    registry = ProcessorRegistry()
    registry.register("transcribe", missing_model)
    assert registry.operations() == []
    with pytest.raises(Exception) as error:
        registry.require("transcribe")
    assert error.value.code == "model_unavailable" and error.value.status == 503 and not error.value.retryable
    monkeypatch.setattr("media_worker.whisper.importlib.util.find_spec", lambda name: None)
    assert whisper_spec().unavailable_code == "dependency_missing"


def test_decode_actual_samples_and_limit_decoded_duration(tmp_path):
    audio = tmp_path / "tone.wav"
    wav(audio, 2)
    decoded = decode_bounded_audio(source(audio), 2)
    assert decoded.shape == (32000,) and str(decoded.dtype) == "float32"
    with pytest.raises(ProcessorFailure, match="media_too_long"):
        decode_bounded_audio(source(audio), 1)


@pytest.mark.parametrize("kind", ["empty", "corrupt"])
def test_empty_and_corrupt_audio_have_stable_non_retryable_errors(tmp_path, kind):
    audio = tmp_path / "bad.wav"
    if kind == "empty": wav(audio, 0)
    else: audio.write_bytes(b"not a media container")
    with pytest.raises(ProcessorFailure, match="invalid_media"):
        decode_bounded_audio(source(audio), 2)
    error = processor_error("invalid_media")
    assert error.status == 422 and not error.retryable


def test_missing_local_model_never_triggers_network(tmp_path):
    with pytest.raises(ProcessorFailure, match="model_unavailable"):
        transcribe(source(tmp_path / "irrelevant.wav"), config=WhisperSettings(cache_dir=tmp_path))

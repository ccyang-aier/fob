"""Real faster-whisper inference; no online model fetches during HTTP tasks."""
import importlib.util
import io
import math
import os

from .processors import ProcessorFailure, ProcessorInput, ProcessorSpec
from .whisper_config import WhisperSettings


def whisper_spec() -> ProcessorSpec:
    config = WhisperSettings.from_environment()
    missing = any(importlib.util.find_spec(name) is None for name in ("faster_whisper", "ctranslate2", "av", "numpy"))
    unavailable = "dependency_missing" if missing else (None if config.is_prepared() else "model_unavailable")
    label = "local" if config.model_path else config.model
    return ProcessorSpec(f"faster-whisper:{label}", "media_worker.whisper:transcribe", {"config": config}, unavailable)


def decode_bounded_audio(source: ProcessorInput, max_seconds: int):
    """Count actual decoded samples, not untrusted container duration metadata."""
    try:
        import av
        import numpy as np
    except (ImportError, OSError):
        raise ProcessorFailure("dependency_missing") from None
    raw = io.BytesIO()
    samples = 0
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)

    def append(frames):
        nonlocal samples
        for frame in frames:
            samples += frame.samples
            if samples > max_seconds * 16000:
                raise ProcessorFailure("media_too_long")
            raw.write(frame.to_ndarray().tobytes())

    try:
        with av.open(str(source.source), mode="r", metadata_errors="ignore") as container:
            if not container.streams.audio:
                raise ProcessorFailure("invalid_media")
            for frame in container.decode(audio=0):
                frame.pts = None
                append(resampler.resample(frame))
            append(resampler.resample(None))
    except ProcessorFailure:
        raise
    except (av.error.FFmpegError, ValueError, OSError, EOFError):
        raise ProcessorFailure("invalid_media") from None
    if not samples:
        raise ProcessorFailure("invalid_media")
    audio = np.frombuffer(raw.getbuffer(), dtype=np.int16).astype(np.float32)
    audio /= 32768.0
    return audio


def transcribe(source: ProcessorInput, *, config: WhisperSettings):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    try:
        import ctranslate2
        from faster_whisper import WhisperModel
    except (ImportError, OSError):
        raise ProcessorFailure("dependency_missing") from None
    if not config.is_prepared():
        raise ProcessorFailure("model_unavailable")
    audio = decode_bounded_audio(source, config.max_audio_seconds)
    duration = len(audio) / 16000
    device = source.device
    if device == "auto":
        device = "cuda" if ctranslate2.get_cuda_device_count() else "cpu"
    if device == "cuda" and source.device_index >= ctranslate2.get_cuda_device_count():
        raise ProcessorFailure("device_unavailable")
    compute_type = source.compute_type
    if compute_type == "auto":
        compute_type = "int8" if device == "cpu" else "float16"
    try:
        supported = ctranslate2.get_supported_compute_types(device, source.device_index)
        if compute_type not in supported:
            raise ProcessorFailure("device_unavailable")
    except (ValueError, RuntimeError):
        raise ProcessorFailure("device_unavailable") from None
    try:
        model = WhisperModel(str(config.directory), device=device, device_index=source.device_index,
                             compute_type=compute_type, cpu_threads=source.cpu_threads,
                             num_workers=1, local_files_only=True, use_auth_token=False)
    except (OSError, ValueError, RuntimeError):
        raise ProcessorFailure("model_unavailable") from None
    language = source.language.split("-", 1)[0] if source.language else None
    if language is not None and language not in model.supported_languages:
        raise ProcessorFailure("unsupported_language")
    segments, _info = model.transcribe(audio, language=language, beam_size=config.beam_size,
                                      temperature=0.0, vad_filter=config.vad_filter,
                                      condition_on_previous_text=False, word_timestamps=False)
    transcript = []
    for segment in segments:  # The generator performs real inference here.
        start, end = float(segment.start), float(segment.end)
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start:
            raise RuntimeError("Invalid model timestamp")
        if transcript and start < transcript[-1]["start"]:
            raise RuntimeError("Out-of-order model timestamp")
        text = segment.text.strip()
        if text and start < duration:
            transcript.append({"start": round(start, 3), "end": round(min(end, duration), 3), "text": text})
    return {"derived": {"status": "ready", "transcript": transcript}}

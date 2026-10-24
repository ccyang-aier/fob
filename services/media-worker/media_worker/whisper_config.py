import os
from pathlib import Path
from typing import Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, ValidationError

MODEL_REPOSITORIES = {
    "tiny": "Systran/faster-whisper-tiny", "tiny.en": "Systran/faster-whisper-tiny.en",
    "base": "Systran/faster-whisper-base", "base.en": "Systran/faster-whisper-base.en",
    "small": "Systran/faster-whisper-small", "small.en": "Systran/faster-whisper-small.en",
    "medium": "Systran/faster-whisper-medium", "medium.en": "Systran/faster-whisper-medium.en",
    "large-v3": "Systran/faster-whisper-large-v3", "turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
}
MODEL_FILES = ("config.json", "model.bin", "tokenizer.json", "preprocessor_config.json", "vocabulary.json", "vocabulary.txt")
REQUIRED_MODEL_FILES = ("config.json", "model.bin", "tokenizer.json")


class WhisperSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    model: Literal["tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en", "large-v3", "turbo"] = "tiny"
    cache_dir: Path = Path(__file__).resolve().parents[1] / ".cache" / "models"
    model_path: Path | None = None
    beam_size: int = Field(default=5, ge=1, le=10)
    vad_filter: bool = True
    max_audio_seconds: int = Field(default=3600, ge=1, le=14_400)
    max_download_bytes: int = Field(default=256 * 1024**2, ge=1024, le=8 * 1024**3)

    @property
    def directory(self) -> Path:
        return (self.model_path or self.cache_dir / self.model).resolve()

    def is_prepared(self) -> bool:
        return all((self.directory / name).is_file() for name in REQUIRED_MODEL_FILES)

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> "WhisperSettings":
        environment = os.environ if environment is None else environment
        values = {name: environment[f"MEDIA_WORKER_WHISPER_{name.upper()}"] for name in cls.model_fields
                  if f"MEDIA_WORKER_WHISPER_{name.upper()}" in environment}
        try:
            return cls.model_validate(values)
        except ValidationError as error:
            fields = sorted({".".join(map(str, issue["loc"])) for issue in error.errors()})
            raise ValueError(f"Invalid Whisper configuration: {', '.join(fields)}") from None

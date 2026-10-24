import os
from pathlib import Path
from typing import Literal, Mapping

import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError, field_validator, model_validator


def origin(value: str) -> str:
    url = httpx.URL(value)
    if url.scheme not in ("http", "https") or not url.host or url.userinfo or url.fragment:
        raise ValueError("Use an HTTP(S) URL without credentials or fragment")
    port = url.port or (443 if url.scheme == "https" else 80)
    host = f"[{url.host}]" if ":" in url.host else url.host
    return f"{url.scheme}://{host}:{port}"


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    token: SecretStr = Field(min_length=32, max_length=256)
    download_origins: tuple[str, ...] = Field(min_length=1, max_length=20)
    host: str = "127.0.0.1"
    port: int = Field(default=8910, ge=1, le=65535)
    device: Literal["cpu", "cuda", "auto"] = "cpu"
    device_index: int = Field(default=0, ge=0, le=31)
    compute_type: Literal["auto", "float32", "float16", "int8"] = "auto"
    cpu_threads: int = Field(default=2, ge=1, le=64)
    max_concurrency: int = Field(default=2, ge=1, le=16)
    max_bytes: int = Field(default=512 * 1024**2, ge=1, le=5 * 1024**3)
    max_response_bytes: int = Field(default=2 * 1024**2, ge=1024, le=16 * 1024**2)
    max_request_bytes: int = Field(default=16 * 1024, ge=1024, le=64 * 1024)
    task_timeout_seconds: float = Field(default=600, gt=0, le=3600)
    download_timeout_seconds: float = Field(default=60, gt=0, le=600)
    max_resource_ttl_seconds: int = Field(default=900, ge=1, le=3600)
    temp_dir: Path | None = None

    @field_validator("token")
    @classmethod
    def token_has_no_whitespace(cls, value: SecretStr) -> SecretStr:
        if any(character.isspace() for character in value.get_secret_value()):
            raise ValueError("Token cannot contain whitespace")
        return value

    @field_validator("download_origins")
    @classmethod
    def exact_origins(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        normalized = []
        for value in values:
            url = httpx.URL(value)
            if url.path != "/" or url.query:
                raise ValueError("Download allowlist must contain exact origins")
            normalized.append(origin(value))
        return tuple(dict.fromkeys(normalized))

    @model_validator(mode="after")
    def supported_compute(self) -> "Settings":
        if self.device == "cpu" and self.compute_type == "float16":
            raise ValueError("CPU execution cannot request float16")
        if self.temp_dir is not None and not self.temp_dir.is_dir():
            raise ValueError("Temporary directory must already exist")
        return self

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> "Settings":
        environment = os.environ if environment is None else environment
        values = {name: environment[f"MEDIA_WORKER_{name.upper()}"] for name in cls.model_fields
                  if f"MEDIA_WORKER_{name.upper()}" in environment}
        if "download_origins" in values:
            values["download_origins"] = tuple(part.strip() for part in values["download_origins"].split(","))
        try:
            return cls.model_validate(values)
        except ValidationError as error:
            # Pydantic error details can include tokens. Expose field names only.
            fields = sorted({".".join(map(str, issue["loc"])) or "settings" for issue in error.errors()})
            raise ValueError(f"Invalid Media Worker configuration: {', '.join(fields)}") from None

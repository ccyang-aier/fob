"""Bounded local document conversion; optional OCR is never downloaded implicitly."""
import os
from pathlib import Path
from typing import Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, ValidationError

LAYOUT_REPOSITORY = "docling-project/docling-layout-heron"
LAYOUT_FILES = ("config.json", "model.safetensors", "preprocessor_config.json")
TABLE_REPOSITORY = "docling-project/docling-models"
TABLE_REVISION = "v2.3.0"


class DoclingSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    artifacts_path: Path = Path(__file__).resolve().parents[1] / ".cache" / "models" / "docling"
    table_mode: Literal["fast", "accurate"] = "fast"
    max_download_bytes: int = Field(default=512 * 1024**2, ge=1024, le=2 * 1024**3)
    max_file_bytes: int = Field(default=50 * 1024**2, ge=1024, le=512 * 1024**2)
    max_pages: int = Field(default=100, ge=1, le=1000)
    max_page_pixels: int = Field(default=10_000_000, ge=10_000, le=40_000_000)
    max_zip_entries: int = Field(default=5000, ge=1, le=20_000)
    max_uncompressed_bytes: int = Field(default=128 * 1024**2, ge=1024, le=1024**3)
    max_images: int = Field(default=32, ge=0, le=32)
    max_image_pixels: int = Field(default=4_000_000, ge=1, le=4_000_000)
    max_image_bytes: int = Field(default=1024**2, ge=1, le=1024**2)
    max_total_image_bytes: int = Field(default=1024**2, ge=1, le=1024**2)

    def model_files(self) -> list[tuple[str, str, tuple[str, ...]]]:
        table = f"model_artifacts/tableformer/{self.table_mode}"
        return [(LAYOUT_REPOSITORY, "main", LAYOUT_FILES),
                (TABLE_REPOSITORY, TABLE_REVISION, (f"{table}/tm_config.json", f"{table}/tableformer_{self.table_mode}.safetensors"))]

    def is_prepared(self) -> bool:
        return all((self.artifacts_path / repo.replace("/", "--") / name).is_file()
                   for repo, _revision, names in self.model_files() for name in names)

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> "DoclingSettings":
        environment = os.environ if environment is None else environment
        values = {name: environment[f"MEDIA_WORKER_DOCLING_{name.upper()}"] for name in cls.model_fields
                  if f"MEDIA_WORKER_DOCLING_{name.upper()}" in environment}
        try:
            return cls.model_validate(values)
        except ValidationError as error:
            fields = sorted({".".join(map(str, issue["loc"])) for issue in error.errors()})
            raise ValueError(f"Invalid Docling configuration: {', '.join(fields)}") from None

import base64
import hashlib
import re
import struct
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

UUID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
RequestId = Annotated[str, Field(pattern=UUID_PATTERN)]
AssetHash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Operation = Literal["transcribe", "parse_document"]

MEDIA_TYPES = {
    "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a",
    "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/flac": ".flac",
    "audio/ogg": ".ogg", "audio/webm": ".webm", "video/mp4": ".mp4",
    "video/webm": ".webm", "video/quicktime": ".mov",
}
DOCUMENT_TYPES = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class Resource(StrictModel):
    url: str = Field(min_length=1, max_length=8192)
    expiresAt: str = Field(min_length=20, max_length=40)
    sha256: AssetHash
    size: int = Field(gt=0, le=5 * 1024**3)
    mime: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def aware_expiry(self) -> "Resource":
        expiry = datetime.fromisoformat(self.expiresAt.replace("Z", "+00:00"))
        if expiry.tzinfo is None:
            raise ValueError("Resource expiry must include a timezone")
        return self


class ProcessRequest(StrictModel):
    requestId: RequestId
    operation: Operation
    resource: Resource
    timeoutMs: int = Field(default=600_000, ge=1, le=3_600_000)
    language: str | None = Field(default=None, pattern=r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$")

    @model_validator(mode="after")
    def operation_matches(self) -> "ProcessRequest":
        accepted = MEDIA_TYPES if self.operation == "transcribe" else DOCUMENT_TYPES
        if self.resource.mime not in accepted:
            raise ValueError("MIME type is not supported by the requested operation")
        if self.operation != "transcribe" and self.language is not None:
            raise ValueError("Language is only valid for transcription")
        return self


class TranscriptSegment(StrictModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str = Field(max_length=100_000)

    @model_validator(mode="after")
    def ordered(self) -> "TranscriptSegment":
        if self.end < self.start:
            raise ValueError("Segment end precedes its start")
        return self


class Derived(StrictModel):
    # This is the ready subset of shared/contracts/content.ts assetDerivedSchema.
    status: Literal["ready"] = "ready"
    markdown: str | None = Field(default=None, max_length=2 * 1024**2)
    transcript: list[TranscriptSegment] | None = Field(default=None, max_length=100_000)

    @model_validator(mode="after")
    def one_result(self) -> "Derived":
        if (self.markdown is None) == (self.transcript is None):
            raise ValueError("Return exactly one derived representation")
        return self


class Attachment(StrictModel):
    sha256: AssetHash
    mime: Literal["image/png"]
    size: int = Field(gt=0, le=1024**2)
    width: int = Field(gt=0, le=4_000_000)
    height: int = Field(gt=0, le=4_000_000)
    dataBase64: str = Field(min_length=1, max_length=1_398_104)

    @model_validator(mode="after")
    def valid_png(self) -> "Attachment":
        data = base64.b64decode(self.dataBase64, validate=True)
        if (len(data) != self.size or base64.b64encode(data).decode() != self.dataBase64
                or hashlib.sha256(data).hexdigest() != self.sha256):
            raise ValueError("Attachment integrity mismatch")
        if (len(data) < 45 or data[:16] != b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR"
                or data[-12:] != b"\x00\x00\x00\x00IEND\xaeB`\x82"
                or struct.unpack(">II", data[16:24]) != (self.width, self.height)
                or self.width * self.height > 4_000_000):
            raise ValueError("Attachment must be a bounded PNG matching its dimensions")
        return self


class ProcessorOutput(StrictModel):
    derived: Derived
    attachments: list[Attachment] | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def attachment_references(self) -> "ProcessorOutput":
        attachments = self.attachments or []
        hashes = [attachment.sha256 for attachment in attachments]
        references = re.findall(r"!\[[^\]]*\]\(asset:([a-f0-9]{64})\)", self.derived.markdown or "")
        if len(hashes) != len(set(hashes)) or set(references) != set(hashes):
            raise ValueError("Attachments and Markdown image references must match exactly")
        if sum(attachment.size for attachment in attachments) > 1024**2:
            raise ValueError("Attachment total exceeds the byte budget")
        if attachments and self.derived.markdown is None:
            raise ValueError("Only document conversion may return attachments")
        return self


class ProcessResponse(ProcessorOutput):
    requestId: RequestId
    operation: Operation
    assetHash: AssetHash
    processor: str = Field(min_length=1, max_length=100)
    elapsedMs: int = Field(ge=0)

    @model_validator(mode="after")
    def matching_result(self) -> "ProcessResponse":
        if (self.operation == "transcribe") != (self.derived.transcript is not None):
            raise ValueError("Derived result does not match its operation")
        return self

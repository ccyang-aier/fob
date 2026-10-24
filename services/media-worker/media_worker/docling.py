"""Local Docling conversion. Extracted PNGs are transient HTTP attachments, not assets."""
import base64
import hashlib
import importlib.util
import io
import os
import socket
import warnings
from contextlib import contextmanager

from .docling_config import DoclingSettings
from .document_limits import preflight_document
from .processors import ProcessorFailure, ProcessorInput, ProcessorSpec


def docling_spec() -> ProcessorSpec:
    config = DoclingSettings.from_environment()
    missing = any(importlib.util.find_spec(name) is None for name in
                  ("docling", "docling_core", "docling_ibm_models", "pypdfium2", "docx", "pptx", "openpyxl",
                   "PIL", "torch", "cv2", "defusedxml", "transformers"))
    # Office parsing needs no model weights; PDF checks its local models per request.
    return ProcessorSpec("docling", "media_worker.docling:parse_document", {"config": config},
                         "dependency_missing" if missing else None)


@contextmanager
def offline_document_io():
    """Defence in depth for trusted parser libraries, not an OS security sandbox."""
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    def forbidden(*_args, **_kwargs):
        raise PermissionError("Document conversion network access is disabled")

    original = (socket.socket.connect, socket.socket.connect_ex, socket.create_connection, socket.getaddrinfo)
    socket.socket.connect = socket.socket.connect_ex = socket.create_connection = socket.getaddrinfo = forbidden
    try:
        yield
    finally:
        socket.socket.connect, socket.socket.connect_ex, socket.create_connection, socket.getaddrinfo = original


def extract_images(document, config: DoclingSettings) -> list[dict]:
    from docling_core.types.doc import ImageRef, Size

    if len(document.pictures) > config.max_images:
        raise ProcessorFailure("document_limit_exceeded")
    attachments = {}
    total = 0
    for picture in document.pictures:
        image = picture.get_image(document)
        if image is None:
            raise ProcessorFailure("unsupported_document_content")
        if image.width * image.height > config.max_image_pixels:
            raise ProcessorFailure("document_limit_exceeded")
        image.load()  # Validate actual pixels, not only the container/image metadata.
        output = io.BytesIO()
        image.convert("RGBA" if "A" in image.getbands() else "RGB").save(output, format="PNG")
        data = output.getvalue()
        if len(data) > config.max_image_bytes:
            raise ProcessorFailure("document_limit_exceeded")
        digest = hashlib.sha256(data).hexdigest()
        if digest not in attachments:
            total += len(data)
            if total > config.max_total_image_bytes:
                raise ProcessorFailure("document_limit_exceeded")
            attachments[digest] = {"sha256": digest, "mime": "image/png", "size": len(data),
                                   "width": image.width, "height": image.height,
                                   "dataBase64": base64.b64encode(data).decode("ascii")}
        # These references become usable only after the TypeScript task persists
        # attachments in the source workspace. Python does not access business S3.
        picture.image = ImageRef(mimetype="image/png", dpi=72, size=Size(width=image.width, height=image.height),
                                 uri=f"asset:{digest}")
    return list(attachments.values())


def convert_document(source: ProcessorInput, config: DoclingSettings):
    try:
        from docling.backend.docx.drawingml import utils as office_tools
        from docling.datamodel.accelerator_options import AcceleratorOptions
        from docling.datamodel.base_models import ConversionStatus, InputFormat
        from docling.datamodel.pipeline_options import HeadingHierarchyOptions, PdfPipelineOptions, TableFormerMode
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.exceptions import ConversionError
    except (ImportError, OSError):
        raise ProcessorFailure("dependency_missing") from None

    formats = {".pdf": InputFormat.PDF, ".docx": InputFormat.DOCX, ".pptx": InputFormat.PPTX, ".xlsx": InputFormat.XLSX}
    format_options = {}
    if source.mime == "application/pdf":
        if not config.is_prepared():
            raise ProcessorFailure("model_unavailable")
        import torch
        device = source.device
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        if device == "cuda":
            if not torch.cuda.is_available() or source.device_index >= torch.cuda.device_count():
                raise ProcessorFailure("device_unavailable")
            device = f"cuda:{source.device_index}"
        options = PdfPipelineOptions(
            artifacts_path=config.artifacts_path.resolve(), do_ocr=False, do_table_structure=True,
            do_picture_classification=False, do_picture_description=False,
            do_code_enrichment=False, do_formula_enrichment=False,
            enable_remote_services=False, allow_external_plugins=False,
            generate_picture_images=True, generate_page_images=False, images_scale=1.0,
            generate_parsed_pages=True, heading_hierarchy_options=HeadingHierarchyOptions(enabled=True),
            accelerator_options=AcceleratorOptions(device=device, num_threads=source.cpu_threads),
        )
        options.table_structure_options.mode = TableFormerMode(config.table_mode)
        format_options[InputFormat.PDF] = PdfFormatOption(pipeline_options=options)
    converter = DocumentConverter(allowed_formats=[formats[source.source.suffix]], format_options=format_options)
    if source.mime == "application/pdf":
        try:
            converter.initialize_pipeline(InputFormat.PDF)
        except ImportError:
            raise ProcessorFailure("dependency_missing") from None
        except Exception:
            raise ProcessorFailure("model_unavailable") from None
    # The pinned Docling backends otherwise auto-discover LibreOffice for some
    # drawings even with chart rendering off. Only native local parsing is in
    # scope; do not launch an external application or its network-capable loader.
    discover_office = office_tools.get_libreoffice_cmd
    office_tools.get_libreoffice_cmd = lambda: None
    try:
        result = converter.convert(source.source, raises_on_error=False,
                                   max_num_pages=config.max_pages, max_file_size=config.max_file_bytes)
    except (ImportError, OSError):
        raise ProcessorFailure("dependency_missing") from None
    except ConversionError:
        raise ProcessorFailure("invalid_document") from None
    finally:
        office_tools.get_libreoffice_cmd = discover_office
    if result.status != ConversionStatus.SUCCESS:
        # Never return partially parsed content as a complete ready derivation.
        raise ProcessorFailure("invalid_document")
    return result.document


def parse_document(source: ProcessorInput, *, config: DoclingSettings):
    with offline_document_io():
        preflight_document(source, config)
        try:
            from PIL import Image
            from docling_core.types.doc import ImageRefMode
        except (ImportError, OSError):
            raise ProcessorFailure("dependency_missing") from None
        previous_pixels = Image.MAX_IMAGE_PIXELS
        Image.MAX_IMAGE_PIXELS = config.max_image_pixels
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                document = convert_document(source, config)
                if not (any(text.text.strip() for text in document.texts)
                        or any(cell.text.strip() for table in document.tables for cell in table.data.table_cells)
                        or document.pictures):
                    raise ProcessorFailure("empty_document")
                attachments = extract_images(document, config)
                markdown = document.export_to_markdown(image_mode=ImageRefMode.REFERENCED).strip()
                if not markdown:
                    raise ProcessorFailure("empty_document")
                if len(markdown.encode("utf-8")) > 2 * 1024**2:
                    raise ProcessorFailure("document_limit_exceeded")
                return {"derived": {"status": "ready", "markdown": markdown},
                        **({"attachments": attachments} if attachments else {})}
        except (Image.DecompressionBombWarning, Image.DecompressionBombError):
            raise ProcessorFailure("document_limit_exceeded") from None
        finally:
            Image.MAX_IMAGE_PIXELS = previous_pixels

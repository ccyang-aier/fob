"""Preflight untrusted PDF/OOXML before document models or image rendering."""
from io import BytesIO
from pathlib import PurePosixPath
from zipfile import BadZipFile, ZipFile

from .docling_config import DoclingSettings
from .processors import ProcessorFailure, ProcessorInput

OFFICE_ROOTS = {".docx": "word/document.xml", ".pptx": "ppt/presentation.xml", ".xlsx": "xl/workbook.xml"}


def preflight_document(source: ProcessorInput, config: DoclingSettings) -> None:
    size = source.source.stat().st_size
    if size == 0:
        raise ProcessorFailure("empty_document")
    if size > config.max_file_bytes:
        raise ProcessorFailure("document_limit_exceeded")
    if source.mime == "application/pdf":
        preflight_pdf(source, config)
    else:
        preflight_office(source, config)


def preflight_pdf(source: ProcessorInput, config: DoclingSettings) -> None:
    try:
        import pypdfium2
        with pypdfium2.PdfDocument(source.source) as document:
            if len(document) == 0:
                raise ProcessorFailure("empty_document")
            if len(document) > config.max_pages:
                raise ProcessorFailure("document_limit_exceeded")
            # TableFormer internally renders tables at 2x PDF point resolution.
            if any(width * height * 4 > config.max_page_pixels for width, height in
                   (document.get_page_size(index) for index in range(len(document)))):
                raise ProcessorFailure("document_limit_exceeded")
    except ProcessorFailure:
        raise
    except (ImportError, OSError):
        raise ProcessorFailure("dependency_missing") from None
    except Exception:
        raise ProcessorFailure("invalid_document") from None


def preflight_office(source: ProcessorInput, config: DoclingSettings) -> None:
    from defusedxml import ElementTree
    from defusedxml.common import DefusedXmlException
    try:
        with ZipFile(source.source) as archive:
            entries = archive.infolist()
            if len(entries) > config.max_zip_entries or sum(item.file_size for item in entries) > config.max_uncompressed_bytes:
                raise ProcessorFailure("document_limit_exceeded")
            names = {item.filename for item in entries}
            if "[Content_Types].xml" not in names or OFFICE_ROOTS.get(source.source.suffix) not in names:
                raise ProcessorFailure("invalid_document")
            images = 0
            for entry in entries:
                path = PurePosixPath(entry.filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts or ":" in entry.filename or entry.flag_bits & 1:
                    raise ProcessorFailure("invalid_document")
                if entry.filename.endswith((".xml", ".rels")):
                    content = archive.read(entry)
                    # Parse safely rather than byte-matching: XML may be UTF-16.
                    ElementTree.fromstring(content, forbid_dtd=True, forbid_entities=True, forbid_external=True)
                if "/media/" in entry.filename and path.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".webp"):
                    from PIL import Image, UnidentifiedImageError
                    images += 1
                    if images > config.max_images:
                        raise ProcessorFailure("document_limit_exceeded")
                    try:
                        with Image.open(BytesIO(archive.read(entry))) as image:
                            if image.width * image.height > config.max_image_pixels:
                                raise ProcessorFailure("document_limit_exceeded")
                            image.verify()
                    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
                        raise ProcessorFailure("document_limit_exceeded") from None
                    except (UnidentifiedImageError, OSError, SyntaxError):
                        raise ProcessorFailure("invalid_document") from None
            if source.source.suffix == ".pptx":
                slides = sum(name.startswith("ppt/slides/slide") and name.endswith(".xml") for name in names)
                if slides > config.max_pages:
                    raise ProcessorFailure("document_limit_exceeded")
                if slides == 0:
                    raise ProcessorFailure("empty_document")
            if source.source.suffix == ".xlsx":
                sheets = sum(name.startswith("xl/worksheets/sheet") and name.endswith(".xml") for name in names)
                if sheets > config.max_pages:
                    raise ProcessorFailure("document_limit_exceeded")
    except ProcessorFailure:
        raise
    except (BadZipFile, KeyError, ValueError, OSError, RuntimeError, SyntaxError, DefusedXmlException):
        raise ProcessorFailure("invalid_document") from None

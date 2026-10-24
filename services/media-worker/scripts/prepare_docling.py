"""Prefetch only the explicitly selected Docling layout/table models, anonymously."""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"

from huggingface_hub import HfApi
from media_worker.docling_config import DoclingSettings
from model_download import retry, verified_download


def main():
    config = DoclingSettings.from_environment()
    plans = []
    total = 0
    for repository, revision, required in config.model_files():
        info = retry(lambda: HfApi(token=False).model_info(repository, revision=revision, files_metadata=True, token=False))
        files = [entry for entry in info.siblings if entry.rfilename in required]
        if len(files) != len(required) or any(entry.size is None for entry in files):
            raise RuntimeError("Official Docling model metadata is incomplete; no unbounded download attempted.")
        total += sum(entry.size for entry in files)
        plans.append((repository, info.sha, files))
    if total > config.max_download_bytes:
        raise RuntimeError(f"Docling models require {total} bytes, above the configured {config.max_download_bytes}-byte budget.")
    print(f"Preparing public layout + {config.table_mode} table models: {total} bytes.", flush=True)
    evidence = []
    for repository, revision, files in plans:
        target = config.artifacts_path / repository.replace("/", "--")
        for entry in files:
            evidence.append({"repository": repository, "revision": revision,
                             **verified_download(repository, revision, entry, target)})
    manifest = {"bytes": total, "tableMode": config.table_mode, "ocr": False, "files": evidence}
    (config.artifacts_path / "fob-models.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("PASS Docling preparation: bounded verified local models; no OCR/VLM weights downloaded.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else f"Docling preparation failed ({type(error).__name__}).", file=sys.stderr)
        sys.exit(1)

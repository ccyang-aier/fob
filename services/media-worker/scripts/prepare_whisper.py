"""Explicit, size-bounded public model preparation; never uses implicit HF keys."""
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
from media_worker.whisper_config import MODEL_FILES, MODEL_REPOSITORIES, REQUIRED_MODEL_FILES, WhisperSettings
from model_download import retry, verified_download


def main():
    config = WhisperSettings.from_environment()
    if config.model_path is not None:
        raise RuntimeError("Explicit model_path is local-only; prepare the managed model cache without this override.")
    repo = MODEL_REPOSITORIES[config.model]
    info = retry(lambda: HfApi(token=False).model_info(repo, files_metadata=True, token=False))
    files = [entry for entry in info.siblings if entry.rfilename in MODEL_FILES]
    if not set(REQUIRED_MODEL_FILES).issubset({entry.rfilename for entry in files}) or any(entry.size is None for entry in files):
        raise RuntimeError("Official model metadata is incomplete; no unbounded download attempted.")
    total = sum(entry.size for entry in files)
    if total > config.max_download_bytes:
        raise RuntimeError(f"Model requires {total} bytes, above the configured {config.max_download_bytes}-byte download budget.")
    config.directory.mkdir(parents=True, exist_ok=True)
    print(f"Preparing public {repo} at revision {info.sha}: {total} bytes in the isolated model cache.", flush=True)
    evidence = []
    for entry in files:
        evidence.append(verified_download(repo, info.sha, entry, config.directory))
    manifest = {"repository": repo, "revision": info.sha, "bytes": total, "files": evidence}
    (config.directory / "fob-model.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("PASS model preparation: size and checksums verified; HTTP inference uses local files only.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else f"Model preparation failed ({type(error).__name__}).", file=sys.stderr)
        sys.exit(1)

"""Shared explicit model transfers; preparation commands enforce their own budgets."""
import hashlib
import time
from pathlib import Path

from huggingface_hub import hf_hub_download


def retry(operation):
    for attempt in range(3):
        try:
            return operation()
        except Exception as error:
            if attempt == 2:
                raise RuntimeError(f"Public model preparation failed ({type(error).__name__}); no credentials were used.") from None
            print(f"Public model transfer retry {attempt + 1}/2 ({type(error).__name__}).", flush=True)
            time.sleep(2 ** attempt)


def verified_download(repository, revision, entry, directory: Path) -> dict:
    downloaded = Path(retry(lambda: hf_hub_download(repository, entry.rfilename, revision=revision,
                                                   local_dir=directory, token=False)))
    if downloaded.stat().st_size != entry.size:
        raise RuntimeError("Model artifact size does not match official metadata.")
    with downloaded.open("rb") as content:
        digest = hashlib.file_digest(content, "sha256").hexdigest()
    if entry.lfs is not None and digest != entry.lfs.sha256:
        raise RuntimeError("Model artifact checksum does not match official metadata.")
    print(f"Verified {entry.rfilename}: {entry.size} bytes.", flush=True)
    return {"name": entry.rfilename, "bytes": entry.size, "sha256": digest}

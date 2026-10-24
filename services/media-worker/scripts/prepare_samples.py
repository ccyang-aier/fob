"""Real public speech fixture plus a reproducible video container of that speech."""
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / ".cache" / "samples"
SOURCE = "https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac"


def main():
    SAMPLES.mkdir(parents=True, exist_ok=True)
    audio = SAMPLES / "jfk.flac"
    if not audio.exists():
        with httpx.stream("GET", SOURCE, follow_redirects=False, timeout=30) as response:
            response.raise_for_status()
            content = bytearray()
            for chunk in response.iter_bytes():
                content.extend(chunk)
                if len(content) > 5 * 1024**2:
                    raise RuntimeError("Official test sample exceeds the fixture download budget.")
        audio.write_bytes(content)
    video = SAMPLES / "jfk-video.mp4"
    if not video.exists():
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg is None:
            raise RuntimeError("The sample packaging command needs an existing FFmpeg executable; no global installation was attempted.")
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                        "color=c=black:s=320x180:r=10", "-i", str(audio), "-shortest",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", str(video)],
                       check=True, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    import av
    evidence = {"source": SOURCE, "videoNote": "Black video track plus the same genuine JFK speech; not a separate acoustic sample.", "files": []}
    for sample in (audio, video):
        with av.open(str(sample)) as container:
            streams = [{"type": stream.type, "codec": stream.codec_context.name} for stream in container.streams]
            duration = container.duration / av.time_base
        with sample.open("rb") as content:
            digest = hashlib.file_digest(content, "sha256").hexdigest()
        evidence["files"].append({"name": sample.name, "bytes": sample.stat().st_size, "sha256": digest,
                                  "durationSeconds": duration, "streams": streams})
    (SAMPLES / "samples.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()

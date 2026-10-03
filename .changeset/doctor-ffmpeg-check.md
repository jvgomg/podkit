---
'podkit': minor
'@podkit/core': minor
---

`podkit doctor` now has an **FFmpeg** system check that fails when FFmpeg is not installed or will not run. Previously a host with no FFmpeg reported healthy and exited 0 — the codec and video encoder checks quietly skipped — so `podkit doctor --scope system` now exits 2 in that case. The encoder checks still skip when FFmpeg is missing, pointing at the new check, and now warn instead of skipping when FFmpeg runs but its encoder list cannot be read. The video encoder check probes the same `ffmpeg` on `PATH` that sync uses, rather than honouring `FFMPEG_PATH`, which nothing else read.

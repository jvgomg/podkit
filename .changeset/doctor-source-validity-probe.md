---
"podkit": patch
"@podkit/core": patch
---

`podkit doctor` (artwork-rebuild repair) now runs a per-track source-file validity probe (stat + 16-byte magic-byte header check) before the album-cache lookup. Corrupt or unreadable source files always land in the `errors` bucket with a structured reason (`missing | unreadable | truncated | badMagic`) rather than inheriting a sibling track's cache success non-deterministically.

The `details.errorDetails[*]` in doctor's JSON output now carries optional `path` and `reason` fields so users can act on specific bad files. Backward-compatible: existing `artist` / `title` / `error` fields are preserved.

Magic-byte signatures cover FLAC, OGG/Opus, MP3 (ID3 and bare MPEG sync), MP4/M4A/AAC, WAV, AIFF/AIFC — matching the directory adapter's accepted extensions.

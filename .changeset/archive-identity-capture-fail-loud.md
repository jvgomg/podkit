---
"podkit": minor
---

`podkit device archive` now fails loudly when a device's firmware identity could not be captured, instead of silently producing an archive with missing model/serial/capacity/colour fields.

**Behavior change:** archiving a connected iPod with no on-disk `SysInfoExtended` (every iPod shuffle, and any device whose identity file is missing or corrupt) now requires a successful live firmware capture. If that capture is attempted and does not succeed, the command stops with a typed error instead of quietly degrading. Pass `--force` to proceed anyway — the archive still completes, but records the gap honestly: a note in `README.md` and an `identity_capture_failed` / `identity_capture_failure_reason` pair in `library.sqlite`'s `device` row, rather than leaving the fields blank with no explanation.

This is not gated when there is no live USB device to correlate with the volume at all (an unsupported platform, or a plain directory passed to `--device <path>` that isn't a currently-attached iPod) — that case degrades exactly as before, since no retry or `--force` would ever change the outcome.

`library.sqlite`'s schema version moves from 1 to 2 for the new `device` columns.

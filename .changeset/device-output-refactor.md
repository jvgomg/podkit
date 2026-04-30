---
"podkit": minor
"@podkit/core": patch
---

Improve device command output: USB model in scan, SysInfo mismatch detection, summary/issues layout

- `podkit device scan` now shows the USB-detected iPod model (e.g., "iPod Classic 6th generation (USB)") and always runs USB discovery in parallel with disk scanning
- `podkit device scan` and `podkit doctor` detect generation mismatches between SysInfo and USB data, warning when the SysInfo file may have been copied from a different device
- `podkit device info`, `podkit device scan`, and `podkit doctor` now separate compact check summaries from detailed issue explanations — warnings and fix commands appear in a dedicated "Issues" section instead of inline
- New `lookupGenerationByModelNumber()` function in `@podkit/core` for resolving iPod generation from SysInfo model numbers

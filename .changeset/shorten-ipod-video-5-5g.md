---
'@podkit/core': patch
---

`shortenIpodLabel` (the short-label helper used in `device scan` / `device list` / `device info`) now compresses decimal-ordinal generations: `iPod Video (5.5th Generation)` → `iPod Video 5.5G`. The 5.5G iPod Video previously surfaced its full upstream string in short-label cells because the shortener's regex only matched integer ordinals (`3rd`, `5th`).

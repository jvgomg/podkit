---
"podkit": minor
"@podkit/core": minor
---

Enforce the device bitrate cap on lossy tracks at add time (single-sync convergence)

A brand-new lossy source (MP3, AAC) whose bitrate is above the device cap is now re-encoded **down to the cap on the first add**, instead of being copied as-is and capped on the next sync. A fresh over-cap library converges to the cap in a single sync rather than over two.

The on-add cap produces exactly what a later device-bound cap-down would: the resolved lossy codec at the cap, with the cap recorded in the sync tag — so re-syncing at the same cap is a no-op (idempotent). Sources within the source-proximity tolerance of the cap (default 25%), and sources with an unknown bitrate, are still copied verbatim (no needless lossy re-encode). When the reduction axis is `preserve` (`[bitrate].reduce = never`, or `auto` with `fast`/`portable` transfer mode), the source is copied as-is even when above the cap. Works on both iPod and mass-storage devices.

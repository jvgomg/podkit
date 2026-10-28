---
"podkit": minor
"@podkit/core": minor
---

Add an iPod nano 7th generation video profile

Videos for a Nano 7 are now encoded for its 240x432 screen held sideways: fitted into 432x240 with the aspect ratio kept (a 16:9 film becomes 426x240), H.264 Baseline level 3.0, at most 30 fps, AAC-LC audio in M4V. Bitrates are the 320x240 tiers scaled by the extra pixels: 1000, 800, 550 and 400 kbps for `max`, `high`, `medium` and `low`.

The profile is chosen from podkit's own device identification, so it applies even though libgpod reports the Nano 7 as an unknown generation. Before, an unknown generation fell back to the iPod Classic profile (640x480 Main). The Nano 6 has no video playback and is unchanged.

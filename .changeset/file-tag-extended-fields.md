---
"podkit": minor
"@podkit/core": minor
---

Write composer, grouping, track/disc totals and sort fields into file tags

Under `transferMode = "portable"` composer, grouping, the totals and the sort fields, including clears, are now written into the iPod's file tags as well as its database, and podkit's tag writer (also used for mass-storage tag updates) writes them for MP3, M4A, FLAC, OGG and Opus. Several composers are kept as separate values. iTunes-style ID3v2.3 tags keep their title, artist and album sort frames on every tag write, and a grouping stored in iTunes' GRP1 frame is read and written there, leaving the work title in TIT1 alone. Mass-storage change detection is unchanged.

With `transferMode = "portable"`, a track whose database entry a sync updates for these fields gets the same change in its file tags. No audio is copied or re-encoded for it.

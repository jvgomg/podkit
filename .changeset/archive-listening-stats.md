---
"podkit": minor
---

Add listening stats to iPod archives

`podkit device archive` now records play/skip history in the archive's `README.md` and `report.json`: total play and skip counts, plus the top 10 played tracks, top 5 played artists, top 10 skipped tracks, and top 6 skipped artists (each line carries its count). Sections are omitted when a device has no play/skip history (e.g. firmware that never recorded it), so music-only or fresh dumps stay clean.

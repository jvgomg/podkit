---
"podkit": minor
"@podkit/core": minor
---

Fix mass-storage directory structure to use album artist instead of track artist, and add template-based path system with self-healing relocate.

**Bug fix:** Mass-storage devices (Echo Mini, Rockbox) now use `albumArtist` for directory grouping, falling back to `artist` when absent. Previously, compilation/various-artist albums had their tracks scattered across separate artist directories instead of being grouped together under the album artist.

**Path templates:** File paths are now generated from a configurable template string (`{albumArtist}/{album}/{trackNumber} - {title}{ext}` by default). This lays the groundwork for user-customisable folder structures in a future release.

**Self-healing relocate:** When source metadata changes (e.g. album artist corrected) or the path template changes, the next sync detects the path mismatch and moves files to their correct location via `fs.rename()` — no re-copying of audio data. Relocate operations appear in dry-run output and are tracked as a new `relocate` operation type.

---
'@podkit/core': patch
---

Fix two artwork/codec sync bugs surfaced by the art-matrix test suite:

- **Album artwork is now deterministic regardless of track scan order.** The album-level artwork cache previously remembered the first track's extraction result for the whole album — so whether a WAV/OGG/Opus track ended up with the album cover depended on which sibling was processed first (and differed between the directory and Subsonic adapters). The cache now pre-resolves each album from a preference-ordered candidate list (embed-capable containers first) and no longer caches a negative result in single-source mode, so every track in an album inherits the same cover.
- **MP3 no longer fires a spurious `codec-changed` re-copy on every sync.** `postProcessCodecChanges` assumed any lossy source would be transcoded to the resolved lossy codec; for an MP3 source on an MP3-capable device the classifier actually direct-copies, so the codec comparison fired `upgrade-direct-copy: codec-changed` on each incremental sync. The pass now asks the classifier and skips when the source is copied rather than transcoded.

---
"podkit": minor
"@podkit/core": minor
---

Fix track metadata convergence on mass-storage devices and add transfer-mode-aware on-disk tag writes for iPod portable.

**Bug fix (mass-storage)**: `MassStorageAdapter.updateTrack` previously only wrote `comment`, OGG/Opus artwork, and ReplayGain to disk. All other metadata fields (title, artist, album, albumArtist, genre, year, trackNumber, discNumber, compilation) updated in-memory only — the file's embedded tags on the device were never rewritten. After a relocate or metadata-correction sync the next sync re-detected the same diff every time, looping forever as a zero-byte `update-metadata` op.

`MassStorageAdapter` now queues every changed textual tag in a single `pendingTagWrites` map and flushes them as one `writeTags(filePath, fields)` call per file via `Promise.allSettled`. Per-file failures are aggregated and re-thrown so the sync executor can categorise them.

**New behaviour (iPod portable)**: `IpodDeviceAdapter` now mirrors iTunesDB metadata into the on-disk file tags when `transferMode === 'portable'`. This makes files pulled off the iPod self-describing for re-import into a music library. `fast` and `optimized` modes still touch iTunesDB only — the iPod firmware reads metadata from iTunesDB and never falls back to file tags during playback, so paying the tag-rewrite cost in those modes would be wasted work.

Tag writes are best-effort on iPod portable: failures are surfaced as warnings, not hard errors, because the iTunesDB write (the authoritative store for playback) already succeeded.

**`addTrack` consistency**: When `transferMode === 'portable'`, both backends now also rewrite tags on first transfer to honour any collection-adapter transforms (e.g. clean-artists, Subsonic-side corrections) that FFmpeg's `-map_metadata 0` would otherwise copy through from the source.

**On first sync after upgrade**: Existing mass-storage tracks will likely report a `metadata-correction` op on the next sync as stale on-disk tags converge to source values. These are zero-byte writes — no transcoding or transfers happen — but the operation list will look longer than usual for one cycle.

**Scope notes**:
- Match-key changes (title, artist, album corrections) still produce a remove+add rather than a metadata update. By design: when those fields change, podkit treats it as a different track.
- Virtual-iPod (m-17) inherits the iPod behaviour automatically; no changes needed there.

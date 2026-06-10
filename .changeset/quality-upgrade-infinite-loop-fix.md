---
"podkit": patch
"@podkit/core": patch
---

Fixes an infinite loop in the music sync quality-upgrade path. When a track was upgraded via direct copy (no transcode) — for example when the source bitrate increased after a re-rip — `transferUpgradeToIpod` wrote the post-encode bitrate from the preparer, which is undefined for direct copies. The file was replaced on the device but the iPod-side bitrate stayed at the previous value, so the next sync detected the same upgrade again and re-fired it indefinitely.

The fix resolves the post-upgrade bitrate as `prepared.bitrate ?? source.bitrate` so direct-copy upgrades carry the source bitrate through. The upgrade now converges on a single sync.

Adds a `--force-sync-tags` bitrate backfill pass for pre-existing copied tracks whose iPod-side bitrate is 0 — symmetric with the existing artwork-hash baseline backfill. New users get correct bitrate tracking on first sync; existing users opt in with `--force-sync-tags`.

Documents the upgrade-path semantics (format-upgrade gate, quality-upgrade gate, baseline write + backfill) in `documents/architecture/sync/upgrades.md`.

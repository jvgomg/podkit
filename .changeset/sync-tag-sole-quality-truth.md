---
"podkit": minor
"@podkit/core": minor
---

Make the sync tag the sole quality truth for audio, and add `--force-sync-tags-transcode`.

A track that podkit did not encode (no sync tag) is now left alone by ordinary syncs: it is opted out of bitrate/encoding re-checks rather than guessed from the unreliable iPod database bitrate. This removes the old DB-bitrate + tolerance fallback, so upgrading with a library of untagged tracks no longer triggers a surprise re-encode storm.

To deliberately bring untagged tracks into line, use the new `--force-sync-tags-transcode` flag: it re-encodes untagged matched tracks to the device's quality target and writes the authoritative sync tag (bitrate + encoding). This is the only path where a missing sync tag triggers a re-encode — it is explicit and destructive, never automatic. `--force-sync-tags` keeps its existing tag-only, non-destructive behaviour; when both flags are passed, the transcode flag wins for untagged tracks.

The legacy `bitrateTolerance` setting is reinterpreted: its old role slackening the (now-removed) DB-bitrate fallback is gone; it now acts as a default damper for the source-bound lossy comparison (`toleranceUp` / `toleranceDown` take precedence when set).

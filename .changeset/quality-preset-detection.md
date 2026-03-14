---
"@podkit/core": minor
"podkit": minor
---

Detect quality preset changes and re-transcode existing tracks. When you change your audio or video quality preset (e.g., `low` to `high`), podkit now detects that existing transcoded content doesn't match the new target bitrate and re-transcodes it on the next sync. Both upgrade and downgrade directions are supported.

Audio preset changes appear as `preset-upgrade` or `preset-downgrade` in the sync plan, preserving play counts, star ratings, and playlist membership. Video preset changes remove and re-add the video at the new quality. Use `--skip-upgrades` to suppress audio preset re-transcoding.

Fix inverted `aac_at` encoder quality mapping on macOS — the AudioToolbox AAC encoder uses a 0-14 scale where 0 is highest quality, but the code mapped it backwards. This caused VBR presets to encode at the wrong quality level (e.g., "high" produced ~44 kbps instead of ~256 kbps). Now uses empirically-measured bitrate-to-quality mapping.

Fix video transcoding storing source file bitrate instead of transcoded output bitrate in the iPod database, which is needed for video preset change detection.

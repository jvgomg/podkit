---
"podkit": minor
---

Add environment variable support for defining collections and devices without a config file. Set `PODKIT_MUSIC_PATH=/music` to configure a music collection entirely via env vars — no config file needed. Supports named collections (`PODKIT_MUSIC_MAIN_PATH`), Subsonic sources (`PODKIT_MUSIC_TYPE=subsonic`), and video collections (`PODKIT_VIDEO_PATH`). Device `volumeUuid` is now optional, and UUID validation protects against syncing to the wrong iPod when configured.

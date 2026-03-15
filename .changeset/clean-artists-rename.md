---
"podkit": minor
"@podkit/core": minor
---

Rename `ftintitle` transform to `cleanArtists` with a simpler config format

**Breaking change** (minor bump — not yet v1): The `[transforms.ftintitle]` config section has been replaced with a top-level `cleanArtists` key. This is a cleaner, more intuitive name that communicates the feature's value. The new format supports both a simple boolean (`cleanArtists = true`) and a table form with options (`[cleanArtists]`). Per-device overrides use `cleanArtists = false` or `[devices.<name>.cleanArtists]`. Environment variables `PODKIT_CLEAN_ARTISTS`, `PODKIT_CLEAN_ARTISTS_DROP`, `PODKIT_CLEAN_ARTISTS_FORMAT`, and `PODKIT_CLEAN_ARTISTS_IGNORE` are now supported. The `FtInTitleConfig` type is renamed to `CleanArtistsConfig` and `DEFAULT_FTINTITLE_CONFIG` to `DEFAULT_CLEAN_ARTISTS_CONFIG`.

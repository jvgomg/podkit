---
"@podkit/core": minor
"podkit": minor
---

Improve video filename parsing and add show language transform for video sync

**Filename parsing improvements:**
- Add anime fansub filename pattern support (`[Group]_Show_Name_EP_(codec)_[CRC].ext`)
- Prefer folder-based series titles over filename-only parsing for richer metadata
- Strip scene release cruft (quality tags, codecs, release groups) from episode titles
- Detect language and edition tags from filenames and folder paths
- Add `language` and `edition` optional fields to `CollectionVideo`

**Show language transform:**
- Add configurable `showLanguage` transform that reformats language markers in video series titles (e.g., `(JPN)` → `(Japanese)`)
- Enabled by default with abbreviated format — configure via config file, per-device overrides, or `PODKIT_SHOW_LANGUAGE*` env vars
- Changing language display preferences causes metadata-only updates, not file re-transfers (dual-key matching in video differ)

**CLI:**
- Add `showLanguage` config support (boolean shorthand or `[showLanguage]` table with `format` and `expand` options)
- Add per-device `showLanguage` overrides
- Show transform info in `--dry-run` output
- Add `@podkit/libgpod-node` as explicit dependency for reliable native binding resolution in worktrees

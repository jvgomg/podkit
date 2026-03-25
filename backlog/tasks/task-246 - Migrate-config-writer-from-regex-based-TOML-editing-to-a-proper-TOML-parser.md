---
id: TASK-246
title: Migrate config writer from regex-based TOML editing to a proper TOML parser
status: To Do
assignee: []
created_date: '2026-03-25 03:25'
labels:
  - tech-debt
  - config
dependencies: []
references:
  - packages/podkit-cli/src/config/writer.ts
  - packages/podkit-cli/src/config/loader.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The config writer (`packages/podkit-cli/src/config/writer.ts`) currently uses regex-based string manipulation to read, modify, and write TOML config files. This is fragile and increasingly inadequate as the config schema grows.

**Current problems:**
- `updateDevice()` uses single-line regex (`^key\s*=\s*.*$`) to find and replace values. This breaks for multi-line TOML arrays (e.g. hand-edited `artworkSources` or `supportedAudioCodecs` split across lines).
- `removeDevice()` uses complex section-boundary regexes that are hard to reason about.
- Adding new field types (arrays, nested tables) requires careful regex crafting each time.
- No round-trip preservation guarantees — comments and formatting may be lost.

**Proposed approach:**
Use a TOML library that supports round-trip editing (parse → modify → serialize while preserving comments and formatting). The `smol-toml` library already used for reading in `loader.ts` may not support round-trip; evaluate alternatives like `@iarna/toml` or `toml-edit`.

**Example of current fragility:**
```toml
# This works (single-line, written by addDevice):
supportedAudioCodecs = ["aac", "mp3", "flac"]

# This breaks --clear-supported-audio-codecs (multi-line, hand-edited):
supportedAudioCodecs = [
  "aac",
  "mp3",
  "flac",
]
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Config writer uses a TOML library for parsing and serialization instead of regex
- [ ] #2 Multi-line TOML arrays can be set, updated, and cleared correctly
- [ ] #3 Comments and formatting in user-edited config files are preserved on write
- [ ] #4 All existing writer tests pass with the new implementation
- [ ] #5 addDevice, updateDevice, removeDevice, setDefaultDevice all work with the new approach
<!-- AC:END -->

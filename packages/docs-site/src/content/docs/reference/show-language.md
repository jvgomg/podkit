---
title: Show Language Transform
description: Reference for the showLanguage video transform — display language/region markers on iPod for multi-language video collections.
sidebar:
  order: 5
---

The `showLanguage` transform controls how language and region markers in video series titles appear on your iPod. It's designed for collections with multiple language versions of the same show (e.g., Japanese original, English dub, Chinese dub).

## How It Works

When your video files are organized with language markers in folder names:

```
Movies/
  Digimon Adventure (JPN)/Season 01/...
  Digimon Adventure (CHN)/Season 01/...
  Digimon Digital Monsters (USA Dub)/Season 01/...
```

The series title on the iPod includes the language marker — e.g., "Digimon Adventure (JPN)". The `showLanguage` transform lets you control the format of this marker.

## Configuration Reference

Enabled by default with abbreviated language codes. The simplest way to change behavior:

```toml
showLanguage = false  # Strip language markers from display
```

For more control, use the table form:

```toml
[showLanguage]
format = "({})"    # Format string, {} is replaced with language
expand = false     # If true, expand abbreviations (JPN → Japanese)
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Whether to show language markers |
| `format` | string | `"({})"` | Format string for the language marker. `{}` is replaced with the language code or name |
| `expand` | boolean | `false` | If `true`, expand abbreviations to full names (JPN → Japanese, CHN → Chinese) |

### Per-Device Override

Device-level settings override the global `showLanguage` setting:

```toml
[devices.myipod.showLanguage]
expand = true  # Show full language names on this device

[devices.nano]
showLanguage = false  # Don't show language markers on nano
```

## Format Examples

| Format | expand | Input | Result |
|--------|--------|-------|--------|
| `({})` | `false` | Digimon Adventure (JPN) | Digimon Adventure (JPN) |
| `({})` | `true` | Digimon Adventure (JPN) | Digimon Adventure (Japanese) |
| `[{}]` | `false` | Digimon Adventure (JPN) | Digimon Adventure [JPN] |
| `- {} Dub` | `false` | Digimon Adventure (JPN) | Digimon Adventure - JPN Dub |
| `({})` | `true` | Show (CHN) | Show (Chinese) |

## Supported Language Codes

| Code | Expands To |
|------|------------|
| JPN | Japanese |
| ENG | English |
| CHN | Chinese |
| KOR | Korean |
| FRE | French |
| GER | German |
| SPA | Spanish |
| ITA | Italian |
| USA | American |
| POR | Portuguese |
| RUS | Russian |

Full language names (e.g., "Japanese", "Chinese") in folder names are also recognized and can be contracted to abbreviations when `expand` is `false`.

## Sync Behavior

The transform is **metadata-only** — changing your `showLanguage` preferences never causes video files to be re-transferred. When you change the format or toggle the transform:

- `podkit sync --dry-run` shows how many videos will have metadata updates
- `podkit sync` applies the metadata changes instantly (no transcoding)

This works because podkit matches videos by their original series title + season + episode, independent of how the language marker is formatted for display.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PODKIT_SHOW_LANGUAGE` | Enable/disable (`true`/`false`) |
| `PODKIT_SHOW_LANGUAGE_FORMAT` | Format string |
| `PODKIT_SHOW_LANGUAGE_EXPAND` | Expand abbreviations (`true`/`false`) |

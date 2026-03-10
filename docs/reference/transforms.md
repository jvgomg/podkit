---
title: Transforms
description: Reference for metadata transforms that modify track information during sync.
sidebar:
  order: 4
---

# Metadata Transforms

Transforms modify track metadata during sync without altering source files. This allows per-device customization of how tracks appear on the iPod.

## Overview

```
Source Files          Transform Pipeline         iPod
+-------------+      +------------------+      +-------------+
| Artist: A   |      |                  |      | Artist: A   |
| feat. B     | ---> |  ftintitle       | ---> |             |
|             |      |  (and others)    |      | Title: Song |
| Title: Song |      |                  |      | (feat. B)   |
+-------------+      +------------------+      +-------------+
```

Key principles:

- **Source files are never modified** - transforms only affect what's written to the iPod
- **Transforms are reversible** - disabling a transform updates iPod tracks back to original metadata
- **Config-driven** - transforms are configured in `config.toml`

## Configuration

### Global Config

```toml
[transforms.ftintitle]
enabled = true
drop = false
format = "feat. {}"
```

### Per-Device Config (Future)

When multi-device config is fully implemented:

```toml
[devices.terapod.transforms.ftintitle]
enabled = true
format = "feat. {}"

[devices.nano]
# No transforms - uses original metadata
```

## Available Transforms

### ftintitle

Moves "featuring" artists from the Artist field to the Title field. This keeps artist lists clean on iPods (which don't respect the Album Artist field).

**Before:**
- Artist: `"Artist A feat. Artist B"`
- Title: `"Song Name"`

**After:**
- Artist: `"Artist A"`
- Title: `"Song Name (feat. Artist B)"`

#### Configuration

```toml
[transforms.ftintitle]
enabled = true       # Enable the transform (default: false)
drop = false         # If true, drop feat. info entirely (default: false)
format = "feat. {}"  # Format string, {} is replaced with featured artist
```

#### Patterns Recognized

The transform recognizes these featuring indicators (case-insensitive):

- `feat.` / `feat`
- `featuring`
- `ft.` / `ft`
- `with`
- `vs`
- `and` / `&` / `con`

#### Bracket Positioning

When the title contains brackets like `(Remix)` or `(Live)`, the featuring info is inserted *before* them:

- Input: Artist `"A ft. B"`, Title `"Song (Radio Edit)"`
- Output: Artist `"A"`, Title `"Song (feat. B) (Radio Edit)"`

Keywords that trigger this positioning:
`remix`, `edit`, `live`, `remaster`, `version`, `mix`, `instrumental`, `extended`, `demo`, `acapella`, `club`, `radio`, `vip`, `rmx`

#### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Title already has feat. info | Skip (don't double-add) |
| No featuring indicator | Pass through unchanged |
| `drop = true` | Remove feat. from artist, don't add to title |

#### Attribution

This transform is ported from the [beets ftintitle plugin](https://beets.readthedocs.io/en/stable/plugins/ftintitle.html):

> Original: Copyright 2016, Verrus
> Source: https://github.com/beetbox/beets/blob/master/beetsplug/ftintitle.py
> License: MIT

## CLI Output

### Dry Run

```
$ podkit sync --dry-run

Transforms:
  ftintitle: enabled (format: "feat. {}")

Summary:
  Tracks to add: 5
  Tracks to update: 147
    Apply ftintitle: 145
    Metadata changed: 2
  Tracks to remove: 0
  Already synced: 1,262

Tracks to update (transform):
  Artist A feat. Artist B - Song Name
    -> Artist: "Artist A"
    -> Title: "Song Name (feat. Artist B)"
```

### Sync

```
$ podkit sync

Transforms:
  ftintitle: enabled

Syncing 152 tracks...
  [====================================] 100%

Summary:
  Added: 5
  Updated: 147 (145 ftintitle, 2 metadata)
  Removed: 0
```

## Future Transforms

The transform system is designed to be extensible. Potential future transforms:

| Transform | Description |
|-----------|-------------|
| `normalize-case` | Title case or sentence case for titles |
| `genre-mapping` | Consolidate similar genres |
| `strip-remaster` | Remove "(Remastered)" from titles |
| `year-from-album` | Extract year from album title |

## See Also

- [Configuration](/user-guide/configuration) - Config file options
- [CLI Commands](/reference/cli-commands) - Command-line reference

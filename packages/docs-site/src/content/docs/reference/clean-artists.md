---
title: Clean Artists Transform
description: Detailed reference for the cleanArtists feature — configuration options, recognized patterns, and edge cases.
sidebar:
  order: 4
---

The `cleanArtists` feature moves featured artist credits from the Artist field into the Title field during sync. For a user-friendly introduction and setup guide, see [Artist Transforms](/user-guide/devices/artist-transforms).

## Origins

This transform is inspired by and ported from the [beets ftintitle plugin](https://beets.readthedocs.io/en/stable/plugins/ftintitle.html), which does the same thing when importing music into a beets library.

> Original: Copyright 2016, Verrus
> Source: https://github.com/beetbox/beets/blob/master/beetsplug/ftintitle.py
> License: MIT

## Configuration Reference

The simplest form is a boolean:

```toml
cleanArtists = true
```

For more control, use the table form (implies enabled):

```toml
[cleanArtists]
drop = false         # If true, drop feat. info entirely (default: false)
format = "feat. {}"  # Format string, {} is replaced with featured artist
ignore = ["Simon & Garfunkel"]  # Don't split these artist names
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `drop` | boolean | `false` | If `true`, drop featuring info entirely instead of moving to title |
| `format` | string | `"feat. {}"` | Format string for featuring text in title (`{}` is replaced with artist names) |
| `ignore` | string[] | `[]` | Artist names to ignore when splitting on ambiguous separators (`and`, `&`, `with`) |

### Per-Device Override

Device-level settings override the global `cleanArtists` setting:

```toml
[devices.myipod.cleanArtists]
format = "feat. {}"

[devices.nano]
cleanArtists = false  # Uses original metadata
```

## Patterns Recognized

The transform recognizes these featuring indicators (case-insensitive):

- `feat.` / `feat`
- `featuring`
- `ft.` / `ft`
- `with`
- `vs`
- `and` / `&` / `con`

## Before and After Examples

| | Artist | Title |
|---|--------|-------|
| **Before** | Daft Punk feat. Pharrell Williams | Get Lucky |
| **After** | Daft Punk | Get Lucky (feat. Pharrell Williams) |

| | Artist | Title |
|---|--------|-------|
| **Before** | A ft. B | Song (Radio Edit) |
| **After** | A | Song (feat. B) (Radio Edit) |

| | Artist | Title |
|---|--------|-------|
| **Before** | Artist A featuring Artist B | Track Name |
| **After** | Artist A | Track Name (feat. Artist B) |

## Bracket Positioning

When the title contains brackets like `(Remix)` or `(Live)`, the featuring info is inserted *before* them:

- Input: Artist `"A ft. B"`, Title `"Song (Radio Edit)"`
- Output: Artist `"A"`, Title `"Song (feat. B) (Radio Edit)"`

Keywords that trigger this positioning:
`remix`, `edit`, `live`, `remaster`, `version`, `mix`, `instrumental`, `extended`, `demo`, `acapella`, `club`, `radio`, `vip`, `rmx`

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Title already has feat. info | Skip (don't double-add) |
| No featuring indicator | Pass through unchanged |
| `drop = true` | Remove feat. from artist, don't add to title |

## The ignore List

Some artist names naturally contain words like "and", "&", or "with" that the transform would otherwise treat as featuring indicators. Add these to the `ignore` list to prevent incorrect splitting:

```toml
[cleanArtists]
ignore = ["Simon & Garfunkel", "Hall & Oates", "Earth, Wind & Fire"]
```

## CLI Output

When `cleanArtists` is active, `podkit sync --dry-run` shows what will change:

```
Clean Artists:
  enabled (format: "feat. {}")

Summary:
  Tracks to add: 5
  Tracks to update: 147
    Clean artists: 145
    Metadata changed: 2
  Tracks to remove: 0
  Already synced: 1,262

Tracks to update (clean artists):
  Artist A feat. Artist B - Song Name
    -> Artist: "Artist A"
    -> Title: "Song Name (feat. Artist B)"
```

## See Also

- [Artist Transforms](/user-guide/devices/artist-transforms) — Quick setup guide
- [Configuration](/user-guide/configuration) — Config file overview
- [CLI Commands](/reference/cli-commands) — Command-line reference

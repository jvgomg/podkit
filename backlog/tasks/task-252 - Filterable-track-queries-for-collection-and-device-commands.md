---
id: TASK-252
title: Filterable track queries for collection and device commands
status: To Do
assignee: []
created_date: '2026-03-28 21:00'
labels:
  - cli
  - enhancement
  - dx
dependencies: []
references:
  - packages/podkit-cli/src/commands/collection.ts
  - packages/podkit-cli/src/commands/device.ts
  - agents/shell-completions.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

There's no way to filter tracks from `podkit collection music --tracks` or `podkit device music --tracks` by field values. To find tracks missing soundcheck data, for example, you must dump all tracks as JSON and pipe through jq:

```bash
bun run podkit collection music --tracks --fields title,artist,album,soundcheck --format json \
  | jq '[.[] | select(.soundcheck == null)]'
```

This is clunky, requires jq knowledge, and doesn't work well with table/csv output formats.

## Proposed design

Add a `--where` flag that accepts simple field conditions, usable with all output formats and composable with `--fields`:

```bash
# Tracks missing soundcheck
podkit collection music --tracks --where "soundcheck=none"

# Tracks with soundcheck
podkit device music --tracks --where "soundcheck!=none"

# Combine with fields and format
podkit collection music --tracks --where "soundcheck=none" --fields title,artist,album --format table

# Filter by artist
podkit device music --tracks --where "artist=Hot Mulligan"

# Multiple conditions (AND)
podkit collection music --tracks --where "artist=Hot Mulligan" --where "soundcheck=none"
```

### Filter syntax

Keep it simple — no expression parser, just `field=value` and `field!=value` with a few special values:

| Filter | Meaning |
|--------|---------|
| `field=value` | Exact match (case-insensitive for strings) |
| `field!=value` | Not equal |
| `field=none` | Field is null/undefined/0 (falsy) |
| `field!=none` | Field is present and truthy |

This covers the most common diagnostic queries (missing soundcheck, missing artwork, specific artist/album/genre, specific format) without building a full query language.

### Scope

The `--where` flag should work on both commands since they share the same `--tracks` / `--fields` / `--format` structure:
- `podkit collection music --tracks --where ...`
- `podkit device music --tracks --where ...`

### Implementation notes

- Both commands already materialize the full track list in memory before formatting — filtering is just an array `.filter()` before the display step
- The `--fields` list already defines the valid field names; reuse that for `--where` field validation
- Consider adding a `--count` flag that just prints the number of matching tracks (useful for scripting)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 --where flag filters tracks on both `collection music` and `device music` commands
- [ ] #2 --where works with all output formats (table, json, csv)
- [ ] #3 --where supports =, !=, =none, !=none operators
- [ ] #4 Multiple --where flags combine with AND logic
- [ ] #5 Invalid field names in --where produce a clear error listing valid fields
- [ ] #6 Shell completions updated for --where flag
<!-- AC:END -->

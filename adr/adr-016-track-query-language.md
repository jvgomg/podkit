---
title: "ADR-016: Track Query Language for Scoped Sync"
description: Beets-derived query language for scoping sync operations across music, video, and podcast collections. Documents the lifted idiom and the omitted footguns.
sidebar:
  order: 17
---

# ADR-016: Track Query Language for Scoped Sync

## Status

**Proposed** (2026-05-07)

Implementation slice of [ADR-014](adr-014-self-healing-audio-detection.md). **Independent of [ADR-015](adr-015-audio-stream-checksum-sync-tag.md)** — the audio-checksum work can ship first. This slice is added on top.

## Context

The audio-checking work in [ADR-015](adr-015-audio-stream-checksum-sync-tag.md) is opt-in. Users who want to verify only a subset of their library — say, "the Radiohead albums I'm worried about" — need a way to scope the operation. More broadly, scoped sync is useful beyond audio checking:

- **Selective re-sync** for users who want to fix a known-bad subset
- **Dry-run previews** scoped to one artist or album
- **Future config-file selectors** for per-device exclusions or inclusions
- **Cross-content-type** querying — the same syntax for music, podcasts, and video

The [beets](https://beets.io/) CLI offers a mature query language for this exact use case. Lift its design where it fits, document the omissions, and own the resulting language as podkit's own — not a beets clone but inspired by it.

## Decision Drivers

- Familiar syntax for users coming from beets
- Cross-content-type (music, podcasts, video) selection through a single grammar
- Pure predicate function output — no coupling to sync internals — so the parser is reusable
- **Honest about what we omit and why.** Beets has accumulated some footguns we should not carry over.
- New package boundary so the query layer can be developed, tested, and depended on independently

## Options Considered

### A. Discrete CLI flags (`--artist X --album Y`)

Reject. Combinatorial explosion as fields multiply; can't express negation, ranges, regex, or OR.

### B. JSON or TOML filter object on the CLI

Reject. Verbose, hostile to typing on a CLI, fights the shell's own quoting rules.

### C. SQL-like filter syntax

Reject. Over-engineered for the use case. No user demand for joins or aggregations; users want "match these tracks."

### D. Beets-derived query language (chosen)

Lift the established idiom. Reject footguns explicitly. Document everything we don't carry over.

## Decisions

### 1. New package: `@podkit/query`

Add `packages/query/` to the monorepo. Pure parser + predicate compiler. Zero dependencies on sync, adapter, device, or libgpod code. The package exports:

- `parse(query: string): Query` — parse a query string into an AST
- `compile(query: Query): (record: Queryable) => boolean` — compile to a predicate
- `match(query: string, records: Queryable[]): Queryable[]` — convenience helper

Where `Queryable` is a structural type accepting any record-shaped object (`CollectionTrack`, `CollectionVideo`, `CollectionEpisode`).

### 2. Grammar — lifted from beets

| Idiom | Form | Notes |
|---|---|---|
| Substring (default) | `field:value` | Case-insensitive |
| Exact, case-sensitive | `field:=value` | |
| Exact, case-insensitive | `field:=~value` | |
| Regex | `field::pattern` | JavaScript `RegExp` (not Python `re`) |
| Numeric / date range | `field:N..M`, `field:N..`, `field:..M` | Inclusive at both ends |
| Relative date | `added:-1w..`, `added:..-3d` | Units: `d` (day), `w` (week), `m` (30 days), `y` (365 days) |
| Negation | `-term` | Prefix on a term |
| Implicit AND | `artist:radiohead album:'OK Computer'` | Whitespace between terms |
| Explicit OR | `artist:radiohead OR artist:portishead` | Case-insensitive keyword |
| Quoted values | `album:'OK Computer'` or `album:"OK Computer"` | Either quote style |
| Bare keyword | `radiohead` | Matches across default fields |
| Path query | `path:/Music/FLAC/...` | Explicit prefix only |
| Grouping | `(artist:dylan OR artist:cohen) year:1970..1979` | Parentheses |

### 3. Beets idioms NOT carried over

This is part of the package's own README and shipped doc, per the user's requirement to "document what we have omitted."

| Beets idiom | Why omitted |
|---|---|
| Comma-as-OR (`foo, bar`) | The trailing-space requirement (`foo,bar` is one token, `foo , bar` is OR) is a footgun. We use the explicit `OR` keyword. |
| `^` for negation | Redundant with `-`. Beets supports both because `-` collides with argv flags; podkit accepts the query as a single positional string, so `-` is unambiguous and `^` is not needed. |
| `-a` flag for album-level queries | We infer the operative level from the field name (`artist:` vs `album:` vs `title:`). No separate flag. |
| `field=value` mutation, `field!` deletion | Podkit doesn't mutate; the query is read-only selection. |
| `path:` auto-detection (any term containing `/`) | Bare `/foo/bar` could be a slash-containing title. Require explicit `path:` prefix. |
| Sort suffixes (`year+`, `genre-`) | Output ordering is the sync engine's call, not the query's. |
| `-p` template printing, `-f` format strings | Output concerns, not selection. |

The package README and the `agents/query-language.md` reference doc both reproduce this list, with attribution to beets.

### 4. Default fields for bare keywords

A bare keyword like `radiohead` matches across these fields by default:

`title`, `artist`, `album`, `albumArtist`, `genre`

(No `comment` — podkit doesn't expose a comment field on `CollectionTrack`. Beets does.)

### 5. Output: predicate function

The compiler produces:

```ts
type Predicate = (record: Queryable) => boolean;

interface Queryable {
  [field: string]: string | number | boolean | undefined;
}
```

The sync engine maps source items through the predicate to filter the candidate set before diffing.

### 6. Cross-content-type fields

The parser does not enforce a schema — the predicate just looks up `record[field]`. Adapters and consumers define their own queryable fields. Suggested conventions:

| Content type | Common fields |
|---|---|
| Music | `artist`, `album`, `title`, `albumArtist`, `genre`, `year`, `track`, `disc`, `duration`, `bitrate`, `lossless`, `path` |
| Podcasts | `show`, `episode`, `title`, `published` |
| Video | `series`, `season`, `episode`, `title`, `year` |

Querying a field that doesn't exist on a record simply returns `false` for that record — not an error.

### 7. Sync semantics

The query scopes the **source side**: which source tracks the sync operation considers. Tracks on the device but outside the query are **left untouched** — neither updated nor removed.

This matches user intent for `podkit sync --check-audio "artist:radiohead"`: "verify Radiohead, leave everything else alone." It deliberately differs from `find … | xargs rm`-style "delete what doesn't match" semantics, which would be destructive in this context.

The query is decoupled from `--check-audio`, `--force-sync-tags`, or any other flag. It scopes whatever sync operation is active. Examples:

```bash
# Scope normal sync
podkit sync "artist:radiohead"

# Scope a verification scan
podkit sync --check-audio "album:'OK Computer'"

# Scope baseline population
podkit sync --force-sync-tags --check-audio "year:1990..1999"

# Scope a dry-run preview
podkit sync --dry-run "genre:jazz"
```

### 8. Package layout

```
packages/query/
├── package.json
├── README.md           # User-facing reference + beets attribution + omissions list
├── src/
│   ├── index.ts        # Public API: parse, compile, match
│   ├── lexer.ts        # Tokeniser
│   ├── parser.ts       # AST builder (recursive descent)
│   ├── compiler.ts     # AST → predicate
│   └── types.ts        # Query, Queryable, Predicate
└── src/__tests__/      # Bun tests (unit + integration)
```

No native dependencies; no FFmpeg, libgpod, or filesystem. Pure logic.

## Consequences

### Positive

- Lifted UX is familiar to users who already know beets
- Reusable predicate (sync scope, dry-run filter, future config selectors)
- Documented omissions set honest expectations and prevent surprise bug reports
- New package boundary enables independent testing and versioning
- Cross-content-type from day one — same syntax for music, podcasts, video

### Negative

- New package adds monorepo surface area
- Users with deep beets muscle memory may expect parity that the omissions deliberately don't deliver — mitigated by the omissions table
- Recursive-descent parser is hand-written; we own the grammar going forward (no parser-generator dependency)

## Related Decisions

- [ADR-014](adr-014-self-healing-audio-detection.md): master design — query language is a deferred slice
- [ADR-015](adr-015-audio-stream-checksum-sync-tag.md): companion slice — `--check-audio` is one of several operations that can be scoped by a query
- [ADR-004](adr-004-collection-sources.md): adapter pattern — adapters supply records that the query predicate runs against

## References

- Beets query language reference — https://beets.readthedocs.io/en/stable/reference/query.html
- Beets query.rst source — https://github.com/beetbox/beets/blob/master/docs/reference/query.rst
- Beets CLI reference — https://beets.readthedocs.io/en/stable/reference/cli.html

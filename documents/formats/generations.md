# Generation × support matrix

## Map

This is the **spine** of the format corpus: one row per iPod generation, saying
how much of that generation podkit can safely touch (`access`) and how confident
we are about the claim (`verified`). Every other doc in this tree describes *the
bytes of a file*; this doc says *which generations podkit can read or write at
all*, and is the anchor the sibling format docs link back to.

The matrix is **generated from code**, not hand-maintained. Its source of truth
is the `getSupportMatrix()` export of the `@podkit/devices-ipod` generation
table; the table below is rendered verbatim by `renderSupportMatrixMarkdown()`
and pinned by a drift test, so this reference, the public compatibility table,
and the CLI `device info` output cannot diverge. See
[ADR-024](../../adr/adr-024-device-access-tiers.md).

## The two axes

Support is modelled on two **orthogonal** axes, and it matters that they stay
separate (ADR-024 §1):

- **`access`** gates behavior. It is a tri-state **total order** —
  `none ⊂ read-only ⊂ syncable` — because there is no writable-but-unreadable
  device (libgpod reads before it writes), so a single enum faithfully models the
  domain where two booleans would admit an illegal `readable:false,
  writable:true` state.
  - `syncable` — podkit reads and writes the device's `iTunesDB`.
  - `read-only` — podkit reads (metadata, artwork) but refuses to write; the
    write path needs something libgpod cannot produce (e.g. the iTunes
    authentication hash for a shuffle's `iTunesSD`) or is untested.
  - `none` — nothing to touch: no mountable database, or a protocol podkit
    cannot speak (iOS, not-in-libgpod).
- **`verified`** gates **nothing**. It is provenance only:
  - `hardware` — confirmed on a real device.
  - `inferred` — derived from libgpod tables / reverse-engineering, not yet
    hardware-probed.

  It exists so a contributor who plugs in a real device can flip
  `inferred → hardware` (and correct `access` if reality disagrees) in **one
  place** — the generation table — and every surface updates at once. `note`
  carries the human-readable rationale for a non-`syncable` tier.

## The matrix

Generated from `getSupportMatrix()` — do not edit by hand. Row order is the
generation table's own order. Run `bun run build --filter @podkit/devices-ipod`
after changing the table, then regenerate this block from
`renderSupportMatrixMarkdown()`; the drift test in
`packages/devices-ipod/src/generations-doc.test.ts` fails if the two diverge.

<!-- BEGIN GENERATED: support-matrix -->
| Generation | ID | Access | Verified | Note |
| --- | --- | --- | --- | --- |
| iPod (1st Generation) | `classic_1g` | syncable | inferred | — |
| iPod (2nd Generation) | `classic_2g` | syncable | inferred | — |
| iPod (3rd Generation) | `classic_3g` | syncable | inferred | — |
| iPod (4th Generation) | `classic_4g` | syncable | inferred | — |
| iPod Photo | `photo` | syncable | inferred | — |
| iPod Video (5th Generation) | `video_5g` | syncable | inferred | — |
| iPod Video (5.5th Generation) | `video_5_5g` | syncable | inferred | — |
| iPod Classic (6th Generation) | `classic_6g` | syncable | inferred | — |
| iPod Classic (7th Generation) | `classic_7g` | syncable | inferred | — |
| iPod mini (1st Generation) | `mini_1g` | syncable | inferred | — |
| iPod mini (2nd Generation) | `mini_2g` | syncable | inferred | — |
| iPod nano (1st Generation) | `nano_1g` | syncable | inferred | — |
| iPod nano (2nd Generation) | `nano_2g` | syncable | inferred | — |
| iPod nano (3rd Generation) | `nano_3g` | syncable | inferred | — |
| iPod nano (4th Generation) | `nano_4g` | syncable | inferred | — |
| iPod nano (5th Generation) | `nano_5g` | syncable | inferred | — |
| iPod nano (6th Generation) | `nano_6g` | read-only | inferred | Write unsupported (iTunesDB format); read untested on hardware. |
| iPod nano (7th Generation) | `nano_7g` | none | inferred | — |
| iPod shuffle (1st Generation) | `shuffle_1g` | syncable | inferred | — |
| iPod shuffle (2nd Generation) | `shuffle_2g` | syncable | inferred | — |
| iPod shuffle (3rd Generation) | `shuffle_3g` | read-only | inferred | Reads iTunesDB; iTunesSD playback DB needs iTunes authentication libgpod cannot produce. |
| iPod shuffle (4th Generation) | `shuffle_4g` | read-only | hardware | Reads iTunesDB; iTunesSD playback DB needs iTunes authentication libgpod cannot produce. |
| iPod touch (1st Generation) | `touch_1g` | none | inferred | — |
| iPod touch (2nd Generation) | `touch_2g` | none | inferred | — |
| iPod touch (3rd Generation) | `touch_3g` | none | inferred | — |
| iPod touch (4th Generation) | `touch_4g` | none | inferred | — |
| iPod touch (5th Generation) | `touch_5g` | none | inferred | — |
| iPod touch (6th Generation) | `touch_6g` | none | inferred | — |
| iPod touch (7th Generation) | `touch_7g` | none | inferred | — |
<!-- END GENERATED: support-matrix -->

## Field reference

- **Generation** — the human-readable display label, composed from the table's
  structured `family` + `ordinal` fields (ADR-020) via `formatIpodLabel`. The
  table stores no display strings.
- **ID** — the stable `IpodGenerationId` key used throughout the codebase and in
  the other format docs' cross-references.
- **Access** — the behavior gate (`syncable` / `read-only` / `none`), enforced
  once at device resolution (ADR-024 §4). Read-ops (`music`, `video`, `info`,
  `scan`, `archive`) run on `read-only`; write-ops (`sync`, `device init/add`)
  refuse.
- **Verified** — provenance (`hardware` / `inferred`). Documentation confidence
  only; it branches no logic.
- **Note** — rationale for a non-`syncable` tier, surfaced in docs and CLI. An em
  dash (`—`) means the row carries no note (the `syncable`/`inferred` common
  case).

## Notable non-`syncable` rows

- **shuffle 3g / 4g — `read-only`.** A shuffle keeps a libgpod-readable
  `iTunesDB` (metadata) alongside the `iTunesSD` (`bdhs`) playback database the
  firmware plays from. podkit reads and archives the `iTunesDB`; writing a valid
  `iTunesSD` needs an iTunes authentication hash libgpod cannot produce. The 4g
  is `hardware`-confirmed; the 3g is `inferred` (same family, not itself probed).
  See [itunessd-bdhs.md](itunessd-bdhs.md).
- **nano 6g — `read-only`.** Its write is a format libgpod cannot produce, but
  its read is merely *untested* — and a read is non-destructive, so the tier
  permits the attempt rather than forbidding a safe operation on a guess.
- **nano 7g, iPod touch (all), not-in-libgpod — `none`.** No mountable database,
  or Apple's proprietary sync protocol that podkit cannot speak over disk mode.

## Staying in sync

The generation matrix above is not maintained by hand. It stays honest because:

1. The table is the single source: `getSupportMatrix()` projects it, and
   `renderSupportMatrixMarkdown()` renders that projection deterministically.
2. `packages/devices-ipod/src/generations-doc.test.ts` reads this file, extracts
   the region between the `BEGIN GENERATED` / `END GENERATED` markers, and
   asserts it equals `renderSupportMatrixMarkdown()`. Editing the table without
   regenerating the block (or editing the block by hand) fails the test.

To upgrade a claim after touching real hardware, edit the generation's `support`
record in `packages/devices-ipod/src/tables/generations.ts` (flip
`inferred → hardware`, adjust `access`/`note`), rebuild, and paste the fresh
`renderSupportMatrixMarkdown()` output between the markers.

## References

- [ADR-024](../../adr/adr-024-device-access-tiers.md) — the tri-state access tier
  + orthogonal verification provenance; §7 (one matrix, three surfaces).
- [itunessd-bdhs.md](itunessd-bdhs.md) — the `iTunesSD` (`bdhs`) format that makes
  the shuffle 3g/4g `read-only` rather than `syncable`.
- [README.md](README.md) — the format corpus map and provenance convention.
- `packages/devices-ipod/src/support.ts` — `getSupportMatrix()` and
  `renderSupportMatrixMarkdown()`.
- `packages/devices-ipod/src/tables/generations.ts` — the generation table (the
  source of truth).
- doc-056 — PRD: Device Access Tiers.

# iPod on-disk database formats

This tree documents **how Apple's iPod database files are laid out on disk** —
the reverse-engineered binary formats podkit reads (and, where it does, writes).
It is the *format* layer of podkit's knowledge, distinct from its siblings:

- `documents/architecture/` — how podkit's **own code** is wired.
- `documents/principles/` — the **behavioural promises** podkit makes.
- `devices/` — per-**device capability** profiles (what a device can do).
- `adr/` — **decisions** frozen at decision time.

Format docs own exactly one thing: **the bytes**. What each database file is,
how its records are laid out, which offsets mean what, and — critically — **how
confident we are about each claim**. Everything else links here; this tree links
back to the parser code that implements a format and to the generation matrix
that says which device uses it.

## What's here

| Doc | Format | Parsed by podkit? |
|-----|--------|-------------------|
| [itunessd-bdhs.md](itunessd-bdhs.md) | `iTunesSD` (`bdhs`, shuffle 3g/4g playback DB) | **No** — documented, not parsed |
| `itunesdb.md` | `iTunesDB` (mhbd/mhsd/mhit chunk tree) | Yes — `@podkit/ipod-db` *(doc: backfill pending)* |
| `artworkdb.md` | `ArtworkDB` + `.ithmb` image blobs | Yes — `@podkit/ipod-db` *(doc: backfill pending)* |
| `checksums.md` | hashAB / hash58 / hash72 by generation | Yes *(doc: backfill pending)* |
| `generations.md` | generation × {DB files, checksum, access, verified} matrix | — *(the spine)* |

`generations.md` is the **spine**: it is generated-from / test-pinned-to the
`getSupportMatrix()` export of the `@podkit/devices-ipod` generation table, so
this corpus, the public compatibility table, and the CLI `device info` output
cannot drift. See [ADR-024](../../adr/adr-024-device-access-tiers.md).

## The provenance convention (this is the point)

Every non-trivial claim in a format doc carries a **confidence marker**, mirroring
the `verified: 'hardware' | 'inferred'` axis of the generation support model:

- ✅ **confirmed** — derived from a real device dump and cross-checked (cite the fixture).
- 🔶 **inferred** — from external reverse-engineering (iPod-linux wiki, libgpod source)
  or an internally-consistent guess not yet nailed to a byte.

The corpus is meant to **grow one format (and one confirmed field) at a time**.
Downgrading a 🔶 to a ✅ when a fixture confirms it is the expected unit of progress.

**Fixtures are anonymized or synthetic — never a real user's library dump.** A
donated/scrubbed `iTunesSD` may pin offsets; a personal device's file (real track
paths, real ordering) must not be committed.

## Per-doc shape (the template)

1. **Map** — what this file is, which generations write it, what plays/reads it. Two paragraphs max.
2. **Provenance & fixtures** — which real dump this doc was built from; the confidence legend.
3. **Layout** — the byte tables: sections, offsets, field widths, endianness.
4. **Field reference** — per-field meaning and confidence marker; the *why*, not just the *what*.
5. **Cross-checks** — invariants that let a reader validate a dump (e.g. counts that must agree).
6. **Open questions** — the 🔶 fields still to confirm; what would confirm them.
7. **References** — parser modules, related format docs, external sources, the generation matrix.

When in doubt, copy [itunessd-bdhs.md](itunessd-bdhs.md)'s skeleton.

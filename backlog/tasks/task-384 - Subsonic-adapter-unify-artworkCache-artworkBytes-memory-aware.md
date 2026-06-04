---
id: TASK-384
title: 'Subsonic adapter: unify artworkCache + artworkBytes (memory-aware)'
status: To Do
assignee: []
created_date: '2026-06-04 08:05'
labels:
  - enhancement
  - refactor
  - subsonic
  - memory
  - cache
dependencies:
  - TASK-142
references:
  - packages/podkit-core/src/adapters/subsonic.ts
priority: low
ordinal: 110000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`SubsonicAdapter` has two parallel caches with overlapping semantics:

- `artworkCache: Map<coverArtId, string | null>` — hash or null. **Unbounded** (hash entries are ~30 bytes each).
- `artworkBytes: Map<coverArtId, Buffer>` — bytes. **Bounded** at 100 entries via FIFO eviction (~20 MB cap at typical 200 KB covers).

Two maps, related keys, different lifetimes. Grew organically. The unification opportunity is real but constrained by memory.

## Memory analysis (must preserve)

The two maps deliberately have different bounds because:

1. **Hash entries are cheap.** Holding 10,000 album hashes = 300 KB. Useful for presence/absence memory across long sessions (daemon mode, continuous sync cycles).
2. **Byte entries are expensive.** 10,000 covers × 200 KB = 2 GB. Untenable.
3. **The bound is on BYTES, not on presence info.** When `artworkBytes` evicts entry X, `artworkCache[X]` SURVIVES so the next `fetchArtworkInfo` doesn't re-classify a known-placeholder as real. Re-fetching the bytes is fine; re-classifying is wasted work.

A naive unification (`Map<coverArtId, { hash, bytes }>`) would lose this distinction. Either:
- Apply the bound to the unified map → memory explodes once daemon mode runs a week (lose presence memory).
- Keep two parallel maps → no actual unification.

## Recommended shape

Discriminated union preserving both bounds:

```ts
type SubsonicArtworkEntry =
  | { state: 'real-bytes-cached'; hash: string; bytes: Buffer }   // bounded set
  | { state: 'real-bytes-evicted'; hash: string }                 // unbounded set
  | { state: 'placeholder' }                                      // unbounded set
  | { state: 'missing' };                                         // unbounded set

private artwork = new Map<string, SubsonicArtworkEntry>();
private bytesLRU: Set<string> = new Set();  // tracks which keys are in 'real-bytes-cached' state, FIFO-ordered
```

`cacheArtworkBytes(coverArtId, buffer)`:
- If size at cap, demote oldest `'real-bytes-cached'` → `'real-bytes-evicted'` (preserves hash, drops bytes).
- Insert/upgrade entry for coverArtId → `'real-bytes-cached'`.

`getArtwork(track)`:
- entry.state === 'real-bytes-cached' → return bytes
- entry.state === 'real-bytes-evicted' → re-fetch, upgrade
- entry.state === 'placeholder' or 'missing' → return null without re-fetching

`fetchArtworkInfo(coverArtId)`:
- Same dispatch; updates the unified state.

## Acceptance criteria

- One `Map<coverArtId, SubsonicArtworkEntry>` replaces both today's maps.
- Memory bound preserved: bytes set capped at 100 (or whatever ARTWORK_BYTES_CACHE_MAX is today); hash-only entries unbounded.
- "Bytes evicted, hash survives" behaviour tested explicitly — the existing FIFO eviction test (commit 50a6247f) should be expanded to assert hash-state is retained post-eviction.
- No memory regression in typical daemon-mode usage (10k albums, hash-only entries should be < 1 MB).
- No behaviour regression in `--check-artwork` placeholder filtering.

## Notes

- This is a refactor with subtle correctness implications. Worth a code-reviewer pass before merge — specifically on the eviction policy when an entry already exists in `'real-bytes-cached'` state and we're re-inserting (today's `cacheArtworkBytes` overwrite branch handling).
- Alternative: keep two maps, document the invariant explicitly with a comment + add a test asserting the invariant. Smaller change, same correctness. Worth considering as a fall-back if the discriminated union proves too complex.

## Reference

- Item 3 from post-team-lead retro (2026-06-04).
- `packages/podkit-core/src/adapters/subsonic.ts` (current dual-map implementation, lines around the cache definitions).
<!-- SECTION:DESCRIPTION:END -->

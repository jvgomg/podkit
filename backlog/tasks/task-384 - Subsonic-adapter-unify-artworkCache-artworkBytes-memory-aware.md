---
id: TASK-384
title: 'Subsonic adapter: split artwork cache into single-responsibility classes'
status: To Do
assignee: []
created_date: '2026-06-04 08:05'
updated_date: '2026-06-05 18:03'
labels:
  - enhancement
  - refactor
  - subsonic
  - memory
  - cache
  - single-responsibility
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

Two maps, related keys, different lifetimes. Grew organically.

## Structural insight (2026-06-05)

Today's shape fumbles toward a real abstraction without naming it. There are **two genuinely different concerns** that happen to share a key:

1. **Classification memo** — "I've seen coverArtId X and decided real/placeholder/missing." Cheap. Unbounded. Persists across long daemon sessions.
2. **Bytes cache** — "I have the JPEG bytes for X ready to transfer." Expensive. Bounded.

They're linked **only at write time** (one fetch produces both), and **independent** at read time and in lifecycle (bytes evict; classification doesn't).

Rejected alternatives:
- **Discriminated union** (original task spec): re-couples the two concerns into one type with 4 states (`real-bytes-cached`, `real-bytes-evicted`, `placeholder`, `missing`). Every reader dispatches on states it doesn't care about.
- **Keep two raw maps + comment**: invariant lives in prose; eviction policy inline at callsite.

## Decision

**Single-responsibility classes + thin coordinator.** Each cache has one job, named. Invariant "bytes evict, classification survives" is **structural** — they're separate objects, can't accidentally couple.

## Shape

```ts
class ArtworkClassificationMemo {
  private memo = new Map<string, 'real' | 'placeholder' | 'missing'>();
  // unbounded; one job: remember classifications
  get(id: string): Classification | undefined { ... }
  set(id: string, c: Classification): void { ... }
}

class ArtworkBytesCache {
  private cache = new Map<string, Buffer>();
  private readonly MAX = 100;
  // bounded FIFO; one job: hold recent bytes
  get(id: string): Buffer | undefined { ... }
  put(id: string, bytes: Buffer): void { /* evict oldest if full */ }
}

// In SubsonicAdapter:
private classify = new ArtworkClassificationMemo();
private bytes = new ArtworkBytesCache();

async getArtwork(track): Promise<Buffer | null> {
  const c = this.classify.get(coverArtId);
  if (c === 'placeholder' || c === 'missing') return null;
  const cached = this.bytes.get(coverArtId);
  if (cached) return cached;
  const fetched = await this.fetchAndClassify(coverArtId);  // updates both
  return fetched;
}
```

## Scope

1. **New module** `packages/podkit-core/src/adapters/subsonic/cache.ts` (or co-located in `subsonic.ts` if footprint is small).
2. **`ArtworkClassificationMemo`** — unbounded `Map<string, 'real' | 'placeholder' | 'missing'>`. Pure data, no side effects.
3. **`ArtworkBytesCache`** — FIFO-bounded `Map<string, Buffer>` at the existing cap (currently 100, named constant). Eviction policy owned by the class.
4. **`SubsonicAdapter` refactor:**
   - Replace `artworkCache` + `artworkBytes` fields with `classify` + `bytes` instances.
   - `fetchArtworkInfo` writes to `classify`.
   - `cacheArtworkBytes` becomes `bytes.put`.
   - `getArtwork` becomes the coordinator above.
5. **Tests:**
   - Test each class in isolation (`ArtworkBytesCache` eviction, `ArtworkClassificationMemo` get/set).
   - Expand existing FIFO eviction test (commit 50a6247f) to assert classification survives bytes eviction.
   - Pin: placeholder classification short-circuits without re-fetch.

## Acceptance criteria

- `ArtworkClassificationMemo` + `ArtworkBytesCache` exist as standalone classes; each testable in isolation.
- `SubsonicAdapter.artworkCache` + `.artworkBytes` removed; replaced with the new instances.
- Memory bounds preserved: bytes cap at existing constant; classification unbounded.
- "Bytes evicted, classification survives" pinned by test.
- No behaviour regression in `--check-artwork` placeholder filtering.
- No memory regression in typical daemon-mode usage (10k albums, classification-only entries < 1 MB).

## Notes

- The `lru-cache` npm dep was considered and rejected — asymmetric eviction rules + two-store linked writes mean we'd write the coordinator anyway. Two plain Maps + ~10 lines of FIFO is cheaper than the dep.
- The bytes cache is potentially reusable for other adapters (e.g. sidecar bytes from a future source). Worth naming generically (`BoundedBufferCache`?) if a second consumer appears — not now.

## Reference

- Item 3 from post-team-lead retro (2026-06-04).
- Original task spec had a discriminated union; superseded 2026-06-05 by single-responsibility composition.
- `packages/podkit-core/src/adapters/subsonic.ts` (current dual-map implementation).
<!-- SECTION:DESCRIPTION:END -->

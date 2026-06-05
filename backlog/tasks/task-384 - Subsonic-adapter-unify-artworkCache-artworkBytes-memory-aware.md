---
id: TASK-384
title: 'Subsonic adapter: split artwork cache into single-responsibility classes'
status: Done
assignee: []
created_date: '2026-06-04 08:05'
updated_date: '2026-06-05 18:55'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Module layout

- New: `packages/podkit-core/src/adapters/subsonic/cache.ts` — exports `ArtworkClassificationMemo`, `ArtworkBytesCache`, `ARTWORK_BYTES_CACHE_MAX`, and the `ArtworkClassification` type.
- New: `packages/podkit-core/src/adapters/subsonic/cache.test.ts` — 13 isolated unit tests.
- Modified: `packages/podkit-core/src/adapters/subsonic.ts` — drops `artworkCache`/`artworkBytes`/`cacheArtworkBytes`/inline `ARTWORK_BYTES_CACHE_MAX`; composes `private classify` + `private bytes`.

## Class APIs as landed (matches brief)

```ts
export type ArtworkClassification = 'real' | 'placeholder' | 'missing';

class ArtworkClassificationMemo {
  get(id: string): ArtworkClassification | undefined;
  set(id: string, classification: ArtworkClassification): void;
  clear(): void;
  size(): number;
}

class ArtworkBytesCache {
  get(id: string): Buffer | undefined;
  has(id: string): boolean;       // kept for symmetry; used internally
  put(id: string, bytes: Buffer): void;
  clear(): void;
  size(): number;
}
```

Cap: `ARTWORK_BYTES_CACHE_MAX = 100` (hoisted to `cache.ts`, same value as before).

## FIFO semantics preserved

`ArtworkBytesCache.put` mirrors pre-refactor `cacheArtworkBytes` exactly: re-put on an existing key updates the value but does NOT refresh its insertion-order slot. Pinned by `re-inserting an existing key does NOT refresh its eviction order` in `cache.test.ts`.

## Classification semantics translation

Old: `Map<coverArtId, string | null>` where `null` meant "no artwork (missing OR placeholder)" and a `string` was the hash. New: `Map<coverArtId, 'real' | 'placeholder' | 'missing'>` (no hash). All `=== null` readers translated to "classification ∈ {placeholder, missing}". The hash-on-cache-hit return in `fetchArtworkInfo` was rebuilt by re-hashing from the bytes cache when `classify === 'real'` AND bytes still cached; if bytes evicted, fall through to refetch (rare since same-album tracks process sequentially and bytes-cap >> typical per-album track count). SHA-256 of ~200 KB is microseconds, so the rehash cost is negligible.

## Tests

- `subsonic/cache.test.ts` (new, 13 tests): isolated coverage of both classes — get/set/clear/size, unbounded memo (10k entries), FIFO eviction at exact cap, re-insert non-refresh semantics, eviction past cap+N.
- `subsonic.test.ts` (modified): old "bytes cache is bounded — FIFO" test updated for new field names. NEW test: `classification survives bytes eviction — structural invariant of the cache split` — inserts 101 entries, asserts `bytes.has('cover-0') === false` AND `classify.get('cover-0') === 'real'` AND `classify.size() === 101`. NEW test: placeholder short-circuit (sister to existing missing short-circuit) pins both classifications skip the fetch.

Counts: 2896 → 2911 in `@podkit/core` unit suite (+15 new). 0 failures.

## Quality gates

- `bun run test:unit --filter @podkit/core` — 2911 pass, 5 skip, 0 fail.
- `bun run typecheck` — 34 tasks, all successful (clean).
- `grep -n "artworkCache|artworkBytes|cacheArtworkBytes" subsonic.ts` — zero matches.

## Surprises / decisions

- The brief said the memo holds only `'real' | 'placeholder' | 'missing'`, but `fetchArtworkInfo` historically returned the artwork hash on cache hit (for `track.artworkHash` change detection in `--check-artwork` mode). Resolution: on a memo 'real' hit, re-hash from the bytes cache (cheap, ~µs). If bytes evicted, fall through to refetch — functionally identical, preserves the no-third-cache constraint. Documented inline.
- Did NOT introduce a discriminated union for memo entries — kept the simple enum per task brief.
- Did NOT introduce a `BoundedBufferCache` generic — deferred per task brief until a second consumer appears.
- `ArtworkBytesCache.has` retained: used by the class's own `put` for the "existing key skip eviction" check; not strictly required externally but cheap to expose.

Post-Sonnet-review (2026-06-05): 0 blockers; 1 SUGGESTION rejected with rationale (add refetch test in the invariant test) — the refetch branch is already pinned by the existing FIFO eviction test at subsonic.test.ts:1076-1080, which together with the structural invariant test (classify survives) implicitly exercises the `'real'` + bytes-evicted → refetch branch. Splitting the narratives keeps each test single-purpose. 1 NIT noted but pre-existing (network errors on getArtwork aren't memoised; out of scope).
<!-- SECTION:NOTES:END -->

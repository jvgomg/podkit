/**
 * Artwork caches for the Subsonic adapter.
 *
 * Two single-responsibility caches, linked at WRITE time (one fetch produces
 * both) but independent at READ time and lifecycle:
 *
 * - {@link ArtworkClassificationMemo} — unbounded. Records the decision
 *   ('real' | 'placeholder' | 'missing') for each `coverArtId` the adapter
 *   has classified. Entries are tiny (~30 bytes) and persist across long
 *   daemon sessions so we never re-classify a known placeholder/missing
 *   cover.
 * - {@link ArtworkBytesCache} — FIFO-bounded at {@link ARTWORK_BYTES_CACHE_MAX}.
 *   Holds the actual JPEG bytes for recently-fetched real artwork. Bounded
 *   so a long-running daemon syncing a large library doesn't accumulate the
 *   full library's covers indefinitely.
 *
 * Invariant: bytes evict; classification survives. The two caches are
 * separate objects so the invariant is structural — readers cannot
 * accidentally couple eviction with classification.
 */

/**
 * Soft cap on the in-memory artwork-bytes cache. At ~200 KB per typical album
 * cover, 100 entries ≈ 20 MB held — bounded so a long-running daemon syncing a
 * large library doesn't accumulate the full library's covers indefinitely.
 * Eviction is FIFO by insertion order (sufficient — an album cover is fetched
 * once per sync and rarely revisited within a single session).
 *
 * In daemon mode, libraries with more than 100 distinct albums per cycle will
 * see evicted entries re-fetched on the next sync. Raise the cap if that cost
 * matters; the classification memo (unbounded) still short-circuits the
 * placeholder-filter pass.
 */
export const ARTWORK_BYTES_CACHE_MAX = 100;

/**
 * Classification for a `coverArtId` once the adapter has fetched (or
 * attempted to fetch) it from the server.
 *
 * - `real` — getCoverArt returned a non-placeholder image larger than the
 *   minimum-size threshold.
 * - `placeholder` — getCoverArt returned an image whose hash matches the
 *   server's placeholder (e.g. Navidrome's static WebP).
 * - `missing` — getCoverArt returned an error, a non-image content-type, or
 *   a body smaller than the minimum-size threshold. We treat all three as
 *   "no artwork" for the purposes of the upgrade engine.
 */
export type ArtworkClassification = 'real' | 'placeholder' | 'missing';

/**
 * Unbounded classification memo: "I've seen coverArtId X and decided
 * real/placeholder/missing." Entries are small (~30 bytes) and persist so a
 * daemon never re-classifies a known cover.
 */
export class ArtworkClassificationMemo {
  private memo = new Map<string, ArtworkClassification>();

  get(id: string): ArtworkClassification | undefined {
    return this.memo.get(id);
  }

  set(id: string, classification: ArtworkClassification): void {
    this.memo.set(id, classification);
  }

  clear(): void {
    this.memo.clear();
  }

  size(): number {
    return this.memo.size;
  }
}

/**
 * FIFO-bounded bytes cache. When at {@link ARTWORK_BYTES_CACHE_MAX}, inserting
 * a new `coverArtId` evicts the oldest (first-inserted) entry before insertion.
 *
 * Re-insertion semantics: `put` on an already-present key updates the value
 * but does NOT refresh insertion order — the entry keeps its original slot
 * in the eviction queue. This mirrors the pre-refactor behaviour where
 * eviction was skipped for present keys and `Map.set` on an existing key
 * preserves its position. The cache hit short-circuits earlier in the
 * adapter's `getArtwork`/`fetchArtworkInfo` paths, so this case only fires
 * from a concurrent double-fetch writing identical bytes — age-tracking
 * distinctions are invisible there.
 */
export class ArtworkBytesCache {
  private cache = new Map<string, Buffer>();

  get(id: string): Buffer | undefined {
    return this.cache.get(id);
  }

  has(id: string): boolean {
    return this.cache.has(id);
  }

  put(id: string, bytes: Buffer): void {
    // Only evict when inserting a genuinely new key at-or-past the cap.
    // Re-inserting an existing key keeps its original insertion-order slot,
    // matching the pre-refactor semantics.
    if (!this.cache.has(id) && this.cache.size >= ARTWORK_BYTES_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(id, bytes);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

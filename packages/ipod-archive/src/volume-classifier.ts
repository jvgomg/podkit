/**
 * VolumeClassifier — partition a mounted iPod volume's top-level entries into
 * three disjoint buckets:
 *
 * - **copy**: known iPod data directories that form the archival whitelist.
 * - **junk**: macOS / system noise that appears when an iPod is mounted on a
 *   desktop OS — never iPod data, always safe to skip.
 * - **foreign**: anything else — user-added files that live on the volume but
 *   are outside the iPod data set. These are not copied, but they ARE reported
 *   so the user can retrieve them manually.
 *
 * The core classification is a pure function over a list of entry names so it
 * is trivially unit-testable. A thin wrapper reads the real directory.
 */

/** Known top-level iPod data directories — the archival whitelist. */
export const IPOD_DATA_WHITELIST = ['iPod_Control', 'Calendars', 'Contacts', 'Notes'] as const;

/**
 * Exact-name junk entries Apple (and other desktop OSes) sprinkle onto a
 * mounted removable volume. Dotfile *prefixes* (`._*`) are handled separately
 * by {@link isJunkEntry}.
 */
const JUNK_EXACT_NAMES = new Set<string>([
  '.DS_Store',
  '.Spotlight-V100',
  '.fseventsd',
  '.Trashes',
  '.TemporaryItems',
  '.apdisk',
]);

/** Whitelist membership is case-insensitive — FAT32 volumes can vary case. */
const WHITELIST_LOWER = new Set<string>(IPOD_DATA_WHITELIST.map((n) => n.toLowerCase()));

/**
 * Result of classifying a volume's top-level entries. Each name lands in
 * exactly one bucket. Order within a bucket follows input order.
 */
export interface VolumeClassification {
  /** iPod data directories to copy (the whitelist). */
  copy: string[];
  /** macOS / system junk to skip silently. */
  junk: string[];
  /** User-added entries outside the whitelist — skipped but reported. */
  foreign: string[];
}

/**
 * True when `name` is desktop-OS filesystem noise rather than iPod data.
 *
 * Covers AppleDouble resource forks (`._*`), `.DS_Store`, Spotlight/FSEvents
 * indexes, trashes, and a few other well-known Apple artefacts.
 */
export function isJunkEntry(name: string): boolean {
  // AppleDouble sidecar files: `._Foo` for every `Foo` copied to a
  // non-HFS volume. The most voluminous source of junk on a FAT32 iPod.
  if (name.startsWith('._')) return true;
  return JUNK_EXACT_NAMES.has(name);
}

/**
 * True when `name` is a known iPod data directory (case-insensitive).
 */
export function isWhitelistEntry(name: string): boolean {
  return WHITELIST_LOWER.has(name.toLowerCase());
}

/**
 * Pure classification over a list of top-level entry names.
 *
 * Precedence: whitelist → junk → foreign. A name on the whitelist is always
 * copied even if it happened to start with a dot; junk is only consulted for
 * non-whitelisted names.
 */
export function classifyEntries(names: readonly string[]): VolumeClassification {
  const copy: string[] = [];
  const junk: string[] = [];
  const foreign: string[] = [];

  for (const name of names) {
    if (isWhitelistEntry(name)) {
      copy.push(name);
    } else if (isJunkEntry(name)) {
      junk.push(name);
    } else {
      foreign.push(name);
    }
  }

  return { copy, junk, foreign };
}

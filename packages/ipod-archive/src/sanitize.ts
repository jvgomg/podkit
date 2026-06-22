/**
 * Path-segment sanitisation shared by the archive's output naming (stage 1)
 * and the music-tree path planner (stage 2).
 *
 * The rules target the *worst-case* portable filesystem (Windows / FAT /
 * exFAT) so an archive produced on macOS or Linux copies cleanly onto any of
 * them: reserved characters, control characters, trailing dots/spaces, and the
 * Windows reserved device names (`CON`, `PRN`, …) are all neutralised. Segments
 * are also capped at a byte length safe for every common filesystem and
 * normalised to Unicode NFC so visually-identical names collide deterministically.
 *
 * Every function here is pure and IO-free.
 */

/**
 * Windows reserved device names. A bare segment matching one of these (case-
 * insensitively, with or without an extension) is illegal as a file/dir name
 * on Windows, so we prefix it with `_` to make it safe everywhere.
 */
const RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/**
 * Maximum byte length of a single path segment. Most filesystems cap individual
 * names at 255 bytes (NTFS/ext4/APFS count UTF-16/bytes differently, but 255
 * bytes is the safe common denominator). When a name needs truncating we leave
 * headroom so a collision suffix (` [<dbid>]`) and an extension can still be
 * appended by the caller without busting the cap.
 */
const MAX_SEGMENT_BYTES = 200;

/**
 * Characters illegal in a path segment: the Windows-reserved set
 * (`< > : " / \ | ? *`), the path separators, and all C0/C1 control characters
 * (U+0000–U+001F, U+007F–U+009F). Spelled with `\u` escapes so no literal
 * control byte appears in the source.
 */
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001F\u007F-\u009F]/g;

const utf8 = new TextEncoder();

/** Byte length of a string encoded as UTF-8. */
function byteLength(value: string): number {
  return utf8.encode(value).length;
}

/**
 * Truncate a string so its UTF-8 encoding is at most `maxBytes`, without
 * splitting a multi-byte code point. Returns the original string when it
 * already fits.
 */
function truncateToBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  // `Array.from` iterates by code point (not UTF-16 unit), so surrogate pairs
  // stay intact as we trim from the end.
  const codePoints = Array.from(value);
  while (codePoints.length > 0 && byteLength(codePoints.join('')) > maxBytes) {
    codePoints.pop();
  }
  return codePoints.join('');
}

/**
 * How interior whitespace is handled by {@link sanitizeCore}.
 *
 * - `underscore`: collapse all whitespace (and underscore) runs to a single
 *   `_`. Used for the compact, separator-free directory token in the archive's
 *   output-directory name.
 * - `preserve`: keep interior spaces as spaces (collapsing runs to a single
 *   space). Used for the human-browsable `Music/` tree, where `01 Song.mp3`
 *   reads better than `01_Song.mp3` and spaces are legal on every target
 *   filesystem.
 */
type WhitespacePolicy = 'underscore' | 'preserve';

/**
 * Core segment sanitiser shared by both whitespace policies. Always: NFC
 * normalisation, illegal/control-character replacement, leading/trailing
 * dot/space/underscore stripping, reserved-device-name guarding, and a
 * byte-length cap. Returns `''` when nothing survives.
 */
function sanitizeCore(input: string, whitespace: WhitespacePolicy): string {
  const normalised = input.normalize('NFC');
  const replaced = normalised.replace(ILLEGAL_CHARS, '_');
  const collapsed =
    whitespace === 'underscore'
      ? replaced.replace(/[\s_]+/g, '_')
      : // Collapse whitespace runs to a single space; leave underscores intact.
        replaced.replace(/\s+/g, ' ');
  // Trim leading and trailing dots, spaces, and underscores. Leading underscores
  // are intentionally stripped by both whitespace policies: the 'underscore'
  // policy uses them as separators (a leading one would look like a hidden file),
  // and the 'preserve' policy targets human-browsable names where a leading
  // underscore is an artefact of illegal-character replacement, not meaningful.
  const trimmed = collapsed.replace(/^[._\s]+|[._\s]+$/g, '');
  if (!trimmed) return '';

  // Guard the reserved-device-name match against the basename (before any
  // extension), since `CON.txt` is just as reserved as `CON` on Windows.
  const base = trimmed.split('.')[0] ?? trimmed;
  const guarded = RESERVED_DEVICE_NAMES.has(base.toLowerCase()) ? `_${trimmed}` : trimmed;

  return truncateToBytes(guarded, MAX_SEGMENT_BYTES);
}

/**
 * Sanitise a *compact* path segment, collapsing whitespace to underscores.
 *
 * Used for the archive's output-directory name (`<deviceName>-<id>-<ts>`),
 * where a separator-free token is preferred. Returns `''` for an empty /
 * all-stripped input so callers can drop the segment entirely.
 */
export function sanitizeSegment(input: string): string {
  return sanitizeCore(input, 'underscore');
}

/**
 * Sanitise a *human-browsable* path segment, preserving interior spaces.
 *
 * Used for the `Music/<AlbumArtist>/<Album>/<NN> <Title>.<ext>` tree. Applies
 * the same illegal-character, reserved-name, trailing-dot/space, and
 * byte-length rules as {@link sanitizeSegment}, but keeps spaces (which are
 * legal on every target filesystem) instead of underscoring them. Returns `''`
 * when nothing survives.
 */
export function sanitizePathSegment(input: string): string {
  return sanitizeCore(input, 'preserve');
}

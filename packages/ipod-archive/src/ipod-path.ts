/**
 * Conversion between an iPod's colon-separated on-device path and a real
 * filesystem path inside a dump.
 *
 * libgpod stores each track's location as `ipodPath`, a path relative to the
 * iPod root with `:` separators and a leading `:`, e.g.
 * `:iPod_Control:Music:F00:ABCD.m4a`. Inside a dump that maps to
 * `<ipodRoot>/iPod_Control/Music/F00/ABCD.m4a`. This module centralises that
 * mapping (and the basename / extension derivations the planner needs) so the
 * `:` → `/` convention lives in exactly one place.
 *
 * Pure and IO-free.
 */

import { extname, join, resolve, sep } from 'node:path';

/**
 * Convert an `ipodPath` (`:iPod_Control:Music:F00:ABCD.m4a`) into POSIX-style
 * relative segments (`iPod_Control/Music/F00/ABCD.m4a`). Leading/trailing
 * colons are dropped and empty segments are removed.
 *
 * Path-traversal segments (`.`, `..`, or any segment containing a path
 * separator) are silently dropped — a crafted dump must not be able to escape
 * the dump root via the colon-separated path.
 *
 * Returns `null` for a null/empty/colon-only path (or a path whose every
 * segment is traversal-only) so callers can route the track to the "no audio"
 * bucket rather than constructing a bogus path.
 */
export function ipodPathToRelativeSegments(ipodPath: string | null | undefined): string[] | null {
  if (!ipodPath) return null;
  const segments = ipodPath.split(':').filter((segment) => {
    if (segment.length === 0) return false;
    // Drop traversal segments: `.`, `..`, or any segment containing a path
    // separator (/ or \). These cannot appear in a legitimate iPod path and
    // would let a crafted dump escape the dump root.
    if (segment === '.' || segment === '..') return false;
    if (segment.includes('/') || segment.includes('\\')) return false;
    return true;
  });
  return segments.length > 0 ? segments : null;
}

/**
 * Resolve a track's `ipodPath` to an absolute filesystem path under `ipodRoot`
 * (the directory inside the dump that contains `iPod_Control`).
 *
 * Returns `null` when `ipodPath` is null/empty, or when the resolved path
 * escapes `ipodRoot` (path-traversal guard). An escaping path indicates a
 * crafted dump and is treated identically to a missing audio body.
 */
export function resolveDumpAudioPath(
  ipodRoot: string,
  ipodPath: string | null | undefined
): string | null {
  const segments = ipodPathToRelativeSegments(ipodPath);
  if (!segments) return null;
  const resolved = resolve(join(ipodRoot, ...segments));
  const normalRoot = resolve(ipodRoot);
  // The resolved path must equal the root exactly or be a direct descendant.
  if (resolved !== normalRoot && !resolved.startsWith(normalRoot + sep)) {
    return null;
  }
  return resolved;
}

/**
 * Derive the file extension (including the leading dot, lowercased) from an
 * `ipodPath`. Returns `''` when there is no extension or no path.
 *
 * e.g. `:iPod_Control:Music:F00:ABCD.M4A` → `.m4a`.
 */
export function ipodPathExtension(ipodPath: string | null | undefined): string {
  const segments = ipodPathToRelativeSegments(ipodPath);
  if (!segments) return '';
  const last = segments[segments.length - 1] ?? '';
  return extname(last).toLowerCase();
}

/**
 * Derive the source basename (without extension) from an `ipodPath`, used as a
 * last-resort title when a track carries no title metadata. Returns `''` when
 * there is no path.
 *
 * e.g. `:iPod_Control:Music:F00:ABCD.m4a` → `ABCD`.
 */
export function ipodPathBasename(ipodPath: string | null | undefined): string {
  const segments = ipodPathToRelativeSegments(ipodPath);
  if (!segments) return '';
  const last = segments[segments.length - 1] ?? '';
  const ext = extname(last);
  return ext ? last.slice(0, -ext.length) : last;
}

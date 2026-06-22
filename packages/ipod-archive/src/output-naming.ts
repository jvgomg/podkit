/**
 * Output-directory naming for an archive run.
 *
 * Builds `<deviceName>-<identity>-<timestamp>` and sanitises it for portable
 * filesystem use. Identity degrades gracefully so the command never fails just
 * because a stock / dying iPod lacks `SysInfoExtended`:
 *
 *   serial number → FireWire GUID → volume label → (timestamp only)
 *
 * The timestamp is always appended, so even an entirely anonymous device yields
 * a unique, sortable directory name.
 */

/** Inputs for {@link buildOutputDirName}. All fields are best-effort. */
export interface OutputNameIdentity {
  /**
   * Human label for the device. Typically the volume label; the CLI may pass a
   * configured podkit device name instead. Optional.
   */
  deviceName?: string;
  /** Apple serial number (from `SysInfoExtended`). Strongest identity. */
  serialNumber?: string;
  /** FireWire GUID (from `SysInfoExtended`). Fallback when serial is absent. */
  firewireGuid?: string;
  /** Volume label. Last-resort identity before falling back to timestamp-only. */
  volumeLabel?: string;
}

// `sanitizeSegment` is shared with the music-tree path planner; it lives in
// `sanitize.ts` so both stages neutralise reserved characters, control
// characters, reserved device names, and over-long names identically. Imported
// for use below and re-exported as part of this module's public surface.
import { sanitizeSegment } from './sanitize.js';
export { sanitizeSegment };

/**
 * A filesystem-safe UTC timestamp: `YYYYMMDD-HHMMSS`. Sortable, separator-free,
 * second-resolution.
 */
export function formatTimestamp(date: Date): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  return (
    `${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  );
}

/**
 * Pick the strongest available identity token, in degradation order. Returns
 * `undefined` when nothing usable is present (caller falls back to timestamp).
 */
export function resolveIdentityToken(identity: OutputNameIdentity): string | undefined {
  const candidates = [identity.serialNumber, identity.firewireGuid, identity.volumeLabel];
  for (const candidate of candidates) {
    const sanitized = candidate ? sanitizeSegment(candidate) : '';
    if (sanitized) return sanitized;
  }
  return undefined;
}

/**
 * Build the sanitised output-directory name for an archive run.
 *
 * @param identity - best-effort device identity.
 * @param now - clock injection point for tests; defaults to `new Date()`.
 */
export function buildOutputDirName(identity: OutputNameIdentity, now: Date = new Date()): string {
  const segments: string[] = [];

  const name = identity.deviceName ? sanitizeSegment(identity.deviceName) : '';
  if (name) segments.push(name);

  // The volume label may already be the deviceName; avoid duplicating it as the
  // identity token when it would just repeat the name segment.
  const token = resolveIdentityToken(identity);
  if (token && token.toLowerCase() !== name.toLowerCase()) {
    segments.push(token);
  }

  segments.push(formatTimestamp(now));

  // Guaranteed non-empty: timestamp is always present.
  return segments.join('-');
}

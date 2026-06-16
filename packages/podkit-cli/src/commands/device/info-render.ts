/**
 * Layout helpers for `podkit device info` (text mode).
 *
 * Two zones:
 *
 * - **Summary** — header anchor + per-device live state (Status, Model,
 *   Storage, Music, Readiness). Padded by {@link SUMMARY_LABEL_WIDTH} so
 *   columns align across the block regardless of which optional rows fire.
 *
 * - **Settings** — resolved cascade rows for quality / artwork / per-device
 *   capability overrides. Every row goes through `formatResolvedRow` so
 *   inheritance markers (`[bracketed]`), the unsupported / unknown symbols
 *   (`✗` / `?`), and the optional `from <provenance>` tail come from one
 *   helper. Replaces the hand-rolled `device.quality || '(not set)'` reads
 *   in the old info.ts callback.
 *
 * @module
 */
import type { ResolvedDeviceCapabilities } from '@podkit/device-types';
import type { OutputContext } from '../../output/index.js';
import { formatResolved, type ResolvedDeviceSettings } from '../../config/resolve.js';

/**
 * Fixed column width for the Summary zone label gutter. Picked so the
 * longest label (`Readiness:` — 10 chars) fits with room for one trailing
 * space (`Readiness:      ` — 16 chars including the colon). Every row
 * uses the same width — no per-row drift, no eyeballing.
 */
export const SUMMARY_LABEL_WIDTH = 14;

/**
 * Print a Summary-zone row with consistent label padding. Indent matches the
 * 2-space convention of the surrounding zone.
 */
export function printSummaryRow(out: OutputContext, label: string, value: string): void {
  out.print(`  ${`${label}:`.padEnd(SUMMARY_LABEL_WIDTH + 2)}${value}`);
}

/**
 * Print a peer section header — blank line above, the title on its own
 * line. Used for `Capabilities (from …)` and `Settings (resolved; …)`.
 */
export function printSectionHeader(out: OutputContext, title: string): void {
  out.newline();
  out.print(title);
}

/**
 * Settings-section row spec — a label paired with a value the renderer
 * derives from a `Resolved<…>` source. Authored as a list so the section
 * loop computes a common label width once.
 */
export interface SettingsRow {
  label: string;
  resolved: { value: unknown; source: string };
  /** Skip the row when source is `'unsupported'` or `'unknown'`. */
  skipWhenUnavailable?: boolean;
  /** Suppress the `from <provenance>` tail for this row only. */
  withoutTail?: boolean;
}

export interface PrintSettingsZoneOpts {
  /** Section title. Default `'Settings (resolved; [brackets] = inherited)'`. */
  sectionTitle?: string;
  /**
   * Sources forwarded to `formatResolved` via `formatResolvedRow`. When
   * omitted, `formatResolved` falls back to its own `DEFAULT_EXPLICIT_SOURCES`
   * (`['device', 'device-config']`) — the device-row boundary used across
   * the CLI. Override here only for non-device-row consumers (e.g. the
   * `device list` global row uses `GLOBAL_EXPLICIT_SOURCES`).
   */
  explicitSources?: readonly string[];
}

/**
 * Print the Settings zone: section header followed by one `formatResolvedRow`
 * line per supplied {@link SettingsRow}. Label column is right-padded to the
 * widest label in the list so every row aligns.
 */
export function printSettingsZone(
  out: OutputContext,
  rows: readonly SettingsRow[],
  opts: PrintSettingsZoneOpts = {}
): void {
  const visible = rows.filter(
    (r) =>
      !(
        r.skipWhenUnavailable &&
        (r.resolved.source === 'unsupported' || r.resolved.source === 'unknown')
      )
  );
  if (visible.length === 0) return;

  const labelWidth = Math.max(...visible.map((r) => r.label.length));

  printSectionHeader(out, opts.sectionTitle ?? 'Settings (resolved; [brackets] = inherited)');
  for (const row of visible) {
    const line = formatResolvedRow(row.label, row.resolved, {
      labelWidth,
      explicitSources: opts.explicitSources,
      withProvenanceTail: !row.withoutTail,
    });
    out.print(`  ${line}`);
  }
}

/**
 * Format a labelled row from a `Resolved<T, Source>` value.
 *
 *     <label-padded><value>[  <provenance-tail>]
 *
 * Currently consumed only by {@link printSettingsZone}. Lives here (rather
 * than in `output/`) until a second consumer materialises; lift to a
 * cross-command location at that point.
 */
function formatResolvedRow(
  label: string,
  resolved: { value: unknown; source: string },
  opts: {
    labelWidth?: number;
    withProvenanceTail?: boolean;
    explicitSources?: readonly string[];
  } = {}
): string {
  const colonised = `${label}:`;
  const padded = opts.labelWidth ? colonised.padEnd(opts.labelWidth + 2) : `${colonised} `;
  const value = formatResolved(resolved, { explicitSources: opts.explicitSources });
  const tail = opts.withProvenanceTail ? formatProvenanceTail(resolved.source) : '';
  return tail ? `${padded}${value}  ${tail}` : `${padded}${value}`;
}

/**
 * Map a cascade `source` string to a human-readable provenance phrase.
 * Empty string for sources where the inline marker (`✗` / `?`) is the
 * whole story.
 */
function formatProvenanceTail(source: string): string {
  switch (source) {
    case 'device':
    case 'device-config':
      return 'device override';
    case 'device-quality':
      return 'inherited from device quality';
    case 'global':
      return 'from global';
    case 'global-quality':
      return 'from global quality';
    case 'preset':
      return 'from preset';
    case 'default':
      return 'default';
    case 'unsupported':
    case 'unknown':
      return '';
    default:
      return '';
  }
}

/**
 * Build the standard Settings rows for a device, given:
 *
 * - `settings` — the config cascade from `resolveDeviceSettings`.
 * - `caps` — the capability cascade from `resolveCapabilitiesResolved`
 *   (mass-storage only; iPod doesn't surface per-device capability overrides
 *   in this UI yet — its capabilities live in the Capabilities section
 *   alone). When omitted, only the config-side rows are emitted.
 * - `outputCodec` — the comma-joined intersection of the device's codec
 *   stack with `lossy + lossless` (computed once by the caller; see
 *   `info.ts` for the snippet — pulled out so the Settings section's
 *   `Output codecs:` row sits next to other config-cascade values).
 */
export function buildSettingsRows(
  settings: ResolvedDeviceSettings,
  caps: ResolvedDeviceCapabilities | undefined,
  outputCodec: { value: string; source: string }
): SettingsRow[] {
  const rows: SettingsRow[] = [];

  // Display-label overrides (mass-storage only). Manufacturer / product name
  // both originate from the preset baseline; surface them at the top so the
  // section reads "what is this thing?" before "how is it configured?"
  if (settings.manufacturer) {
    rows.push({ label: 'Manufacturer', resolved: settings.manufacturer });
  }
  if (settings.productName) {
    rows.push({ label: 'Product name', resolved: settings.productName });
  }

  rows.push({ label: 'Music quality', resolved: settings.audio });
  rows.push({
    label: 'Video quality',
    resolved: settings.video,
    skipWhenUnavailable: true,
  });
  rows.push({ label: 'Output codecs', resolved: outputCodec });
  rows.push({ label: 'Artwork', resolved: settings.artwork });

  // Capability-cascade overrides — only the rows where the user actually
  // overrode the preset (source === 'device-config') are interesting in the
  // Settings section; the preset baseline already shows in Capabilities.
  if (caps) {
    if (caps.artworkMaxResolution.source === 'device-config') {
      rows.push({
        label: 'Artwork resolution',
        resolved: { value: `${caps.artworkMaxResolution.value}px`, source: 'device-config' },
      });
    }
    if (caps.audioNormalization.source === 'device-config') {
      rows.push({ label: 'Normalization', resolved: caps.audioNormalization });
    }
    if (caps.supportsAlbumArtistBrowsing.source === 'device-config') {
      rows.push({ label: 'Album artist', resolved: caps.supportsAlbumArtistBrowsing });
    }
  }

  return rows;
}

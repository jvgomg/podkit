/**
 * Central canonical docs URL builder. Single source of truth for every
 * user-facing message that links to podkit's documentation site, so the
 * host or path layout can change without grep-and-replace across the
 * codebase.
 *
 * Current host: `jvgomg.github.io/podkit` (Starlight on GitHub Pages).
 */

export const DOCS_BASE_URL = 'https://jvgomg.github.io/podkit';

/**
 * Build a docs URL from a page slug (leading slash optional).
 *
 * @example
 *   docsUrl('devices/linux-filesystems')
 *     // → 'https://jvgomg.github.io/podkit/devices/linux-filesystems'
 */
export function docsUrl(slug: string): string {
  const normalized = slug.startsWith('/') ? slug : `/${slug}`;
  return `${DOCS_BASE_URL}${normalized}`;
}

/**
 * Named canonical URLs for pages referenced from CLI messages and core
 * diagnostics. Add new entries here rather than inlining literal URLs at
 * the call site.
 */
export const DOCS_URLS = {
  supportedDevices: docsUrl('devices/supported-devices'),
  linuxFilesystems: docsUrl('devices/linux-filesystems'),
  troubleshooting: docsUrl('devices/troubleshooting'),
  artworkRepair: docsUrl('troubleshooting/artwork-repair'),
  macosMounting: docsUrl('troubleshooting/macos-mounting'),
  soundCheck: docsUrl('user-guide/syncing/sound-check'),
  userGuideConfiguration: docsUrl('user-guide/configuration'),
  cleanArtists: docsUrl('reference/clean-artists'),
} as const;

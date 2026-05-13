/**
 * Config version detection
 *
 * Provides generic version reading from raw TOML without typed config parsing.
 * This allows version checks to work even when the config structure has changed
 * incompatibly between versions (the TOML is parsed as Record<string, unknown>,
 * not as ConfigFileContent).
 */

import { parse as parseTOML } from 'smol-toml';

/** Current config version. Bump this when adding a new migration. */
export const CURRENT_CONFIG_VERSION = 2;

/**
 * Read the version field from raw TOML content.
 * Returns 0 if no version field is present (pre-versioning era).
 * Throws on invalid version values (non-integer, negative, zero).
 */
export function readConfigVersion(tomlContent: string): number {
  // Parse TOML generically — we only care about the top-level `version` field
  const parsed = parseTOML(tomlContent) as Record<string, unknown>;

  if (parsed.version === undefined) {
    return 0;
  }

  if (
    typeof parsed.version !== 'number' ||
    !Number.isInteger(parsed.version) ||
    parsed.version < 1
  ) {
    throw new Error(`Invalid config version "${parsed.version}". Expected a positive integer.`);
  }

  return parsed.version;
}

/**
 * Check if a config file version is outdated.
 * Returns null if the config is current, or an error message if outdated.
 */
export function checkConfigVersion(version: number): string | null {
  if (version >= CURRENT_CONFIG_VERSION) {
    return null;
  }

  return (
    `Your config file is at version ${version}, but podkit requires version ${CURRENT_CONFIG_VERSION}.\n` +
    `Run 'podkit migrate' to update your config file.`
  );
}

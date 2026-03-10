/**
 * Configuration file writer
 *
 * Provides utilities to update the config file with new sections
 * while preserving existing content.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MusicCollectionConfig, VideoCollectionConfig, DeviceConfig } from './types.js';
import { DEFAULT_CONFIG_PATH } from './defaults.js';

/**
 * Collection type for config operations
 */
export type CollectionType = 'music' | 'video';

/**
 * Options for updating config file
 */
export interface UpdateConfigOptions {
  /** Path to config file (defaults to DEFAULT_CONFIG_PATH) */
  configPath?: string;
  /** Create file if it doesn't exist */
  createIfMissing?: boolean;
}

/**
 * Result of config update operation
 */
export interface UpdateConfigResult {
  /** Whether the update succeeded */
  success: boolean;
  /** Path to the config file */
  configPath: string;
  /** Whether the file was created */
  created: boolean;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Multi-device configuration (ADR-008)
// =============================================================================

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Add a device to the config file
 *
 * Creates a [devices.<name>] section with the device configuration.
 * Creates the config file and parent directories if needed.
 */
export function addDevice(
  name: string,
  device: DeviceConfig,
  options?: UpdateConfigOptions
): UpdateConfigResult {
  const configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;
  const createIfMissing = options?.createIfMissing ?? true;

  let content = '';
  let created = false;

  // Read existing config if it exists
  if (fs.existsSync(configPath)) {
    content = fs.readFileSync(configPath, 'utf-8');
  } else if (createIfMissing) {
    created = true;
    // Create parent directory if needed
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } else {
    return {
      success: false,
      configPath,
      created: false,
      error: `Config file not found: ${configPath}`,
    };
  }

  // Check if device already exists
  const deviceSectionRegex = new RegExp(`\\[devices\\.${escapeRegExp(name)}\\]`);
  if (deviceSectionRegex.test(content)) {
    return {
      success: false,
      configPath,
      created: false,
      error: `Device "${name}" already exists in config`,
    };
  }

  // Build the device section
  const lines: string[] = [`[devices.${name}]`];
  lines.push(`volumeUuid = "${device.volumeUuid}"`);
  lines.push(`volumeName = "${device.volumeName}"`);

  if (device.quality !== undefined) {
    lines.push(`quality = "${device.quality}"`);
  }
  if (device.audioQuality !== undefined) {
    lines.push(`audioQuality = "${device.audioQuality}"`);
  }
  if (device.videoQuality !== undefined) {
    lines.push(`videoQuality = "${device.videoQuality}"`);
  }
  if (device.artwork !== undefined) {
    lines.push(`artwork = ${device.artwork}`);
  }

  // Handle transforms (nested TOML)
  if (device.transforms) {
    for (const [transformName, transformConfig] of Object.entries(device.transforms)) {
      const config = transformConfig as Record<string, unknown>;
      const transformLines: string[] = [];

      if ('enabled' in config) {
        transformLines.push(`enabled = ${config.enabled}`);
      }
      if ('drop' in config) {
        transformLines.push(`drop = ${config.drop}`);
      }
      if ('format' in config && config.format) {
        transformLines.push(`format = "${config.format}"`);
      }
      if ('ignore' in config && Array.isArray(config.ignore)) {
        const ignoreList = config.ignore.map((s: string) => `"${s}"`).join(', ');
        transformLines.push(`ignore = [${ignoreList}]`);
      }

      if (transformLines.length > 0) {
        lines.push('');
        lines.push(`[devices.${name}.transforms.${transformName}]`);
        lines.push(...transformLines);
      }
    }
  }

  const deviceSection = '\n' + lines.join('\n') + '\n';

  // Append the device section
  if (content.length > 0 && !content.endsWith('\n')) {
    content += '\n';
  }
  content += deviceSection;

  // Write updated config
  try {
    fs.writeFileSync(configPath, content);
    return {
      success: true,
      configPath,
      created,
    };
  } catch (err) {
    return {
      success: false,
      configPath,
      created: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Remove a device from the config file
 *
 * Removes the [devices.<name>] section and any nested sections.
 */
export function removeDevice(name: string, options?: UpdateConfigOptions): UpdateConfigResult {
  const configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(configPath)) {
    return {
      success: false,
      configPath,
      created: false,
      error: `Config file not found: ${configPath}`,
    };
  }

  let content = fs.readFileSync(configPath, 'utf-8');

  // Check if device exists
  const deviceSectionRegex = new RegExp(`\\[devices\\.${escapeRegExp(name)}\\]`);
  if (!deviceSectionRegex.test(content)) {
    return {
      success: false,
      configPath,
      created: false,
      error: `Device "${name}" not found in config`,
    };
  }

  // Remove the [devices.<name>] section and any nested [devices.<name>.*] sections
  // This regex matches from [devices.name] up to the next top-level section or end of file
  // It also handles nested sections like [devices.name.transforms.ftintitle]
  const removeRegex = new RegExp(
    `\\n?\\[devices\\.${escapeRegExp(name)}\\][\\s\\S]*?(?=\\n\\[(?!devices\\.${escapeRegExp(name)}\\.))|\\n?\\[devices\\.${escapeRegExp(name)}\\][\\s\\S]*$`,
    'g'
  );
  content = content.replace(removeRegex, '');

  // Clean up multiple blank lines
  content = content.replace(/\n{3,}/g, '\n\n');

  // Clean up trailing whitespace
  content = content.trimEnd() + '\n';

  // Write updated config
  try {
    fs.writeFileSync(configPath, content);
    return {
      success: true,
      configPath,
      created: false,
    };
  } catch (err) {
    return {
      success: false,
      configPath,
      created: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Set the default device in the config file
 *
 * Updates or creates the [defaults] section with the device name.
 * Pass an empty string to clear the default device.
 */
export function setDefaultDevice(name: string, options?: UpdateConfigOptions): UpdateConfigResult {
  const configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;
  const createIfMissing = options?.createIfMissing ?? true;

  let content = '';
  let created = false;

  // Read existing config if it exists
  if (fs.existsSync(configPath)) {
    content = fs.readFileSync(configPath, 'utf-8');
  } else if (createIfMissing) {
    created = true;
    // Create parent directory if needed
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } else {
    return {
      success: false,
      configPath,
      created: false,
      error: `Config file not found: ${configPath}`,
    };
  }

  // Check if [defaults] section exists
  const defaultsSectionRegex = /\[defaults\]/;
  const deviceLineRegex = /^device\s*=\s*["']?[^"'\n]*["']?\s*$/m;

  if (defaultsSectionRegex.test(content)) {
    // [defaults] section exists
    if (name === '') {
      // Clear the default device - remove the device line from [defaults]
      // Find the [defaults] section and remove just the device = ... line
      content = content.replace(
        /(\[defaults\][^[]*?)^device\s*=\s*["']?[^"'\n]*["']?\s*\n?/m,
        '$1'
      );
    } else {
      // Check if device = ... line exists in [defaults]
      // We need to find the line within the [defaults] section
      const defaultsMatch = content.match(/\[defaults\]([^[]*)/);
      if (defaultsMatch?.[1] && deviceLineRegex.test(defaultsMatch[1])) {
        // Replace existing device line within [defaults] section
        content = content.replace(
          /(\[defaults\][^[]*?)^device\s*=\s*["']?[^"'\n]*["']?\s*$/m,
          `$1device = "${name}"`
        );
      } else {
        // Add device line to existing [defaults] section
        content = content.replace(/(\[defaults\]\s*\n)/, `$1device = "${name}"\n`);
      }
    }
  } else if (name !== '') {
    // Create [defaults] section with device
    const defaultsSection = `
[defaults]
device = "${name}"
`;
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += defaultsSection;
  }
  // If name is empty and no [defaults] section exists, nothing to do

  // Clean up multiple blank lines
  content = content.replace(/\n{3,}/g, '\n\n');

  // Write updated config
  try {
    fs.writeFileSync(configPath, content);
    return {
      success: true,
      configPath,
      created,
    };
  } catch (err) {
    return {
      success: false,
      configPath,
      created: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// Collection Management Functions
// =============================================================================

/**
 * Escape a TOML string value
 */
function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Ensure config file exists and return its content
 */
function ensureConfigFile(
  configPath: string,
  createIfMissing: boolean
): { content: string; created: boolean } | { error: string } {
  if (fs.existsSync(configPath)) {
    return {
      content: fs.readFileSync(configPath, 'utf-8'),
      created: false,
    };
  }

  if (createIfMissing) {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return { content: '', created: true };
  }

  return { error: `Config file not found: ${configPath}` };
}

/**
 * Add a music collection to the config file
 *
 * Creates a [music.<name>] section with the collection configuration.
 *
 * @example
 * ```typescript
 * addMusicCollection('main', { path: '/path/to/music' });
 * // Creates:
 * // [music.main]
 * // path = "/path/to/music"
 * ```
 */
export function addMusicCollection(
  name: string,
  collection: MusicCollectionConfig,
  options?: UpdateConfigOptions
): UpdateConfigResult {
  const configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;
  const createIfMissing = options?.createIfMissing ?? true;

  const fileResult = ensureConfigFile(configPath, createIfMissing);
  if ('error' in fileResult) {
    return {
      success: false,
      configPath,
      created: false,
      error: fileResult.error,
    };
  }

  let { content } = fileResult;
  const { created } = fileResult;

  // Generate the [music.<name>] section
  let section = `\n[music.${name}]\n`;
  section += `path = "${escapeTomlString(collection.path)}"\n`;

  if (collection.type && collection.type !== 'directory') {
    section += `type = "${collection.type}"\n`;
  }
  if (collection.url) {
    section += `url = "${escapeTomlString(collection.url)}"\n`;
  }
  if (collection.username) {
    section += `username = "${escapeTomlString(collection.username)}"\n`;
  }
  if (collection.password) {
    section += `password = "${escapeTomlString(collection.password)}"\n`;
  }

  // Check if section already exists
  const sectionRegex = new RegExp(`\\[music\\.${escapeRegExp(name)}\\]`);
  if (sectionRegex.test(content)) {
    return {
      success: false,
      configPath,
      created: false,
      error: `Music collection '${name}' already exists in config`,
    };
  }

  // Append the section
  if (content.length > 0 && !content.endsWith('\n')) {
    content += '\n';
  }
  content += section;

  try {
    fs.writeFileSync(configPath, content);
    return {
      success: true,
      configPath,
      created,
    };
  } catch (err) {
    return {
      success: false,
      configPath,
      created: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Add a video collection to the config file
 *
 * Creates a [video.<name>] section with the collection configuration.
 *
 * @example
 * ```typescript
 * addVideoCollection('movies', { path: '/path/to/movies' });
 * // Creates:
 * // [video.movies]
 * // path = "/path/to/movies"
 * ```
 */
export function addVideoCollection(
  name: string,
  collection: VideoCollectionConfig,
  options?: UpdateConfigOptions
): UpdateConfigResult {
  const configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;
  const createIfMissing = options?.createIfMissing ?? true;

  const fileResult = ensureConfigFile(configPath, createIfMissing);
  if ('error' in fileResult) {
    return {
      success: false,
      configPath,
      created: false,
      error: fileResult.error,
    };
  }

  let { content } = fileResult;
  const { created } = fileResult;

  // Generate the [video.<name>] section
  const section = `\n[video.${name}]\npath = "${escapeTomlString(collection.path)}"\n`;

  // Check if section already exists
  const sectionRegex = new RegExp(`\\[video\\.${escapeRegExp(name)}\\]`);
  if (sectionRegex.test(content)) {
    return {
      success: false,
      configPath,
      created: false,
      error: `Video collection '${name}' already exists in config`,
    };
  }

  // Append the section
  if (content.length > 0 && !content.endsWith('\n')) {
    content += '\n';
  }
  content += section;

  try {
    fs.writeFileSync(configPath, content);
    return {
      success: true,
      configPath,
      created,
    };
  } catch (err) {
    return {
      success: false,
      configPath,
      created: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Remove a collection from the config file
 *
 * Removes the [music.<name>] or [video.<name>] section.
 * Also clears the default if this collection was set as default.
 */
export function removeCollection(
  type: CollectionType,
  name: string,
  options?: UpdateConfigOptions
): UpdateConfigResult {
  const configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(configPath)) {
    return {
      success: false,
      configPath,
      created: false,
      error: `Config file not found: ${configPath}`,
    };
  }

  let content = fs.readFileSync(configPath, 'utf-8');

  // Build regex to match the section
  // Matches [type.name] and everything until the next [section] or end of file
  const sectionRegex = new RegExp(
    `\\n?\\[${type}\\.${escapeRegExp(name)}\\][\\s\\S]*?(?=\\n\\[|\\s*$)`,
    'g'
  );

  const originalContent = content;
  content = content.replace(sectionRegex, '');

  if (content === originalContent) {
    return {
      success: false,
      configPath,
      created: false,
      error: `${type.charAt(0).toUpperCase() + type.slice(1)} collection '${name}' not found in config`,
    };
  }

  // Also clear the default if this was set as default
  // Match: music = "name" or video = "name" within [defaults] section
  const defaultsKeyRegex = new RegExp(
    `^(\\s*)${type}\\s*=\\s*["']${escapeRegExp(name)}["']\\s*$`,
    'gm'
  );
  content = content.replace(defaultsKeyRegex, '');

  // Clean up multiple blank lines
  content = content.replace(/\n{3,}/g, '\n\n');

  // Clean up empty [defaults] section
  content = content.replace(/\n?\[defaults\]\s*\n(?=\[|$)/g, '\n');

  // Trim trailing whitespace but ensure file ends with newline
  content = content.trimEnd() + '\n';

  try {
    fs.writeFileSync(configPath, content);
    return {
      success: true,
      configPath,
      created: false,
    };
  } catch (err) {
    return {
      success: false,
      configPath,
      created: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Set a collection as the default for its type
 *
 * Updates or creates the [defaults] section with the appropriate key.
 *
 * @example
 * ```typescript
 * setDefaultCollection('music', 'main');
 * // Creates/updates:
 * // [defaults]
 * // music = "main"
 * ```
 */
export function setDefaultCollection(
  type: CollectionType,
  name: string,
  options?: UpdateConfigOptions
): UpdateConfigResult {
  const configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;
  const createIfMissing = options?.createIfMissing ?? true;

  const fileResult = ensureConfigFile(configPath, createIfMissing);
  if ('error' in fileResult) {
    return {
      success: false,
      configPath,
      created: false,
      error: fileResult.error,
    };
  }

  let { content } = fileResult;
  const { created } = fileResult;

  // Check if [defaults] section exists
  const defaultsSectionRegex = /\[defaults\]/;
  const hasDefaultsSection = defaultsSectionRegex.test(content);

  // Check if the specific default key already exists
  const defaultKeyRegex = new RegExp(`^\\s*${type}\\s*=\\s*["'][^"']*["']`, 'gm');
  const hasExistingDefault = defaultKeyRegex.test(content);

  if (hasDefaultsSection) {
    if (hasExistingDefault) {
      // Replace existing default
      content = content.replace(
        new RegExp(`^(\\s*)${type}\\s*=\\s*["'][^"']*["']`, 'gm'),
        `$1${type} = "${escapeTomlString(name)}"`
      );
    } else {
      // Add to existing [defaults] section
      content = content.replace(/(\[defaults\])/, `$1\n${type} = "${escapeTomlString(name)}"`);
    }
  } else {
    // Create [defaults] section
    const defaultsSection = `\n[defaults]\n${type} = "${escapeTomlString(name)}"\n`;
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += defaultsSection;
  }

  try {
    fs.writeFileSync(configPath, content);
    return {
      success: true,
      configPath,
      created,
    };
  } catch (err) {
    return {
      success: false,
      configPath,
      created: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

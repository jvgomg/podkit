import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_CONFIG_PATH, DEFAULT_CONFIG, CURRENT_CONFIG_VERSION } from '../config/index.js';
import type { GlobalOptions } from '../config/index.js';
import { OutputContext } from '../output/index.js';

/**
 * Default configuration file template (TOML format)
 *
 * This template uses the ADR-008 multi-collection/device schema.
 * See docs/adr/ADR-008-multi-collection-device-config.md for details.
 */
export const CONFIG_TEMPLATE = `# podkit configuration
# Docs: https://jvgomg.github.io/podkit/user-guide/configuration

version = ${CURRENT_CONFIG_VERSION}

# Music collections
# Uncomment and edit to add your music library:
# [music.main]
# path = "/path/to/your/music"

# Video collections (optional)
# [video.movies]
# path = "/path/to/movies"

# Transfer mode for synced files
# transferMode = "fast"       # Optimized for iPod playback, strips embedded artwork (default)
# transferMode = "optimized"  # Strip embedded artwork from transcoded files
# transferMode = "portable"   # Preserve embedded artwork for exportable files

# Clean up featured artist entries in iPod artist list
# Moves "Artist feat. X" credits from the artist field into the title.
# Docs: https://jvgomg.github.io/podkit/reference/clean-artists
#
# Simple — just enable it:
# cleanArtists = true
#
# With options:
# [cleanArtists]
# drop = false          # true to remove feat. info entirely
# format = "feat. {}"   # format string ({} = featured artist)
# ignore = []           # artist names to skip, e.g. ["Simon & Garfunkel"]

# Devices
# Run 'podkit device add -d <name>' to auto-detect and add your iPod
# Or manually configure:
# [devices.ipod]
# volumeUuid = "YOUR-UUID-HERE"
# volumeName = "IPOD"
# quality = "${DEFAULT_CONFIG.quality}"
# artwork = ${DEFAULT_CONFIG.artwork}

# Defaults
# [defaults]
# music = "main"
# device = "ipod"
`;

/**
 * Options for createConfigFile
 */
export interface CreateConfigOptions {
  /** Path to create the config file at */
  configPath: string;
  /** Overwrite existing file if it exists */
  force?: boolean;
}

/**
 * Result of createConfigFile operation
 */
export interface CreateConfigResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** The path where config was created (on success) or would be created (on error) */
  configPath: string;
  /** Whether the file already existed */
  alreadyExisted: boolean;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Check if a config file already exists
 */
export function configExists(configPath: string): boolean {
  return fs.existsSync(configPath);
}

/**
 * Create a default configuration file
 *
 * Creates parent directories if they don't exist.
 * Returns an error if file exists and force is not set.
 */
export function createConfigFile(options: CreateConfigOptions): CreateConfigResult {
  const { configPath, force = false } = options;
  const alreadyExisted = configExists(configPath);

  // Check if config already exists
  if (alreadyExisted && !force) {
    return {
      success: false,
      configPath,
      alreadyExisted,
      error: `Config file already exists at ${configPath}. Use --force to overwrite.`,
    };
  }

  // Create directory if it doesn't exist
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Write config file
  fs.writeFileSync(configPath, CONFIG_TEMPLATE);

  return {
    success: true,
    configPath,
    alreadyExisted,
  };
}

/**
 * Format success message with next steps
 */
export function formatSuccessMessage(configPath: string): string {
  const lines = [
    `Created config file at ${configPath}`,
    '',
    'Next steps:',
    `  1. Edit ${configPath} to set your music source directory`,
    '  2. Connect your iPod',
    '  3. Run: podkit device add -d <name>  (register your iPod)',
    '  4. Run: podkit device info',
    '  5. Run: podkit sync --dry-run',
  ];
  return lines.join('\n');
}

export const initCommand = new Command('init')
  .description('create a default configuration file')
  .option('-f, --force', 'overwrite existing config file')
  .option('--path <path>', 'config file path', DEFAULT_CONFIG_PATH)
  .action(async (options, command) => {
    // init bypasses preAction config loading (no context set),
    // so read global options directly from the root command
    const globalOpts = command.parent.opts() as GlobalOptions;
    const out = OutputContext.fromGlobalOpts(globalOpts);

    const configPath = options.path as string;
    const force = options.force as boolean;

    const result = createConfigFile({ configPath, force });

    if (!result.success) {
      out.error(`Error: ${result.error}`);
      out.json({ success: false, error: result.error, configPath: result.configPath });
      process.exit(1);
    }

    out.print(formatSuccessMessage(result.configPath));
    out.json({ success: true, configPath: result.configPath, created: true });
  });

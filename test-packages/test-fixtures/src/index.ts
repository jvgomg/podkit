#!/usr/bin/env bun
/**
 * Test fixture generator for podkit.
 *
 * Generates test audio files with synthetic sine tones, embedded metadata,
 * artwork, and ReplayGain tags. Supports variance flags for changing
 * specific axes while keeping others deterministic.
 *
 * Usage:
 *   bun run generate-fixtures
 *   bun run generate-fixtures --output test/manual-collection
 *   bun run generate-fixtures --artwork
 *   bun run generate-fixtures --artwork red
 *   bun run generate-fixtures --format mp3
 *   bun run generate-fixtures --format mp3 --bitrate 128
 *   bun run generate-fixtures --replaygain
 *   bun run generate-fixtures --replaygain -3.5
 *   bun run generate-fixtures --tracks 5
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { COLORS, isValidColor } from './artwork.js';
import { isValidFormat, VALID_FORMATS, type AudioFormat } from './convert.js';
import { generate, type GenerateOptions } from './generator.js';

// ---------------------------------------------------------------------------
// Dependency checks
// ---------------------------------------------------------------------------

function checkDependency(name: string): boolean {
  try {
    execSync(`which ${name}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkDependencies(): void {
  if (!checkDependency('ffmpeg')) {
    console.error('Error: ffmpeg is not installed or not in PATH.');
    console.error('Install it with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)');
    process.exit(1);
  }
  if (!checkDependency('metaflac')) {
    console.error('Error: metaflac is not installed or not in PATH.');
    console.error('Install it with: brew install flac (macOS) or apt install flac (Linux)');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function findRepoRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { stdio: 'pipe' }).toString().trim();
  } catch {
    console.error('Error: Could not find repository root.');
    process.exit(1);
  }
}

interface ParsedArgs {
  output?: string;
  tracks?: number;
  artwork?: string | true;
  format?: AudioFormat;
  bitrate?: number;
  replaygain?: number | true;
  help?: boolean;
}

function printUsage(): void {
  console.log(`Usage: bun run generate-fixtures [options]

Generate test audio fixtures with deterministic output by default.
Use variance flags to change specific axes.

Options:
  --output <dir>         Output directory (default: test/manual-collection)
  --tracks <n>           Number of tracks to generate (default: 3)
  --artwork              Randomize artwork color
  --artwork <color>      Use specific color (${COLORS.join(', ')})
  --format <fmt>         Audio format (${VALID_FORMATS.join(', ')}) (default: flac)
  --bitrate <kbps>       Bitrate for lossy formats, 64-320 (default: 320 mp3, 256 aac/ogg)
  --replaygain           Randomize ReplayGain value
  --replaygain <dB>      Use specific ReplayGain value (e.g. -3.5)
  -h, --help             Show this help message`);
}

function parseArgv(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const parsed: ParsedArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
      continue;
    }

    if (arg === '--output') {
      i++;
      const value = args[i];
      if (!value || value.startsWith('--')) {
        console.error('Error: --output requires a directory path.');
        process.exit(1);
      }
      parsed.output = value;
      continue;
    }

    if (arg === '--tracks') {
      i++;
      const value = args[i];
      if (!value || value.startsWith('--')) {
        console.error('Error: --tracks requires a number.');
        process.exit(1);
      }
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 1) {
        console.error('Error: --tracks must be a positive integer.');
        process.exit(1);
      }
      parsed.tracks = n;
      continue;
    }

    if (arg === '--artwork') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        if (!isValidColor(next)) {
          console.error(`Error: Invalid color '${next}'. Valid colors: ${COLORS.join(', ')}`);
          process.exit(1);
        }
        parsed.artwork = next;
        i++;
      } else {
        parsed.artwork = true;
      }
      continue;
    }

    if (arg === '--format') {
      i++;
      const value = args[i];
      if (!value || value.startsWith('--')) {
        console.error('Error: --format requires a format name.');
        process.exit(1);
      }
      if (!isValidFormat(value)) {
        console.error(
          `Error: Invalid format '${value}'. Valid formats: ${VALID_FORMATS.join(', ')}`
        );
        process.exit(1);
      }
      parsed.format = value;
      continue;
    }

    if (arg === '--bitrate') {
      i++;
      const value = args[i];
      if (!value || value.startsWith('--')) {
        console.error('Error: --bitrate requires a number.');
        process.exit(1);
      }
      const br = parseInt(value, 10);
      if (isNaN(br)) {
        console.error('Error: --bitrate must be a number.');
        process.exit(1);
      }
      parsed.bitrate = br;
      continue;
    }

    if (arg === '--replaygain') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        const gain = parseFloat(next);
        if (isNaN(gain)) {
          console.error('Error: --replaygain value must be a number.');
          process.exit(1);
        }
        parsed.replaygain = gain;
        i++;
      } else {
        parsed.replaygain = true;
      }
      continue;
    }

    console.error(`Error: Unknown option '${arg}'.`);
    printUsage();
    process.exit(1);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const parsed = parseArgv(process.argv);

  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  checkDependencies();

  const repoRoot = findRepoRoot();
  const defaultOutput = resolve(repoRoot, 'test/manual-collection');

  const options: GenerateOptions = {
    output: parsed.output ?? defaultOutput,
    tracks: parsed.tracks,
    artwork: parsed.artwork,
    format: parsed.format,
    bitrate: parsed.bitrate,
    replaygain: parsed.replaygain,
  };

  generate(options);
}

main();

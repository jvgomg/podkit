import { parse as parseTOML } from 'smol-toml';
import type { Migration } from './types.js';

/**
 * Migration 1→2: Rename `'ogg'` to `'vorbis'` in `supportedAudioCodecs`.
 *
 * Background: the `AudioCodec` type used to use `'ogg'` to mean
 * "OGG Vorbis." That conflated container (OGG) with codec (Vorbis), and
 * couldn't represent Opus-in-OGG vs Vorbis-in-OGG distinctly. The codec
 * slot now names the audio stream codec, with `'vorbis'` replacing
 * `'ogg'`.
 *
 * Strategy: line-scan with section tracking. When the scanner is inside
 * a `[devices.<name>]` section that the parsed TOML confirms contains
 * `'ogg'` in `supportedAudioCodecs`, rewrite `'ogg'` / `"ogg"` to the
 * vorbis equivalent inside the array literal (which may span multiple
 * lines). Comments, formatting, and unrelated strings are untouched.
 *
 * Regex-spanning from section header to key was attempted first but
 * fails when sibling array-valued keys (e.g. `artworkSources = [...]`)
 * sit between the header and `supportedAudioCodecs` — `[^\[]` stops at
 * the literal `[` opening the sibling array.
 */
export const migration0002: Migration = {
  fromVersion: 1,
  toVersion: 2,
  description: 'Rename codec "ogg" → "vorbis" in supportedAudioCodecs',
  type: 'automatic',
  async migrate(content: string): Promise<string> {
    const parsed = parseTOML(content) as Record<string, unknown>;
    const devices = parsed.devices;
    if (!devices || typeof devices !== 'object') {
      return bumpVersion(content);
    }

    // Identify which device sections actually need rewriting. The line
    // scanner only touches `supportedAudioCodecs` keys under those
    // specific section headers, leaving any unrelated key (e.g. a
    // hypothetical `supportedAudioCodecs` under a non-device section)
    // alone.
    const targets = new Set<string>();
    for (const deviceName of Object.keys(devices)) {
      const device = (devices as Record<string, unknown>)[deviceName];
      if (!device || typeof device !== 'object') continue;
      const codecs = (device as Record<string, unknown>).supportedAudioCodecs;
      if (!Array.isArray(codecs)) continue;
      if (!codecs.includes('ogg')) continue;
      targets.add(deviceName);
    }

    const updated = targets.size > 0 ? rewriteOggInDeviceSections(content, targets) : content;
    return bumpVersion(updated);
  },
};

/**
 * Walk the TOML content line by line, tracking the current section
 * header. When inside a target device section AND inside that section's
 * `supportedAudioCodecs = [...]` array literal, replace `'ogg'` /
 * `"ogg"` with the vorbis equivalent on each line.
 */
function rewriteOggInDeviceSections(content: string, targetDevices: Set<string>): string {
  const deviceHeader = /^\s*\[(?:devices\.(?:"([^"]+)"|([\w-]+)))\]\s*(?:#.*)?$/;
  const anyHeader = /^\s*\[[^\]]+\]\s*(?:#.*)?$/;
  const codecsOpen = /^\s*supportedAudioCodecs\s*=\s*\[/;

  const lines = content.split('\n');
  const out: string[] = [];
  let inTargetSection = false;
  let inTargetArray = false;
  let arrayDepth = 0;

  for (const line of lines) {
    // Section transitions
    const headerMatch = deviceHeader.exec(line);
    if (headerMatch) {
      const name = headerMatch[1] ?? headerMatch[2];
      inTargetSection = !!name && targetDevices.has(name);
      inTargetArray = false;
      arrayDepth = 0;
      out.push(line);
      continue;
    }
    if (anyHeader.test(line)) {
      inTargetSection = false;
      inTargetArray = false;
      arrayDepth = 0;
      out.push(line);
      continue;
    }

    // Opening of the target array — start tracking depth from the `[`
    if (inTargetSection && !inTargetArray && codecsOpen.test(line)) {
      inTargetArray = true;
      arrayDepth = 0; // recompute from this line
    }

    if (inTargetArray) {
      const rewritten = line.replace(/(['"])ogg\1/g, '$1vorbis$1');
      out.push(rewritten);
      arrayDepth = updateDepth(rewritten, arrayDepth);
      if (arrayDepth <= 0) inTargetArray = false;
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

/**
 * Update bracket depth for a line, ignoring brackets inside string
 * literals and TOML comments. Used to find the matching `]` that closes
 * a `supportedAudioCodecs` array spanning one or more lines.
 */
function updateDepth(line: string, startDepth: number): number {
  let depth = startDepth;
  let inString: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === '#') break;
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
  }
  return depth;
}

/**
 * Bump the top-level `version = 1` line to `version = 2`. The TOML
 * parser already confirmed a version field exists (this is a 1→2
 * migration, so the file must be at v1).
 */
function bumpVersion(content: string): string {
  return content.replace(/^(\s*version\s*=\s*)1(\s*)$/m, '$1' + '2' + '$2');
}

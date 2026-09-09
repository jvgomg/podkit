/**
 * Measuring encoded audio in e2e assertions, and bounding it per encoder.
 *
 * Two problems this solves, both learned from TASK-499 / TASK-500:
 *
 * 1. **Container overhead is not the encoder's.** `ffprobe`'s
 *    `format.bit_rate` is total-bytes ÷ duration, so an MP4's `moov` atom and
 *    tag payload are charged to the audio. On the 2-4 second clips the e2e
 *    fixtures use that is worth ~9 kbps — enough to push a file encoded
 *    exactly at a 128 kbps cap up to a measured 137 and break a cap
 *    assertion that is otherwise correct. {@link probeAudioStreamBitrateKbps}
 *    reads the *stream*, which is what podkit asked the encoder for.
 *
 * 2. **A bitrate cap means different things to different encoders.** See
 *    {@link aacCeilingKbps}.
 *
 * @module
 */

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * The AAC encoders podkit knows about, in the priority order
 * `packages/podkit-core/src/transcode/ffmpeg.ts` resolves them
 * (`ENCODER_PRIORITY`).
 */
const AAC_ENCODER_PRIORITY = ['aac_at', 'libfdk_aac', 'aac'] as const;

export type AacEncoder = (typeof AAC_ENCODER_PRIORITY)[number];

let cachedEncoder: AacEncoder | undefined;

/**
 * The AAC encoder podkit will pick on this host.
 *
 * Mirrors the core transcoder's `ENCODER_PRIORITY` against `ffmpeg -encoders`.
 * Duplicated rather than imported because the e2e suite drives the CLI as a
 * black box; if the priority order in `ffmpeg.ts` ever changes, this must
 * change with it.
 *
 * Result is cached — the probe costs an ffmpeg spawn and the answer cannot
 * change inside a test run.
 */
export function resolveAacEncoder(): AacEncoder {
  if (cachedEncoder) return cachedEncoder;
  let listing = '';
  try {
    listing = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    listing = '';
  }
  cachedEncoder =
    AAC_ENCODER_PRIORITY.find((enc) => new RegExp(`\\b${enc}\\b`).test(listing)) ?? 'aac';
  return cachedEncoder;
}

/**
 * The highest measured stream bitrate a given cap tolerates on this host, in kbps.
 *
 * ADR-023 §2 makes a quality preset's bitrate a hard ceiling, but only one of
 * the three AAC encoders podkit can pick is *asked* for a bitrate:
 *
 * - **`aac`** (FFmpeg native) is driven in ABR mode with `-b:a` (TASK-499).
 *   Its rate control tracks the request to within a kbps even on
 *   incompressible content and never exceeds it, so the tolerance is the cap
 *   itself plus one kbps — and that one kbps is ffprobe's rounding, not
 *   encoder slack.
 * - **`aac_at`** (macOS AudioToolbox) and **`libfdk_aac`** expose only a
 *   quality index. podkit picks the index nearest (`aac_at`) or the richest
 *   band under (`libfdk_aac`) the target and the encoder decides the rest, so
 *   a measured result can land somewhat over. `aac_at`'s nine-point map puts
 *   `medium` (cap 192) at q=4 ≈ 200 kbps, ~4% over; 15% is the headroom
 *   `packages/podkit-core/src/transcode/ffmpeg.integration.test.ts` settled on
 *   for that class of encoder, and this deliberately matches it.
 *
 * A single number covering all three would have to be the loosest of them,
 * which is how `< 170` against a 128 kbps cap came to exist: a bound nobody
 * could derive, calibrated on whichever encoder the author happened to have.
 *
 * @param capKbps - The ceiling the product promised (a preset cap, or a
 *   planner-resolved target).
 * @param encoder - Override the resolved encoder; defaults to this host's.
 */
export function aacCeilingKbps(capKbps: number, encoder: AacEncoder = resolveAacEncoder()): number {
  return encoder === 'aac' ? capKbps + 1 : Math.round(capKbps * 1.15);
}

/**
 * Measured bitrate of a file's first audio stream, in kbps.
 *
 * Prefer this over `format.bit_rate` for any assertion about what an encoder
 * produced — see the module docblock.
 *
 * Falls back to `format.bit_rate` only when the container does not record a
 * per-stream bitrate (some muxers omit it); callers asserting a tight cap on
 * short fixtures should stick to formats that report it (MP4/M4A does).
 */
export async function probeAudioStreamBitrateKbps(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=bit_rate:format=bit_rate',
    '-of',
    'json',
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ bit_rate?: string }>;
    format?: { bit_rate?: string };
  };
  const raw = parsed.streams?.[0]?.bit_rate ?? parsed.format?.bit_rate;
  if (!raw) throw new Error(`ffprobe reported no bitrate for ${filePath}`);
  return Math.round(Number.parseInt(raw, 10) / 1000);
}

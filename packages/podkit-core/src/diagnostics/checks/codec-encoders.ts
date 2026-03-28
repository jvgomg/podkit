/**
 * Codec encoder availability diagnostic check
 *
 * Verifies that FFmpeg has the required encoders for all codecs in the user's
 * configured preference stacks (lossy + lossless). Missing encoders mean the
 * codec resolver will fall back to lower-priority codecs, which may not be
 * what the user expects.
 */

import { createFFmpegTranscoder } from '../../transcode/ffmpeg.js';
import {
  DEFAULT_LOSSY_STACK,
  DEFAULT_LOSSLESS_STACK,
  CODEC_METADATA,
} from '../../transcode/codecs.js';
import type { TranscodeTargetCodec } from '../../transcode/codecs.js';
import type { TranscoderCapabilities } from '../../transcode/types.js';
import type { DiagnosticCheck, CheckResult, DiagnosticContext } from '../types.js';

/** Human-readable names for FFmpeg encoder libraries */
const ENCODER_LABELS: Record<TranscodeTargetCodec, string> = {
  aac: 'AAC (aac/libfdk_aac/aac_at)',
  opus: 'Opus (libopus)',
  mp3: 'MP3 (libmp3lame)',
  flac: 'FLAC (flac)',
  alac: 'ALAC (alac)',
};

/**
 * Build platform-specific installation advice for missing encoders.
 */
function buildRepairAdvice(missing: TranscodeTargetCodec[]): string {
  const lines: string[] = ['Missing FFmpeg encoders. Installation suggestions:'];

  for (const codec of missing) {
    lines.push('');
    lines.push(`  ${CODEC_METADATA[codec].codec.toUpperCase()} encoder:`);

    switch (codec) {
      case 'opus':
        lines.push('    macOS:         brew install ffmpeg (usually includes libopus)');
        lines.push('                   or brew install opus && brew reinstall ffmpeg');
        lines.push('    Debian/Ubuntu: sudo apt install libopus-dev (then rebuild FFmpeg)');
        lines.push('                   or sudo apt install ffmpeg (recent versions include it)');
        lines.push('    Alpine:        apk add ffmpeg (community repo usually includes it)');
        break;
      case 'mp3':
        lines.push('    macOS:         brew install lame && brew reinstall ffmpeg');
        lines.push('    Debian/Ubuntu: sudo apt install libmp3lame-dev');
        lines.push('                   or sudo apt install ffmpeg');
        lines.push('    Alpine:        apk add ffmpeg (usually includes it)');
        break;
      case 'flac':
      case 'alac':
        lines.push('    These are built-in FFmpeg encoders. If missing, your FFmpeg');
        lines.push('    installation is likely broken — reinstall FFmpeg.');
        break;
      case 'aac':
        lines.push('    macOS:         brew install ffmpeg (includes aac_at on macOS)');
        lines.push('    Debian/Ubuntu: sudo apt install ffmpeg');
        lines.push('    Alpine:        apk add ffmpeg');
        break;
    }
  }

  return lines.join('\n');
}

/**
 * Get the unique set of TranscodeTargetCodecs from the preference stacks,
 * excluding 'source' (which means copy-as-is, no encoder needed).
 */
function getCodecsFromStacks(
  lossyStack: readonly TranscodeTargetCodec[],
  losslessStack: readonly (TranscodeTargetCodec | 'source')[]
): TranscodeTargetCodec[] {
  const codecs = new Set<TranscodeTargetCodec>();
  for (const codec of lossyStack) {
    codecs.add(codec);
  }
  for (const entry of losslessStack) {
    if (entry !== 'source') {
      codecs.add(entry);
    }
  }
  return [...codecs];
}

/**
 * Check encoder availability. Exported for testing with injected capabilities.
 */
export function checkEncoderAvailability(
  capabilities: TranscoderCapabilities,
  lossyStack: readonly TranscodeTargetCodec[] = DEFAULT_LOSSY_STACK,
  losslessStack: readonly (TranscodeTargetCodec | 'source')[] = DEFAULT_LOSSLESS_STACK
): CheckResult {
  const codecs = getCodecsFromStacks(lossyStack, losslessStack);
  const missing: TranscodeTargetCodec[] = [];

  for (const codec of codecs) {
    if (capabilities.preferredEncoders[codec] === undefined) {
      missing.push(codec);
    }
  }

  if (missing.length === 0) {
    return {
      status: 'pass',
      summary: `All ${codecs.length} codec encoder${codecs.length === 1 ? '' : 's'} available`,
      repairable: false,
      details: {
        checkedCodecs: codecs,
        encoders: Object.fromEntries(codecs.map((c) => [c, capabilities.preferredEncoders[c]])),
      },
    };
  }

  const missingLabels = missing.map((c) => ENCODER_LABELS[c]);

  return {
    status: 'warn',
    summary: `Missing encoder${missing.length === 1 ? '' : 's'}: ${missingLabels.join(', ')}`,
    repairable: false,
    details: {
      checkedCodecs: codecs,
      missingCodecs: missing,
      missingEncoders: missingLabels,
      availableEncoders: Object.fromEntries(
        codecs
          .filter((c) => !missing.includes(c))
          .map((c) => [c, capabilities.preferredEncoders[c]])
      ),
      repairAdvice: buildRepairAdvice(missing),
    },
  };
}

export const codecEncodersCheck: DiagnosticCheck = {
  id: 'codec-encoders',
  name: 'Codec Encoders',
  applicableTo: ['ipod', 'mass-storage'],

  async check(_ctx: DiagnosticContext): Promise<CheckResult> {
    // Detect FFmpeg capabilities
    let capabilities: TranscoderCapabilities;
    try {
      const transcoder = createFFmpegTranscoder();
      capabilities = await transcoder.detect();
    } catch {
      // FFmpeg not available — the ffmpeg check handles that, skip here
      return {
        status: 'skip',
        summary: 'FFmpeg not available (see FFmpeg check)',
        repairable: false,
      };
    }

    return checkEncoderAvailability(capabilities);
  },
};

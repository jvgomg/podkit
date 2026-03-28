/**
 * Codec preference resolver
 *
 * Pure function that resolves a codec preference stack against device
 * capabilities and available encoders. Used by the sync planner to
 * determine which codec to use for lossy and lossless transcoding.
 *
 * @module
 */

import {
  CODEC_METADATA,
  DEFAULT_LOSSLESS_STACK,
  DEFAULT_LOSSY_STACK,
  type CodecMetadata,
  type TranscodeTargetCodec,
} from './codecs.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Abstraction over encoder availability.
 *
 * The concrete implementation will be provided by `TranscoderCapabilities`
 * (TASK-248.05), but the resolver only needs this minimal interface.
 */
export interface EncoderAvailability {
  /** Check if an encoder for a given codec is available */
  hasEncoder(codec: TranscodeTargetCodec): boolean;
}

/** A resolved codec with its metadata */
export interface ResolvedCodec {
  codec: TranscodeTargetCodec;
  metadata: CodecMetadata;
}

/** Successful resolution of both lossy and lossless codec stacks */
export interface CodecResolutionResult {
  lossy: ResolvedCodec;
  lossless: (ResolvedCodec | 'source')[];
}

/** Error when no compatible codec can be found for a stack */
export interface CodecResolutionError {
  type: 'no-compatible-codec';
  stack: 'lossy' | 'lossless';
  preferred: string[];
  deviceSupported: string[];
}

// =============================================================================
// Type Guard
// =============================================================================

/** Type guard for codec resolution errors */
export function isCodecResolutionError(
  result: CodecResolutionResult | CodecResolutionError
): result is CodecResolutionError {
  return 'type' in result && result.type === 'no-compatible-codec';
}

// =============================================================================
// Validation
// =============================================================================

const KNOWN_CODECS = new Set<string>(Object.keys(CODEC_METADATA));

function validateCodecName(name: string, context: string): TranscodeTargetCodec {
  if (!KNOWN_CODECS.has(name)) {
    throw new Error(
      `Unknown codec '${name}' in ${context}. Valid codecs: ${[...KNOWN_CODECS].join(', ')}`
    );
  }
  return name as TranscodeTargetCodec;
}

// =============================================================================
// Resolver
// =============================================================================

/**
 * Resolve codec preferences against device capabilities and available encoders.
 *
 * Walks each preference stack top-to-bottom and selects the first codec that
 * is both supported by the device and has an available encoder.
 *
 * @param config - Already-merged codec preference config (caller merges global + device override)
 * @param deviceCodecs - Audio codecs the device supports natively
 * @param encoders - Encoder availability checker
 * @returns Resolved codecs or an error if no compatible lossy codec is found
 */
export function resolveCodecPreferences(
  config: { lossy?: string[]; lossless?: string[] } | undefined,
  deviceCodecs: readonly string[],
  encoders: EncoderAvailability
): CodecResolutionResult | CodecResolutionError {
  const deviceSet = new Set(deviceCodecs);

  // --- Lossy resolution ---
  const lossyStack = config?.lossy ?? DEFAULT_LOSSY_STACK;
  let resolvedLossy: ResolvedCodec | undefined;

  for (const name of lossyStack) {
    const codec = validateCodecName(name, 'lossy preference stack');
    if (deviceSet.has(codec) && encoders.hasEncoder(codec)) {
      resolvedLossy = { codec, metadata: CODEC_METADATA[codec] };
      break;
    }
  }

  if (!resolvedLossy) {
    return {
      type: 'no-compatible-codec',
      stack: 'lossy',
      preferred: [...lossyStack],
      deviceSupported: [...deviceCodecs],
    };
  }

  // --- Lossless resolution ---
  const losslessStack = config?.lossless ?? DEFAULT_LOSSLESS_STACK;
  const resolvedLossless: (ResolvedCodec | 'source')[] = [];

  for (const name of losslessStack) {
    if (name === 'source') {
      resolvedLossless.push('source');
      continue;
    }

    const codec = validateCodecName(name, 'lossless preference stack');
    if (deviceSet.has(codec) && encoders.hasEncoder(codec)) {
      resolvedLossless.push({ codec, metadata: CODEC_METADATA[codec] });
    }
  }

  return {
    lossy: resolvedLossy,
    lossless: resolvedLossless,
  };
}

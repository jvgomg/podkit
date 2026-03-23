/**
 * Sync tags — metadata stored in iPod track comment fields
 *
 * Sync tags record the transcode settings and artwork fingerprint used during
 * sync. They enable accurate change detection by comparing the tag against the
 * current configuration.
 *
 * ## Sync Tag Consistency
 *
 * A sync tag is "consistent" when it accurately reflects the track's actual
 * state on the iPod — correct quality preset, encoding mode, and artwork hash.
 * Inconsistencies can arise from:
 *
 * - Missing sync tags entirely (track synced before sync tags existed)
 * - Missing artwork hash (artwork present but never hashed)
 * - Stale artwork hash (artwork removed but hash lingers)
 * - Stale quality/encoding (track re-synced but tag not updated)
 *
 * The self-healing sync progressively writes and updates sync tags to maintain
 * consistency. Users can force full consistency with `--force-sync-tags`.
 *
 * ## Format
 *
 * A sync tag is a bracketed block embedded in the comment field:
 *
 *     [podkit:v1 quality=high encoding=vbr]
 *
 * Rules:
 * - Delimited by `[podkit:v1 ` and `]`
 * - Version `v1` — parser ignores unknown versions (forward compat)
 * - Key-value pairs, space-separated, order-independent
 * - Unknown keys are ignored (forward compat)
 * - Can coexist with other comment text
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed sync tag data
 *
 * Represents the transcode settings that produced a track on the iPod.
 */
export interface SyncTagData {
  /** Resolved quality preset: 'lossless' | 'high' | 'medium' | 'low' | 'max' (video only) */
  quality: string;
  /** Encoding mode: 'vbr' | 'cbr' (audio only, omitted for lossless/video) */
  encoding?: string;
  /** Custom bitrate override in kbps (audio only, only when explicitly set) */
  bitrate?: number;
  /** Artwork hash: 8-char lowercase hex string (xxHash truncated to 32 bits) */
  artworkHash?: string;
  /** File mode used for transcoding: 'optimized' | 'portable' (informational only) */
  fileMode?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Sync tag version prefix */
const TAG_PREFIX = '[podkit:v1 ';
/** Sync tag closing bracket */
const TAG_SUFFIX = ']';
/** Regex to match a podkit sync tag block (any version) */
const TAG_REGEX = /\[podkit:v(\d+)\s+([^\]]*)\]/;

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parse a sync tag from a comment string.
 *
 * Returns null if no valid v1 tag is found. Tags with unknown versions
 * are silently ignored (returns null) to avoid corrupting data from
 * newer podkit versions.
 *
 * @param comment - iPod track comment field (may be null/undefined)
 * @returns Parsed sync tag data, or null if no valid tag found
 */
export function parseSyncTag(comment: string | null | undefined): SyncTagData | null {
  if (!comment) {
    return null;
  }

  const match = TAG_REGEX.exec(comment);
  if (!match) {
    return null;
  }

  const version = match[1];
  const body = match[2];

  // Only parse v1 tags — unknown versions are ignored for forward compatibility
  if (version !== '1' || !body) {
    return null;
  }

  // Parse key=value pairs
  const pairs = body.trim().split(/\s+/);
  const data: Record<string, string> = {};

  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex > 0) {
      const key = pair.substring(0, eqIndex);
      const value = pair.substring(eqIndex + 1);
      data[key] = value;
    }
  }

  // quality is required
  if (!data.quality) {
    return null;
  }

  const result: SyncTagData = {
    quality: data.quality,
  };

  if (data.encoding) {
    result.encoding = data.encoding;
  }

  if (data.bitrate) {
    const bitrateNum = parseInt(data.bitrate, 10);
    if (!isNaN(bitrateNum)) {
      result.bitrate = bitrateNum;
    }
  }

  if (data.art && /^[0-9a-f]{8}$/.test(data.art)) {
    result.artworkHash = data.art;
  }

  if (data.mode) {
    result.fileMode = data.mode;
  }

  return result;
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format a SyncTagData into the tag string.
 *
 * @param data - Sync tag data to format
 * @returns Formatted tag string, e.g. `[podkit:v1 quality=high encoding=vbr]`
 */
export function formatSyncTag(data: SyncTagData): string {
  const parts: string[] = [`quality=${data.quality}`];

  if (data.encoding) {
    parts.push(`encoding=${data.encoding}`);
  }

  if (data.bitrate !== undefined) {
    parts.push(`bitrate=${data.bitrate}`);
  }

  if (data.artworkHash) {
    parts.push(`art=${data.artworkHash}`);
  }

  if (data.fileMode) {
    parts.push(`mode=${data.fileMode}`);
  }

  return `${TAG_PREFIX}${parts.join(' ')}${TAG_SUFFIX}`;
}

// =============================================================================
// Writing
// =============================================================================

/**
 * Write or update a sync tag in a comment string.
 *
 * If the comment already has a `[podkit:...]` block, replaces it.
 * Otherwise appends the tag. Preserves other comment content.
 *
 * @param existingComment - Current comment field (may be null/undefined)
 * @param data - Sync tag data to write
 * @returns Updated comment string with sync tag
 */
export function writeSyncTag(
  existingComment: string | null | undefined,
  data: SyncTagData
): string {
  const tag = formatSyncTag(data);

  if (!existingComment) {
    return tag;
  }

  // Replace existing tag (any version) or append
  if (TAG_REGEX.test(existingComment)) {
    return existingComment.replace(TAG_REGEX, tag);
  }

  // Append with space separator
  return `${existingComment} ${tag}`;
}

// =============================================================================
// Comparison
// =============================================================================

/**
 * Compare a parsed sync tag against expected config.
 *
 * Returns true if the tag matches the config exactly (quality, encoding,
 * and bitrate all match). A missing optional field matches undefined.
 *
 * @param tag - Parsed sync tag from iPod track
 * @param config - Expected sync tag data from current config
 * @returns True if tag matches the config
 */
export function syncTagMatchesConfig(tag: SyncTagData, config: SyncTagData): boolean {
  if (tag.quality !== config.quality) {
    return false;
  }

  // Compare encoding: normalize undefined to 'vbr' (the default)
  const tagEncoding = tag.encoding ?? 'vbr';
  const configEncoding = config.encoding ?? 'vbr';
  if (tagEncoding !== configEncoding) {
    return false;
  }

  // Compare bitrate: both undefined = match, one undefined = mismatch
  if (tag.bitrate !== config.bitrate) {
    return false;
  }

  return true;
}

// =============================================================================
// Builders
// =============================================================================

/**
 * Build the SyncTagData for an audio transcode operation.
 *
 * Takes the RESOLVED preset (not 'max' — that resolves to 'lossless' or 'high'
 * before calling this), encoding mode, and optional custom bitrate.
 *
 * @param resolvedPreset - Resolved quality: 'lossless' | 'high' | 'medium' | 'low'
 * @param encodingMode - 'vbr' | 'cbr' — omitted for lossless
 * @param customBitrate - Only included when customBitrate was explicitly set
 * @returns SyncTagData for the audio transcode
 */
export function buildAudioSyncTag(
  resolvedPreset: string,
  encodingMode?: string,
  customBitrate?: number,
  fileMode?: string
): SyncTagData {
  const data: SyncTagData = {
    quality: resolvedPreset,
  };

  // Lossless has no encoding mode or bitrate
  if (resolvedPreset !== 'lossless') {
    data.encoding = encodingMode ?? 'vbr';
    if (customBitrate !== undefined) {
      data.bitrate = customBitrate;
    }
  }

  if (fileMode) {
    data.fileMode = fileMode;
  }

  return data;
}

/**
 * Build the SyncTagData for a video transcode operation.
 *
 * Video tags only include quality — no encoding mode or bitrate.
 * The 'max' quality is stored as-is for video (unlike audio where
 * it resolves to 'lossless' or 'high').
 *
 * @param quality - Video quality preset: 'max' | 'high' | 'medium' | 'low'
 * @returns SyncTagData for the video transcode
 */
export function buildVideoSyncTag(quality: string): SyncTagData {
  return {
    quality,
  };
}

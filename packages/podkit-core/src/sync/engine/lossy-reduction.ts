/**
 * Lossy reduction — the down-only, transfer-mode-defaulted bitrate axis.
 *
 * Two pure deep modules shared by the add path, the re-sync (device-bound)
 * path, and the adoption path, so a lossy track is never decided one way on add
 * and a different way on re-sync. They own the entire ADR-023 target-bitrate
 * table: down-only reduction, the quality preset as a hard ceiling, the
 * source-proximity percentage tolerance, and the single sanctioned use of the
 * codec-efficiency table (the preserve + forced-cross-codec row).
 *
 * Lossless sources never enter {@link resolveLossyReduction}: a lossless source
 * is transcoded to the quality preset (the lossless→lossy boundary), which is a
 * different decision owned by the classifier's lossless stack.
 *
 * @see ADR-023 (Lossy Reduction Is a Down-Only, Transfer-Mode-Defaulted Axis)
 * @see documents/principles/transcoding.md
 * @module
 */

import type { TransferMode } from '../../transcode/types.js';
import type { TranscodeTargetCodec } from '../../transcode/codecs.js';

// =============================================================================
// Reduction axis
// =============================================================================

/**
 * The user-overridable lossy-reduction setting (`[bitrate].reduce`).
 *
 * - `always` → always {@link ReductionAxis convert} (reduce over-cap lossy).
 * - `never` → always {@link ReductionAxis preserve} (copy device-native lossy
 *   untouched).
 * - `auto` (default) → follow the transfer mode's lean.
 */
export type ReductionMode = 'auto' | 'always' | 'never';

/**
 * The resolved reduction behaviour for a device-native lossy source.
 *
 * - `convert` — reduce an over-cap source down to the cap.
 * - `preserve` — copy it untouched (original codec + bitrate).
 *
 * The cap still bounds a `preserve` *forced* transcode (an incompatible codec
 * the device cannot play) — preserve never overrides the ceiling.
 */
export type ReductionAxis = 'convert' | 'preserve';

/**
 * Resolve the reduction axis from the user's `[bitrate].reduce` setting and the
 * transfer mode.
 *
 * `always`/`never` are explicit overrides. `auto` follows the transfer mode's
 * natural lean: `optimized` (cut the file down) converts; `fast` (do the
 * fastest thing) and `portable` (keep fidelity) preserve.
 */
export function resolveReductionAxis(
  reduce: ReductionMode,
  transferMode: TransferMode
): ReductionAxis {
  if (reduce === 'always') return 'convert';
  if (reduce === 'never') return 'preserve';
  return transferMode === 'optimized' ? 'convert' : 'preserve';
}

// =============================================================================
// Codec efficiency
// =============================================================================

/**
 * Codec efficiency relative to AAC for equal perceived quality (kbps ratio).
 *
 * A more efficient codec (`opus`) needs fewer kbps than AAC for the same
 * quality; a less efficient one (`mp3`) needs more. Used in exactly one place —
 * the preserve + forced-cross-codec target in {@link resolveLossyReduction} —
 * where the goal is to match the source's *quality* in a codec podkit is forced
 * to switch to. Every other decision is about file size (raw kbps), so it
 * deliberately does not consult this table.
 *
 * Kept behind the {@link resolveLossyReduction} seam so a future per-device or
 * per-user override is a non-breaking addition. Keys are lower-cased source or
 * target codec names; lossless codecs never appear because lossless sources
 * never enter the seam, and lossless targets are never a lossy-reduction target.
 *
 * @see ADR-023 §5
 */
const CODEC_EFFICIENCY: Readonly<Record<string, number>> = {
  aac: 1.0,
  opus: 0.75,
  vorbis: 0.9,
  mp3: 1.3,
};

/**
 * The efficiency factor for a codec, defaulting to AAC-equivalent (`1.0`) for
 * any codec absent from the table (a defensive fallback — an unknown source
 * codec is treated as needing the same kbps as AAC rather than throwing).
 */
function codecEfficiency(codec: string): number {
  return CODEC_EFFICIENCY[codec.toLowerCase()] ?? 1.0;
}

// =============================================================================
// Lossy reduction decision
// =============================================================================

/**
 * Input to {@link resolveLossyReduction}.
 *
 * All bitrates are in kbps. The source must be **lossy** with a known, positive
 * bitrate — lossless and unknown-bitrate sources are filtered out by the caller.
 */
export interface LossyReductionInput {
  /**
   * Source codec name (e.g. `'mp3'`, `'aac'`, `'opus'`, `'vorbis'`). Consulted
   * only by the preserve-necessity efficiency math; an unknown codec is treated
   * as AAC-equivalent.
   */
  readonly sourceCodec: string;
  /** Source bitrate in kbps (must be > 0). */
  readonly sourceBitrate: number;
  /**
   * Whether the device plays the source codec natively (the copy path). When
   * false the source is an incompatible codec and a transcode is a necessity.
   */
  readonly deviceNative: boolean;
  /** Resolved transcode target codec for a convert / forced re-encode. */
  readonly targetCodec: TranscodeTargetCodec;
  /** Quality-preset bitrate (kbps) — a hard ceiling on every transcode target. */
  readonly cap: number;
  /** Resolved reduction axis (`convert` or `preserve`). */
  readonly axis: ReductionAxis;
  /**
   * Optional device maximum audio bitrate (kbps) — a hard device constraint.
   * Absent → unbounded. When present it is the tighter ceiling alongside the
   * quality cap on every transcode target, and it forces a reduction of a source
   * above it even under `preserve` (the device cannot hold it as-is).
   */
  readonly deviceMax?: number;
  /**
   * Source-proximity tolerance as a fraction of the cap (e.g. `0.25`). Reduce a
   * device-native+convert source only when `source > cap × (1 + tolerance)`.
   */
  readonly tolerance: number;
}

/**
 * The decision: copy the source as-is, or transcode it to `bitrate` kbps.
 */
export type LossyReductionResult = { action: 'copy' } | { action: 'transcode'; bitrate: number };

/**
 * Resolve the target for a lossy source against the ADR-023 table.
 *
 * `cap*` below is the **effective cap** — `min(cap, deviceMax)` when the device
 * declares a `maxAudioBitrate`, else the quality cap. A device-native source
 * above `deviceMax` is reduced even under `preserve` (a device constraint).
 *
 * | Case | Target |
 * |---|---|
 * | device-native + preserve | copy (original codec + bitrate); or reduce to `cap*` if `source > deviceMax` |
 * | device-native + convert | reduce iff `source > cap* × (1+tol)` (or `source > deviceMax`) → `cap*`; else copy |
 * | incompatible (necessity) + preserve | `min(round(source × eff[T] / eff[S]), cap*)` |
 * | incompatible (necessity) + convert | `min(source, cap*)` |
 *
 * Every transcode target is bounded by the effective cap (the hard ceiling). The
 * device-native and convert rows are also bounded by the source (down-only);
 * the preserve-necessity row may target above the source bitrate in the less
 * efficient target codec — that is intentional, it preserves the source's
 * *quality* in a forced cross-codec transcode rather than under-encoding it, and
 * it is still capped by the ceiling.
 *
 * @throws if `sourceBitrate` is not a positive number (the caller must filter
 *   lossless and unknown-bitrate sources before calling).
 */
export function resolveLossyReduction(input: LossyReductionInput): LossyReductionResult {
  const { sourceCodec, sourceBitrate, deviceNative, targetCodec, cap, axis, deviceMax, tolerance } =
    input;

  if (!(sourceBitrate > 0)) {
    throw new Error(
      `resolveLossyReduction requires a positive source bitrate (got ${sourceBitrate}); lossless and unknown-bitrate sources must be filtered out by the caller`
    );
  }

  // The effective ceiling on any transcode target is the tighter of the user's
  // quality cap (a preference) and the device's maximum audio bitrate (a hard
  // constraint). A device that declares `maxAudioBitrate` cannot store or play
  // above it, so — unlike the reduction axis, which is a preference — it is
  // enforced regardless of `preserve`/`convert`.
  const effectiveCap = deviceMax !== undefined ? Math.min(cap, deviceMax) : cap;
  // A device-native source above the device's hard max must be reduced even
  // under `preserve` (the device cannot hold it as-is).
  const overDeviceMax = deviceMax !== undefined && sourceBitrate > deviceMax;

  if (deviceNative) {
    // The device plays the source codec as-is. Preserve keeps it untouched;
    // convert reduces when the source meaningfully exceeds the effective cap. In
    // both, a source above the device's hard max is reduced regardless.
    if (axis === 'preserve') {
      return overDeviceMax ? { action: 'transcode', bitrate: effectiveCap } : { action: 'copy' };
    }
    if (overDeviceMax || sourceBitrate > effectiveCap * (1 + tolerance)) {
      return { action: 'transcode', bitrate: effectiveCap };
    }
    return { action: 'copy' };
  }

  // Necessity: the device cannot play the source codec, so a transcode is
  // unavoidable. Convert targets the smaller of source and the effective cap
  // (file size); preserve matches the source's quality in the target codec
  // (efficiency), still bounded by the effective cap.
  if (axis === 'convert') {
    return { action: 'transcode', bitrate: Math.min(sourceBitrate, effectiveCap) };
  }

  const qualityMatched = Math.round(
    (sourceBitrate * codecEfficiency(targetCodec)) / codecEfficiency(sourceCodec)
  );
  return { action: 'transcode', bitrate: Math.min(qualityMatched, effectiveCap) };
}

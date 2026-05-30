/**
 * Sync-time decision provenance.
 *
 * Captures which sync-wide settings podkit resolved and *where each value
 * came from* — CLI flag, device config, global config, default. Surfaced in
 * the `--json` sync output so consumers (matrix tests, tooling) can assert
 * decisions, not just outcomes.
 *
 * The mechanism is intentionally minimal: a `{ value, source }` pair per
 * setting. Forward-compatible with a future `podkit sync --explain` mode
 * (richer decision trace) and the per-operation `inputCodec`/`outputCodec`
 * fields layered onto `operations[]`. See doc-040 for the PRD.
 *
 * @module
 */
import type { ConfigSource, ResolvedDeviceSettings } from '../config/resolve.js';

/**
 * Provenance for a resolved sync decision. Extends {@link ConfigSource} with
 * `'cli'` to capture command-line flag overrides; the resolver itself never
 * emits `'cli'` (it only knows about config + defaults), so this superset is
 * applied at the CLI-overlay layer in `sync.ts`.
 */
export type DecisionSource = ConfigSource | 'cli';

/**
 * A resolved sync-wide setting with provenance. Mirrors {@link ResolvedValue}
 * structurally; kept as a separate type so the JSON-facing layer is decoupled
 * from the internal config-resolver shape (the JSON contract is more stable
 * than the internal one).
 */
export interface ResolvedDecision<T> {
  value: T;
  source: DecisionSource;
}

/**
 * The full set of sync-wide decisions exposed in the `--json` output.
 * Per-track decisions (input/output codec) ride on `operations[]` instead.
 */
export interface SyncDecisions {
  transferMode: ResolvedDecision<string>;
  quality: ResolvedDecision<string>;
  /** Resolved single lossy codec name (e.g. 'aac', 'mp3'). */
  lossyCodec: ResolvedDecision<string | undefined>;
  /** Resolved single lossless codec name (e.g. 'flac', 'alac'), or null when lossless preference is 'source'. */
  losslessCodec: ResolvedDecision<string | null | undefined>;
  /** Full lossy preference stack (for assertions about ordering/inheritance). */
  lossyPreference: ResolvedDecision<readonly string[]>;
  /** Full lossless preference stack. */
  losslessPreference: ResolvedDecision<readonly string[]>;
  checkArtwork: ResolvedDecision<boolean>;
}

/**
 * CLI-flag overrides used at decision construction time. Each field that is
 * `undefined` means "no CLI override; use the resolved-config source". A
 * present field forces `source: 'cli'`.
 */
export interface DecisionCliOverrides {
  transferMode?: string;
  quality?: string;
  audioQuality?: string;
  lossyCodec?: string;
  losslessCodec?: string;
  lossyPreference?: readonly string[];
  losslessPreference?: readonly string[];
  checkArtwork?: boolean;
}

/**
 * Resolved values from the config layer that the decisions block surfaces.
 * Mirrors the slice of {@link ResolvedDeviceSettings} the JSON consumer needs.
 */
export interface ResolvedConfigForDecisions {
  transferMode: { value: string; source: ConfigSource };
  audio: { value: string; source: ConfigSource };
  checkArtwork: { value: boolean; source: ConfigSource };
}

/**
 * Build a {@link SyncDecisions} from resolved config + CLI overrides + codec
 * resolution outputs. Pure function — no side effects, no I/O — designed for
 * unit testing in isolation.
 *
 * The `lossyCodec`/`losslessCodec` provenance is approximate: when a CLI
 * codec flag isn't currently supported (podkit doesn't yet take `--codec`),
 * the resolver isn't asked, and the source defaults to `'config'` or
 * `'default'` based on whether the preference stack came from the resolved
 * config object. Adjust the source mapping when CLI codec flags land.
 */
export function buildSyncDecisions(input: {
  resolved: ResolvedConfigForDecisions;
  overrides: DecisionCliOverrides;
  resolvedLossyCodec: string | undefined;
  resolvedLosslessCodec: string | null | undefined;
  lossyPreference: readonly string[];
  losslessPreference: readonly string[];
  /** Whether the codec preference came from a config file (vs hardcoded defaults). */
  codecPreferenceFromConfig: boolean;
}): SyncDecisions {
  const codecSource: ConfigSource = input.codecPreferenceFromConfig ? 'global' : 'default';

  return {
    transferMode:
      input.overrides.transferMode !== undefined
        ? { value: input.overrides.transferMode, source: 'cli' }
        : { value: input.resolved.transferMode.value, source: input.resolved.transferMode.source },
    quality:
      input.overrides.audioQuality !== undefined
        ? { value: input.overrides.audioQuality, source: 'cli' }
        : input.overrides.quality !== undefined
          ? { value: input.overrides.quality, source: 'cli' }
          : { value: input.resolved.audio.value, source: input.resolved.audio.source },
    lossyCodec:
      input.overrides.lossyCodec !== undefined
        ? { value: input.overrides.lossyCodec, source: 'cli' }
        : { value: input.resolvedLossyCodec, source: codecSource },
    losslessCodec:
      input.overrides.losslessCodec !== undefined
        ? { value: input.overrides.losslessCodec, source: 'cli' }
        : { value: input.resolvedLosslessCodec ?? null, source: codecSource },
    lossyPreference:
      input.overrides.lossyPreference !== undefined
        ? { value: input.overrides.lossyPreference, source: 'cli' }
        : { value: input.lossyPreference, source: codecSource },
    losslessPreference:
      input.overrides.losslessPreference !== undefined
        ? { value: input.overrides.losslessPreference, source: 'cli' }
        : { value: input.losslessPreference, source: codecSource },
    checkArtwork:
      input.overrides.checkArtwork !== undefined
        ? { value: input.overrides.checkArtwork, source: 'cli' }
        : { value: input.resolved.checkArtwork.value, source: input.resolved.checkArtwork.source },
  };
}

/** Type re-export so callers don't have to reach into ../config/resolve.js. */
export type { ResolvedDeviceSettings };

/**
 * The slice of a music sync operation this module needs to derive
 * per-op `inputCodec` / `outputCodec`. A structural duck-type so the
 * module doesn't depend on `@podkit/core`'s op union.
 */
export interface CodecDerivableOp {
  type: string;
  source?: { fileType?: string } | null;
}

/**
 * Derive `inputCodec` and `outputCodec` for a single planning op, given the
 * sync-wide resolved codecs. Returns `undefined` for fields that don't apply
 * (e.g. `outputCodec` for `remove`/`update-metadata`/`update-sync-tag`/
 * `relocate`, `inputCodec` for ops with no source track).
 *
 * The mapping is straightforward:
 * - `add-transcode` / `upgrade-transcode` → output is the resolved lossy codec.
 * - `add-direct-copy` / `add-optimized-copy` / `upgrade-direct-copy` /
 *   `upgrade-optimized-copy` → output equals input (codec unchanged; only the
 *   wrapper or artwork may differ).
 * - `upgrade-artwork` → no codec change; input set, output undefined.
 * - `remove` / `update-metadata` / `update-sync-tag` / `relocate` → no codecs.
 */
export function codecsForOp(
  op: CodecDerivableOp,
  resolvedLossyCodec: string | undefined
): { inputCodec?: string; outputCodec?: string } {
  const inputCodec = op.source?.fileType;
  switch (op.type) {
    case 'add-transcode':
    case 'upgrade-transcode':
      return { inputCodec, outputCodec: resolvedLossyCodec };
    case 'add-direct-copy':
    case 'add-optimized-copy':
    case 'upgrade-direct-copy':
    case 'upgrade-optimized-copy':
      return { inputCodec, outputCodec: inputCodec };
    case 'upgrade-artwork':
      // Artwork-only upgrade: the codec doesn't change and no transcode runs.
      // Omit both fields so the JSON entry doesn't suggest a half-described
      // codec decision (parallel to `update-metadata` and `relocate`).
      return { inputCodec: undefined, outputCodec: undefined };
    default:
      return { inputCodec: undefined, outputCodec: undefined };
  }
}

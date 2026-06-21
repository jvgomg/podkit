/**
 * `device add` request resolver (M3).
 *
 * Pure, synchronous, no-I/O translation of the raw `device add` CLI options
 * into a validated {@link AddRequest}. This is the static-argument layer of
 * the add flow: it owns name/type/quality/encoding validation, the
 * verification-tier derivation, the device-target derivation, and the
 * config-inject completeness check — everything that can be decided from the
 * arguments alone, before any device is touched.
 *
 * What this module deliberately does NOT do:
 *   - No `fs` / `process` / disk access. Path existence + `statSync` checks
 *     are device I/O the orchestrator performs after this resolves.
 *   - No registry or config imports. The merged preset registry is reduced to
 *     two injected primitives (`knownDeviceTypeIds`, `isMassStorageType`) so
 *     this file stays a pure function of its inputs.
 *
 * It throws `CliError` ONLY for static argument errors. Everything dynamic —
 * "is this device actually an HFS+ iPod on Linux", "does the path exist",
 * "does the connected device match the declared type" — belongs downstream.
 *
 * @module
 */

import { CliError } from '../../errors.js';
import { QUALITY_PRESETS, VIDEO_QUALITY_PRESETS, ENCODING_MODES } from '../../config/index.js';
import type { QualityPreset, VideoQualityPreset, EncodingMode } from '../../config/index.js';
import type { DeviceArtworkSource, AudioCodec } from '@podkit/core';
import { DeviceErrorCodes } from './error-codes.js';

// =============================================================================
// Output types
// =============================================================================

/**
 * How hard `device add` checks the device against reality before persisting.
 *
 * Ordered, weakest-checks-last:
 *   - `verify` (default): live SCSI cross-check + SysInfo required.
 *   - `trust-disk` (`--no-verify`): no live cross-check, on-disk SysInfo
 *     required + ready.
 *   - `config-inject` (`--no-validate`): no device read at all; pure config
 *     write from complete args.
 *
 * `config-inject` sits *below* `trust-disk`, so `--no-validate ⇒ --no-verify`
 * is structural: once the tier is `config-inject`, nothing downstream
 * re-checks `noVerify`. The implication is encoded by tier derivation, not by
 * a second flag.
 */
export type VerificationTier = 'verify' | 'trust-disk' | 'config-inject';

/**
 * Did the user assert a device type?
 *
 * Replaces the rejected S1/S2 enum. It answers exactly one question —
 * "validate-the-claim vs scan-and-suggest" — and nothing about how to reach
 * the device (that is {@link DeviceTarget}).
 */
export type DeviceClaim =
  | { readonly mode: 'declared'; readonly deviceType: string }
  | { readonly mode: 'undeclared' };

/** How the device will be reached. Orthogonal to {@link DeviceClaim}. */
export type DeviceTarget =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'uuid'; readonly volumeUuid: string }
  | { readonly kind: 'scan' };

/**
 * Mass-storage-specific config patch — the subset of options that only apply
 * to mass-storage devices. Nested under {@link DeviceConfigPatch} so the
 * iPod flows never see these keys.
 */
export interface MassStoragePatch {
  artworkMaxResolution?: number;
  artworkSources?: DeviceArtworkSource[];
  supportedAudioCodecs?: AudioCodec[];
  supportsVideo?: boolean;
  musicDir?: string;
  moviesDir?: string;
  tvShowsDir?: string;
}

/**
 * Validated device config patch. Carries the quality/encoding/artwork fields
 * that apply to every device kind, plus a nested mass-storage patch for the
 * kind-specific options. Only keys the user actually passed are present.
 */
export interface DeviceConfigPatch {
  quality?: QualityPreset;
  audioQuality?: QualityPreset;
  videoQuality?: VideoQualityPreset;
  encoding?: EncodingMode;
  artwork?: boolean;
  massStorage: MassStoragePatch;
}

/**
 * Validated identity for the `config-inject` tier. Assembled only when the
 * tier is `config-inject`; completeness (a uuid-or-path AND a deviceType) is
 * enforced at resolve time, so the orchestrator can write the config row
 * straight from this without re-checking.
 */
export interface InjectedIdentity {
  volumeUuid?: string;
  path?: string;
  volumeName?: string;
  deviceType: string;
}

/**
 * Fully-resolved `device add` request. The product of M3 — everything the
 * orchestrator needs that can be decided from arguments alone.
 */
export interface AddRequest {
  readonly name: string;
  readonly tier: VerificationTier;
  readonly claim: DeviceClaim;
  readonly target: DeviceTarget;
  readonly config: DeviceConfigPatch;
  readonly autoConfirm: boolean;
  readonly force: boolean;
  /** Present only for the `config-inject` tier. */
  readonly injectedIdentity?: InjectedIdentity;
}

// =============================================================================
// Input types
// =============================================================================

/**
 * Raw `device add` options, already name-resolved by the caller. Mirrors the
 * Commander-parsed option bag — `firmwareInquiry` / `validate` are Commander
 * `--no-X` booleans (`false` when the user passed `--no-verify` /
 * `--no-validate`).
 */
export interface RawAddOptions {
  name: string;
  type?: string;
  path?: string;
  volumeUuid?: string;
  volumeName?: string;
  yes?: boolean;
  /** `false` when `--no-verify` was passed. */
  verify?: boolean;
  /** `false` when `--no-validate` was passed. */
  validate?: boolean;
  force?: boolean;
  quality?: string;
  audioQuality?: string;
  videoQuality?: string;
  encoding?: string;
  artwork?: boolean;
  artworkMaxResolution?: string;
  artworkSources?: string[];
  supportedAudioCodecs?: string[];
  supportsVideo?: boolean;
  musicDir?: string;
  moviesDir?: string;
  tvShowsDir?: string;
}

/**
 * Injected dependencies. The registry + classifier are passed in so this
 * module imports no registry/config-loading code. `validateCapabilityOverrides`
 * is injected so the mass-storage validation rules stay sourced from
 * `@podkit/devices-mass-storage` without a static import here.
 */
export interface ResolveAddRequestContext {
  /** The program-level `-d <name>` value, if any (for the existing-name set is unrelated; kept for symmetry). */
  globalDevice?: string;
  /** Names already present in config — duplicate rejection. */
  existingDeviceNames: ReadonlySet<string> | readonly string[];
  /** All `--type` ids accepted (`'ipod'` ∪ mass-storage preset ids). */
  knownDeviceTypeIds: readonly string[];
  /** Classifier: is this type a mass-storage preset (vs `'ipod'`)? */
  isMassStorageType: (type: string) => boolean;
  /**
   * Validate a mass-storage capability-override patch. Injected so M3 imports
   * no `@podkit/devices-mass-storage` code. Returns the first error message +
   * code when invalid.
   */
  validateCapabilityOverrides?: (patch: MassStoragePatch) => {
    ok: boolean;
    firstError?: { message: string; code: keyof typeof DeviceErrorCodes };
  };
}

// =============================================================================
// Internal helpers
// =============================================================================

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function hasName(set: ResolveAddRequestContext['existingDeviceNames'], name: string): boolean {
  return Array.isArray(set) ? set.includes(name) : (set as ReadonlySet<string>).has(name);
}

/** Mass-storage-only option flags, paired with their CLI flag label. */
function massStorageOnlyFlagsPresent(raw: RawAddOptions): string[] {
  return [
    raw.artworkMaxResolution !== undefined && '--artwork-max-resolution',
    raw.artworkSources !== undefined && '--artwork-sources',
    raw.supportedAudioCodecs !== undefined && '--supported-audio-codecs',
    raw.supportsVideo !== undefined && '--supports-video',
    raw.musicDir !== undefined && '--music-dir',
    raw.moviesDir !== undefined && '--movies-dir',
    raw.tvShowsDir !== undefined && '--tv-shows-dir',
  ].filter(Boolean) as string[];
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Resolve raw `device add` options into a validated {@link AddRequest}.
 *
 * Pure + synchronous. Throws `CliError` only for static argument errors:
 * bad name, duplicate name, unknown `--type`, bad quality/encoding preset,
 * mass-storage-only options on a non-mass-storage type, mass-storage capability
 * override validation, and config-inject completeness failures.
 */
export function resolveAddRequest(raw: RawAddOptions, ctx: ResolveAddRequestContext): AddRequest {
  const name = raw.name;

  // --- Name -----------------------------------------------------------------
  if (!NAME_RE.test(name)) {
    throw new CliError({
      message:
        'Invalid device name. Must start with a letter and contain only letters, numbers, hyphens, and underscores.',
      code: DeviceErrorCodes.INVALID_DEVICE_NAME,
    });
  }
  if (hasName(ctx.existingDeviceNames, name)) {
    throw new CliError({
      message: `Device "${name}" already exists in config. Use a different name or remove it first.`,
      code: DeviceErrorCodes.DEVICE_EXISTS,
    });
  }

  // --- Quality / encoding ---------------------------------------------------
  if (raw.quality !== undefined && !QUALITY_PRESETS.includes(raw.quality as QualityPreset)) {
    throw new CliError({
      message: `Invalid quality preset "${raw.quality}". Valid values: ${QUALITY_PRESETS.join(', ')}`,
      code: DeviceErrorCodes.INVALID_QUALITY,
    });
  }
  if (
    raw.audioQuality !== undefined &&
    !QUALITY_PRESETS.includes(raw.audioQuality as QualityPreset)
  ) {
    throw new CliError({
      message: `Invalid audio quality preset "${raw.audioQuality}". Valid values: ${QUALITY_PRESETS.join(', ')}`,
      code: DeviceErrorCodes.INVALID_AUDIO_QUALITY,
    });
  }
  if (
    raw.videoQuality !== undefined &&
    !VIDEO_QUALITY_PRESETS.includes(raw.videoQuality as VideoQualityPreset)
  ) {
    throw new CliError({
      message: `Invalid video quality preset "${raw.videoQuality}". Valid values: ${VIDEO_QUALITY_PRESETS.join(', ')}`,
      code: DeviceErrorCodes.INVALID_VIDEO_QUALITY,
    });
  }
  if (raw.encoding !== undefined && !ENCODING_MODES.includes(raw.encoding as EncodingMode)) {
    throw new CliError({
      message: `Invalid encoding mode "${raw.encoding}". Valid values: ${ENCODING_MODES.join(', ')}`,
      code: DeviceErrorCodes.INVALID_ENCODING,
    });
  }

  // --- Type → claim ---------------------------------------------------------
  let claim: DeviceClaim = { mode: 'undeclared' };
  const deviceType = raw.type;
  if (deviceType !== undefined) {
    if (!ctx.knownDeviceTypeIds.includes(deviceType)) {
      throw new CliError({
        message: `Unknown device type "${deviceType}". Known types: ${ctx.knownDeviceTypeIds.join(', ')}.`,
        code: DeviceErrorCodes.INVALID_TYPE,
      });
    }
    claim = { mode: 'declared', deviceType };
  }

  const isDeclaredMassStorage =
    claim.mode === 'declared' && ctx.isMassStorageType(claim.deviceType);

  // --- Mass-storage-only options gate ---------------------------------------
  // These are valid ONLY when the user declared a mass-storage type. On an
  // iPod (declared or undeclared) they are rejected.
  if (!isDeclaredMassStorage) {
    const offending = massStorageOnlyFlagsPresent(raw);
    if (offending.length > 0) {
      throw new CliError({
        message: `${offending.join(', ')} ${offending.length === 1 ? 'is' : 'are'} only valid for mass-storage devices (--type echo-mini|rockbox|generic).`,
        code: DeviceErrorCodes.INVALID_OPTION_FOR_TYPE,
      });
    }
  }

  // --- Mass-storage patch + validation --------------------------------------
  const massStorage: MassStoragePatch = {};
  if (isDeclaredMassStorage) {
    if (raw.artworkMaxResolution !== undefined) {
      massStorage.artworkMaxResolution = parseInt(raw.artworkMaxResolution, 10);
    }
    if (raw.artworkSources !== undefined) {
      massStorage.artworkSources = raw.artworkSources as DeviceArtworkSource[];
    }
    if (raw.supportedAudioCodecs !== undefined) {
      massStorage.supportedAudioCodecs = raw.supportedAudioCodecs as AudioCodec[];
    }
    if (raw.supportsVideo !== undefined) massStorage.supportsVideo = raw.supportsVideo;
    if (raw.musicDir !== undefined) massStorage.musicDir = raw.musicDir;
    if (raw.moviesDir !== undefined) massStorage.moviesDir = raw.moviesDir;
    if (raw.tvShowsDir !== undefined) massStorage.tvShowsDir = raw.tvShowsDir;

    if (ctx.validateCapabilityOverrides) {
      const result = ctx.validateCapabilityOverrides(massStorage);
      if (!result.ok && result.firstError) {
        throw new CliError({
          message: result.firstError.message,
          code: DeviceErrorCodes[result.firstError.code],
        });
      }
    }
  }

  const config: DeviceConfigPatch = { massStorage };
  if (raw.quality !== undefined) config.quality = raw.quality as QualityPreset;
  if (raw.audioQuality !== undefined) config.audioQuality = raw.audioQuality as QualityPreset;
  if (raw.videoQuality !== undefined) config.videoQuality = raw.videoQuality as VideoQualityPreset;
  if (raw.encoding !== undefined) config.encoding = raw.encoding as EncodingMode;
  if (raw.artwork !== undefined) config.artwork = raw.artwork;

  // --- Tier derivation ------------------------------------------------------
  // `--no-validate` (validate === false) wins → config-inject. This is the
  // structural `--no-validate ⇒ --no-verify`: the verify level is never
  // consulted once we're at config-inject.
  let tier: VerificationTier;
  if (raw.validate === false) {
    tier = 'config-inject';
  } else if (raw.verify === false) {
    tier = 'trust-disk';
  } else {
    tier = 'verify';
  }

  // --- Target derivation ----------------------------------------------------
  // A non-empty path wins over a uuid; an empty-string uuid is treated as "no
  // uuid" (degrades to scan) so the orchestrator never issues a meaningless
  // `locate({ volumeUuid: '' })`.
  let target: DeviceTarget;
  if (raw.path !== undefined && raw.path.length > 0) {
    target = { kind: 'path', path: raw.path };
  } else if (raw.volumeUuid !== undefined && raw.volumeUuid.length > 0) {
    target = { kind: 'uuid', volumeUuid: raw.volumeUuid };
  } else {
    target = { kind: 'scan' };
  }

  // --- Mass-storage requires --path -----------------------------------------
  // Path existence/stat is the orchestrator's job; the *requirement* of a path
  // for mass-storage is a static argument rule.
  if (isDeclaredMassStorage && target.kind !== 'path') {
    throw new CliError({
      message: `--path is required for ${(claim as { deviceType: string }).deviceType} devices. Usage: podkit device add -d <name> --type ${(claim as { deviceType: string }).deviceType} --path <mount-point>`,
      code: DeviceErrorCodes.PATH_REQUIRED,
    });
  }

  // --- Config-inject completeness -------------------------------------------
  let injectedIdentity: InjectedIdentity | undefined;
  if (tier === 'config-inject') {
    const missing: string[] = [];
    const hasUuid = raw.volumeUuid !== undefined && raw.volumeUuid.length > 0;
    const hasPath = raw.path !== undefined && raw.path.length > 0;
    if (!hasUuid && !hasPath) missing.push('--volume-uuid or --path');
    if (claim.mode !== 'declared') missing.push('--type');

    if (missing.length > 0) {
      throw new CliError({
        message:
          `--no-validate requires a complete device identity. Missing: ${missing.join(', ')}. ` +
          'Provide a uuid (or path) plus --type so the config row is usable.',
        code: DeviceErrorCodes.EMPTY_IDENTITY,
        details: { missing },
      });
    }

    injectedIdentity = {
      deviceType: (claim as { deviceType: string }).deviceType,
      ...(hasUuid ? { volumeUuid: raw.volumeUuid } : {}),
      ...(hasPath ? { path: raw.path } : {}),
      ...(raw.volumeName !== undefined ? { volumeName: raw.volumeName } : {}),
    };
  }

  return {
    name,
    tier,
    claim,
    target,
    config,
    autoConfirm: raw.yes ?? false,
    force: raw.force ?? false,
    ...(injectedIdentity ? { injectedIdentity } : {}),
  };
}

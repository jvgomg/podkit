/**
 * Unified capability resolver for all device identity kinds.
 *
 * `resolveCapabilities(identity, opts?)` is the single entry point used by
 * the sync engine, planner, transcoder, and CLI display for capability
 * resolution. It dispatches by `identity.kind`:
 *
 * - `'ipod'`          → `@podkit/devices-ipod` `getCapabilities`
 * - `'mass-storage'`  → `@podkit/devices-mass-storage` `getCapabilities`
 *
 * The iPod path bridges `IpodIdentity` → `IpodModel` via serial-suffix lookup
 * (primary, exact) and FamilyID table lookup (fallback). When neither yields
 * an `IpodModel`, a synthetic minimal model is built from the generation table
 * so that capability resolution always succeeds for any plausible identity.
 *
 * `identifyCapabilities(model, opts?)` is provided for call sites that
 * already have an `IpodModel` (e.g. callers that came through `identify()`).
 * It calls `devices-ipod.getCapabilities` internally, keeping that call inside
 * this module as required by AC#7.
 *
 * ## Migration note
 *
 * Call sites that previously used `createIpodCapabilities(libgpodDeviceInfo)`,
 * `resolveDeviceCapabilities(type, overrides)`, or `getDevicePreset(type)` for
 * capability queries are migrated to this module. The legacy functions remain
 * as shims until TASK-295.05 (P4) deletes them.
 *
 * @module
 */

import type {
  DeviceIdentity,
  IpodIdentity,
  DeviceCapabilities,
  FirmwareCapabilities,
} from '@podkit/device-types';

import {
  getCapabilities as getIpodCapabilities,
  identify,
  GENERATIONS,
  lookupByFamilyId,
} from '@podkit/devices-ipod';
import type { IpodModel } from '@podkit/devices-ipod';

import {
  getCapabilities as getMassStorageCapabilities,
  BUILT_IN_PRESETS,
} from '@podkit/devices-mass-storage';
import type { MassStoragePreset } from '@podkit/devices-mass-storage';

// =============================================================================
// Types
// =============================================================================

export interface ResolveCapabilitiesOptions {
  /**
   * Optional firmware overlay for iPod devices — enriches the table-derived
   * defaults with codec and artwork format details the firmware advertises.
   */
  firmware?: FirmwareCapabilities;
  /**
   * Mass-storage preset map (built-in + user-registered).
   *
   * Defaults to `BUILT_IN_PRESETS` when omitted, so callers only need to
   * supply this when they have user-registered presets to add.
   */
  presets?: Record<string, MassStoragePreset>;
  /**
   * Per-call capability overrides applied last (after preset resolution).
   *
   * Useful for per-device config overrides in TOML — e.g. an Echo Mini with
   * a smaller artwork limit than the preset default.
   */
  overrides?: Partial<DeviceCapabilities>;
}

// =============================================================================
// IpodIdentity → IpodModel bridge
// =============================================================================

/**
 * Bridge an `IpodIdentity` to an `IpodModel` for capability resolution.
 *
 * Resolution chain (first match wins):
 * 1. Serial-suffix lookup — uses last 3 chars of `identity.serialNumber`.
 *    Most reliable for post-2006 devices with populated serial tables.
 * 2. FamilyID lookup — maps the firmware FamilyID integer to a generation,
 *    then builds a synthetic `IpodModel` with table-derived metadata.
 * 3. Minimal synthetic fallback — when FamilyID is unknown (≤ 0 or unmapped),
 *    returns a `video_5g` generation model which gives correct codec/video
 *    defaults for the most common sync target and avoids a hard failure.
 *
 * The returned model is always suitable for `getCapabilities()`.
 */
function bridgeIpodIdentityToModel(identity: IpodIdentity): IpodModel {
  // 1. Serial suffix lookup — most specific
  if (identity.serialNumber && identity.serialNumber.length >= 3) {
    const suffix = identity.serialNumber.slice(-3);
    const model = identify({ from: 'serial', serialNumber: identity.serialNumber });
    if (model) return model;
    // suffix present but not in table — continue to FamilyID
    void suffix;
  }

  // 2. FamilyID → generationId → synthetic model
  const generationId = identity.familyId > 0 ? lookupByFamilyId(identity.familyId) : undefined;

  if (generationId) {
    const gen = GENERATIONS[generationId];
    return {
      displayName: gen.displayName,
      generationId,
      checksumType: gen.checksumType,
      source: 'usb', // closest approximation; source doesn't affect capabilities
      ...(gen.supported
        ? {}
        : {
            notSupportedReason: `${gen.displayName} is not supported by podkit (libgpod cannot sync this generation).`,
          }),
    };
  }

  // 3. Minimal synthetic fallback — video_5g is a safe default
  //    (supports video, ALAC, artwork; represents a wide capability set)
  const fallbackGen = GENERATIONS['video_5g'];
  return {
    displayName: fallbackGen.displayName,
    generationId: 'video_5g',
    checksumType: fallbackGen.checksumType,
    source: 'usb',
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Resolve `DeviceCapabilities` for any `DeviceIdentity`.
 *
 * Dispatches by `identity.kind`:
 * - `'ipod'`         → table-driven capability synthesis via `@podkit/devices-ipod`,
 *                      with optional firmware overlay (`opts.firmware`).
 * - `'mass-storage'` → preset-based resolution via `@podkit/devices-mass-storage`,
 *                      with built-in presets as default and per-call overrides.
 *
 * @param identity - Device identity from a `DeviceProvider` or built synthetically.
 * @param opts     - Optional firmware overlay (iPod), preset map, and overrides.
 * @returns Capabilities suitable for the sync engine and transcoding pipeline.
 * @throws {Error} If `identity.kind` is not a recognised value.
 *
 * @example — iPod with firmware overlay
 * ```ts
 * const identity: IpodIdentity = { kind: 'ipod', firewireGuid: '...', serialNumber: '5U851AEH3R0', familyId: 15 };
 * const firmware = await inquireFirmware(usbFingerprint);
 * const caps = resolveCapabilities(identity, { firmware: firmware?.capabilities });
 * // → { supportedAudioCodecs: ['aac', 'mp3', 'alac', 'wav', 'aiff'], supportsVideo: true, ... }
 * ```
 *
 * @example — Mass-storage with overrides
 * ```ts
 * const identity: MassStorageIdentity = { kind: 'mass-storage', presetId: 'echo-mini' };
 * const caps = resolveCapabilities(identity, { overrides: { artworkMaxResolution: 64 } });
 * // → { artworkMaxResolution: 64, supportedAudioCodecs: ['aac', 'alac', 'mp3', ...], ... }
 * ```
 */
export function resolveCapabilities(
  identity: DeviceIdentity,
  opts?: ResolveCapabilitiesOptions
): DeviceCapabilities {
  switch (identity.kind) {
    case 'ipod': {
      const model = bridgeIpodIdentityToModel(identity);
      return getIpodCapabilities(model, { firmware: opts?.firmware });
    }

    case 'mass-storage': {
      const presets = opts?.presets ?? BUILT_IN_PRESETS;
      return getMassStorageCapabilities(identity, {
        presets,
        overrides: opts?.overrides,
      });
    }

    default: {
      // Exhaustiveness guard — TypeScript narrows `identity` to `never` here
      // if all cases are covered, but we keep the runtime guard for safety.
      const exhaustive: never = identity;
      throw new Error(
        `resolveCapabilities: unknown identity kind "${(exhaustive as DeviceIdentity).kind}"`
      );
    }
  }
}

/**
 * Resolve `DeviceCapabilities` for a caller that already has an `IpodModel`.
 *
 * This is the entry point for call sites that went through `identify()` and
 * hold an `IpodModel` directly (e.g. callers migrating from `createIpodCapabilities`
 * that now build the model via `identify({ from: 'sysinfo', modelNumStr })`).
 *
 * Keeps `devices-ipod.getCapabilities` inside this module as required by AC#7,
 * while avoiding unnecessary identity round-trips for callers that already
 * have a resolved model.
 *
 * @param model - Resolved iPod model from `identify()`.
 * @param opts  - Optional firmware overlay.
 * @returns Capabilities suitable for the sync engine and transcoding pipeline.
 *
 * @example
 * ```ts
 * const model = identify({ from: 'sysinfo', modelNumStr: 'B754' });
 * if (model) {
 *   const caps = identifyCapabilities(model, { firmware });
 * }
 * ```
 */
export function identifyCapabilities(
  model: IpodModel,
  opts?: Pick<ResolveCapabilitiesOptions, 'firmware'>
): DeviceCapabilities {
  return getIpodCapabilities(model, { firmware: opts?.firmware });
}

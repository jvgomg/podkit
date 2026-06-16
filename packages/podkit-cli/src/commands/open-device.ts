/**
 * Shared device opening logic
 *
 * Encapsulates the type-check → capability-resolution → adapter-opening
 * pattern shared between sync.ts and device.ts.
 *
 * Callers pass the dynamically-imported `@podkit/core` module to avoid
 * triggering eager static imports of native bindings.
 *
 * @module
 */

import type { AudioCodec, AudioNormalizationMode, DeviceArtworkSource } from '@podkit/device-types';
import type { DeviceAdapter, DeviceCapabilities, IpodDatabase } from '@podkit/core';
import { resolveIpodModel } from '@podkit/devices-ipod';
import { formatPresetShortDisplay, type MassStoragePreset } from '@podkit/devices-mass-storage';
import type { DeviceConfig, PodkitConfig } from '../config/types.js';
import { resolveDeviceContentPaths } from '../resolvers/content-paths.js';

// =============================================================================
// Types
// =============================================================================

/** Result of opening a device */
export interface OpenDeviceResult {
  /** The opened adapter (works for any device type) */
  adapter: DeviceAdapter;
  /** Resolved capabilities for this device */
  capabilities: DeviceCapabilities;
  /**
   * Unfiltered "device firmware can play" view for mass-storage devices.
   *
   * `capabilities.supportedAudioCodecs` is the operational view that the
   * adapter / planner consume — MassStorageAdapter filters out codecs podkit
   * refuses to USE as output (today: wav, aiff). `firmwareCapabilities`
   * carries the raw preset (or override) list so `device info` can show users
   * both views: what their firmware can play AND what podkit will write.
   *
   * `undefined` on iPod (no filter is applied; `capabilities` is already the
   * firmware truth).
   */
  firmwareCapabilities?: DeviceCapabilities;
  /** Whether the device supports ALAC playback */
  deviceSupportsAlac: boolean;
  /** Whether this is an iPod device (type undefined or 'ipod') */
  isIpodDevice: boolean;
  /**
   * Raw IpodDatabase handle — only set for iPod devices.
   * Use for iPod-specific operations (validation, generation info, playlists).
   * Prefer DeviceAdapter methods for everything else.
   */
  ipod?: IpodDatabase;
  /**
   * Resolved content paths for mass-storage devices; `undefined` for iPods.
   * Consumed by the pre-sync sweep (TASK-398) so it can walk the right
   * directories without duplicating the open-device resolution logic.
   */
  contentPaths?: import('@podkit/core').ContentPaths;
}

/**
 * The subset of `@podkit/core` needed by openDevice.
 * Callers pass the dynamically-imported module to avoid eager native loading.
 */
export type CoreModule = typeof import('@podkit/core');

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a device type represents a mass-storage device (not iPod).
 */
export function isMassStorageDevice(type: string | undefined): boolean {
  return type !== undefined && type !== 'ipod';
}

/**
 * Structural subset of a `DeviceConfig` (or `ResolvedDeviceSettings`)
 * the display helpers read.
 *
 * Pinned as a structural type so callers can pass either a full
 * `DeviceConfig` (TOML raw shape — `manufacturer: string`) or a
 * `ResolvedDeviceSettings` (resolved-with-provenance shape —
 * `manufacturer: Resolved<string, _>`), without coupling the helper
 * signatures to either module. The `{ value: string }` arm of each
 * union covers the resolved form; `unwrapDisplay` projects both into
 * a plain string for the formatting code below.
 */
export interface DeviceDisplayInput {
  type?: string;
  manufacturer?: string | { value: string };
  productName?: string | { value: string };
}

/** Project a raw-or-Resolved display field to its plain string value. */
function unwrapDisplay(v: string | { value: string } | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'string' ? v : v.value;
}

/**
 * Get a human-readable short display name for a device.
 *
 * Resolution order per field:
 *   `device.productName` (per-device TOML) → preset.productName
 *
 * Mass-storage types compose `formatPresetShortDisplay` against the
 * preset registry, so presets own their labels (the previous hard-coded
 * switch leaked Echo Mini / Rockbox / Generic strings into the CLI's
 * display layer). iPods and unknown types still fall back to `'iPod'`
 * for the same historical reason as the old switch.
 */
export function getDeviceTypeDisplayName(
  device: DeviceDisplayInput | undefined,
  presets: Record<string, MassStoragePreset>
): string {
  const type = device?.type;
  if (type === undefined || type === 'ipod') return 'iPod';
  const preset = presets[type];
  if (preset) {
    return unwrapDisplay(device?.productName) ?? formatPresetShortDisplay(preset);
  }
  // Unknown type — backward compat: undefined / unrecognised → iPod.
  return 'iPod';
}

/**
 * Rich display name for a device — `'FiiO Snowsky Echo Mini (echo-mini)'`
 * style. Returns the same `'iPod'` fallback as the short form for iPods and
 * unknown types so callers that want one consistent label can switch in
 * place.
 *
 * Resolution order per field:
 *   `device.manufacturer` (per-device TOML) → preset.manufacturer
 *   `device.productName`  (per-device TOML) → preset.productName
 *
 * The `id` portion (`(generic)`) stays the preset id so the CLI hint
 * still names the exact `--type` token the user passed.
 */
export function getDeviceTypeRichDisplayName(
  device: DeviceDisplayInput | undefined,
  presets: Record<string, MassStoragePreset>
): string {
  const type = device?.type;
  if (type === undefined || type === 'ipod') return 'iPod';
  const preset = presets[type];
  if (preset) {
    const manufacturer = unwrapDisplay(device?.manufacturer) ?? preset.manufacturer;
    const productName = unwrapDisplay(device?.productName) ?? preset.productName;
    return `${manufacturer} ${productName} (${type})`;
  }
  return 'iPod';
}

/**
 * Get a device label for user-facing messages — short form ("Echo Mini",
 * "iPod", …), with the user's productName override winning over the
 * preset default. Passing a full `DeviceConfig` ensures the override is
 * picked up automatically.
 */
export function getDeviceLabel(
  device: DeviceDisplayInput | undefined,
  presets: Record<string, MassStoragePreset>
): string {
  return isMassStorageDevice(device?.type) ? getDeviceTypeDisplayName(device, presets) : 'iPod';
}

/**
 * Pick the capability-relevant subset of a TOML config layer
 * (per-device or device-defaults) as a `Partial<DeviceCapabilities>`.
 *
 * The CLI is responsible for I/O — reading TOML + env vars and shaping
 * them into the typed slices core expects. The merging across layers
 * happens inside `resolveCapabilitiesResolved`, so this helper never
 * collapses two layers' provenance into one blob.
 *
 * Returns `undefined` when the layer contributes no capability fields,
 * letting the resolver skip an empty layer entirely.
 */
function pickCapabilityFields(
  source:
    | {
        artworkMaxResolution?: number;
        artworkSources?: DeviceArtworkSource[];
        supportedAudioCodecs?: AudioCodec[];
        supportsVideo?: boolean;
        audioNormalization?: AudioNormalizationMode;
        supportsAlbumArtistBrowsing?: boolean;
      }
    | undefined
): Partial<import('@podkit/core').DeviceCapabilities> | undefined {
  if (!source) return undefined;
  const out: Partial<import('@podkit/core').DeviceCapabilities> = {};
  let hasFields = false;
  if (source.artworkMaxResolution !== undefined) {
    out.artworkMaxResolution = source.artworkMaxResolution;
    hasFields = true;
  }
  if (source.artworkSources !== undefined) {
    out.artworkSources = source.artworkSources;
    hasFields = true;
  }
  if (source.supportedAudioCodecs !== undefined) {
    out.supportedAudioCodecs = source.supportedAudioCodecs;
    hasFields = true;
  }
  if (source.supportsVideo !== undefined) {
    out.supportsVideo = source.supportsVideo;
    hasFields = true;
  }
  if (source.audioNormalization !== undefined) {
    out.audioNormalization = source.audioNormalization;
    hasFields = true;
  }
  if (source.supportsAlbumArtistBrowsing !== undefined) {
    out.supportsAlbumArtistBrowsing = source.supportsAlbumArtistBrowsing;
    hasFields = true;
  }
  return hasFields ? out : undefined;
}

// =============================================================================
// openDevice
// =============================================================================

/**
 * Open a device by resolving its type, capabilities, and adapter.
 *
 * Encapsulates the branching logic for iPod vs mass-storage devices:
 * - iPod: opens IpodDatabase, derives capabilities from generation metadata
 * - Mass-storage: resolves preset capabilities with config overrides, opens MassStorageAdapter
 *
 * @param core - Dynamically-imported `@podkit/core` module
 * @param path - Mount point / device path
 * @param deviceConfig - Optional device config from TOML (provides type, capability overrides)
 * @param deviceDefaults - Optional global device defaults from env vars (fallback for mass-storage)
 * @returns OpenDeviceResult with adapter, capabilities, and iPod handle if applicable
 *
 * @throws {Error} If the device fails to open (database missing, path invalid, etc.)
 * @throws {Error} If the device type is unknown (no matching preset)
 */
export async function openDevice(
  core: CoreModule,
  path: string,
  deviceConfig: DeviceConfig | undefined,
  deviceDefaults: PodkitConfig['deviceDefaults'] | undefined,
  presets: Record<string, MassStoragePreset>
): Promise<OpenDeviceResult> {
  const deviceType = deviceConfig?.type;
  const isIpod = !deviceType || deviceType === 'ipod';

  if (isIpod) {
    // iPod: open database, derive capabilities via identifyCapabilities.
    const ipod = await core.IpodDatabase.open(path);
    const ipodDeviceInfo = ipod.getInfo().device;

    // Cascade-driven identity (TASK-317.03). Compose the full bag from every
    // axis available — SysInfoExtended on disk (firewireGuid + serial +
    // modelNumStr) and the live USB descriptor — rather than relying solely
    // on libgpod's view. Resolves the "Could not identify iPod model from
    // libgpod data" warning on devices where SIE is present and accurate.
    let identityBag: Parameters<typeof resolveIpodModel>[0] = {
      modelNumStr: ipodDeviceInfo.modelNumber ?? undefined,
      libgpodGeneration: ipodDeviceInfo.generation,
    };
    try {
      const sie = core.readSysInfoExtended(path);
      if (sie?.present) {
        identityBag = {
          ...identityBag,
          modelNumStr: sie.identity.modelNumStr ?? identityBag.modelNumStr,
          serialNumber: sie.identity.serialNumber ?? identityBag.serialNumber,
          familyId: sie.identity.familyId ?? identityBag.familyId,
        };
      }
    } catch {
      // SIE read is best-effort; absence is the normal pre-init state.
    }
    try {
      const usb = await core.resolveUsbDeviceFromPath(path);
      if (usb && core.hasCompleteUsbFingerprint(usb)) {
        identityBag = { ...identityBag, productId: usb.productId };
      }
    } catch {
      // USB resolution unavailable on this platform — fall back to disk + libgpod.
    }

    const model = resolveIpodModel(identityBag);
    if (!model) {
      // Neutral wording — no `libgpod` leakage in user-facing copy.
      throw new Error(
        'Could not identify iPod model from device data. ' +
          'Try reconnecting the device, or run `podkit doctor --repair sysinfo-extended` ' +
          'to refresh the on-disk identity files from USB firmware.'
      );
    }
    const capabilities = core.identifyCapabilities(model);

    const adapter = new core.IpodDeviceAdapter(ipod, capabilities);

    // Mirror the mass-storage branch and read capabilities back off the
    // adapter — keeps the contract uniform across device kinds. iPod adapter
    // does no filtering today, but the symmetry means a future filter would
    // automatically reach downstream config + classifier.
    const effectiveCaps = adapter.capabilities;
    return {
      adapter,
      capabilities: effectiveCaps,
      deviceSupportsAlac: effectiveCaps.supportedAudioCodecs.includes('alac'),
      isIpodDevice: true,
      ipod,
      contentPaths: undefined,
    };
  }

  // Mass-storage device: each TOML layer is shaped into its own
  // `Partial<DeviceCapabilities>` slice so the core resolver can attribute
  // each field to the actual layer it came from
  // (per-device → device-defaults → preset). The CLI's job stops at
  // picking the relevant fields; the merge happens in
  // `resolveCapabilitiesResolved`.
  const deviceConfigOverrides = pickCapabilityFields(deviceConfig);
  const deviceDefaultsOverrides = pickCapabilityFields(deviceDefaults);

  const massStorageIdentity: import('@podkit/core').MassStorageIdentity = {
    kind: 'mass-storage',
    presetId: deviceType!,
  };
  let resolvedCaps: import('@podkit/core').DeviceCapabilities;
  try {
    // Use the provenance-aware resolver and project to bare values for
    // the adapter (which doesn't consume provenance today). Future
    // `device info` rendering can call `resolveCapabilitiesResolved`
    // directly when it needs inheritance markers.
    const resolved = core.resolveCapabilitiesResolved(massStorageIdentity, {
      presets,
      deviceConfigOverrides,
      deviceDefaultsOverrides,
    });
    resolvedCaps = {
      artworkSources: [...resolved.artworkSources.value],
      artworkMaxResolution: resolved.artworkMaxResolution.value,
      supportedAudioCodecs: [...resolved.supportedAudioCodecs.value],
      supportsVideo: resolved.supportsVideo.value,
      audioNormalization: resolved.audioNormalization.value,
      supportsAlbumArtistBrowsing: resolved.supportsAlbumArtistBrowsing.value,
      ...(resolved.containerConstraints !== undefined
        ? { containerConstraints: resolved.containerConstraints.value }
        : {}),
    };
  } catch {
    throw new Error(`Unknown device type: ${deviceType}`);
  }

  // Resolve content paths: preset defaults < global deviceDefaults < per-device config.
  // Always returns a fully-normalised ContentPaths; previously this branch
  // returned `undefined` when no overrides applied, which let the adapter
  // fall back to DEFAULT_CONTENT_PATHS internally — equivalent to the
  // normalised form we now pass explicitly.
  const contentPaths = resolveDeviceContentPaths(deviceConfig, deviceDefaults, presets);

  // Resolve pathTemplate: per-device config > global deviceDefaults > adapter default
  const pathTemplate = deviceConfig?.pathTemplate ?? deviceDefaults?.pathTemplate;

  const adapterOptions = {
    contentPaths,
    ...(pathTemplate ? { pathTemplate } : {}),
  };
  const adapter = await core.MassStorageAdapter.open(path, resolvedCaps, adapterOptions);

  // Use the adapter's view of capabilities so downstream config + classifier
  // see the same filtered supportedAudioCodecs the adapter applies (e.g. wav
  // and aiff dropped on mass-storage). Without this the planner thinks WAV is
  // device-native on echo-mini and routes through optimized-copy with an
  // m4a container, which FFmpeg rejects.
  const effectiveCaps = adapter.capabilities;
  return {
    adapter,
    capabilities: effectiveCaps,
    // Surface the pre-filter list so `device info` can show users both views
    // (firmware vs operational). `resolvedCaps` is the same bag the adapter
    // received before its supportedAudioCodecs filter ran.
    firmwareCapabilities: resolvedCaps,
    deviceSupportsAlac: effectiveCaps.supportedAudioCodecs.includes('alac'),
    isIpodDevice: false,
    // Pre-sync sweep (TASK-398) needs to walk the configured content paths
    // to find debris before track ops run. Exposing the resolved paths
    // alongside the adapter is the smallest surface change that avoids
    // duplicating the resolution logic in sync.ts.
    contentPaths,
  };
}

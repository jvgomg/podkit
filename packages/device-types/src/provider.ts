/**
 * Device provider interface
 *
 * A `DeviceProvider` is responsible for detecting and identifying a specific
 * class of device from a raw USB fingerprint. Providers are registered in the
 * podkit-core device enumeration layer and tried in priority order.
 *
 * Optionally, providers can also describe how a detected device would be
 * added to the user's config via the CLI — see {@link DeviceProvider.describeAddIntent}
 * and {@link DeviceAddIntent}. The CLI consumes these intents when it cannot
 * find a configured device but does see one attached via USB ("you have an
 * Echo Mini plugged in — add it with this command").
 *
 * @module
 */

import type { DeviceIdentity } from './identity.js';
import type { UsbFingerprint } from './identity.js';

export type { UsbFingerprint };

// =============================================================================
// describeAddIntent — provider-driven CLI add-hint
// =============================================================================

/**
 * Subset of the discovery context relevant to building an add-intent.
 *
 * Defined here (in `@podkit/device-types`) so the `DeviceProvider` contract
 * stays self-contained and doesn't reach into `@podkit/podkit-core` (where
 * `EnumeratedUsbDevice` lives). Callers — typically `podkit-core`'s enumerate
 * helper — pass the relevant fields through.
 */
export interface DiscoveredContext {
  /**
   * OS-level disk identifier (e.g. macOS BSD name `disk5`) when the device
   * exposes a mass-storage volume. Absent for USB-only devices.
   */
  diskIdentifier?: string;
}

/**
 * Provider-produced hint describing how a detected device would be added to
 * the user's config via the CLI.
 *
 * The CLI assembles the user-visible command from the provider's hint:
 *   `podkit device add -d <name> <addArgs.join(' ')>`
 *
 * Providers do not know the device name the user will choose, so the CLI
 * is responsible for prepending `-d <name>`. Providers contribute only the
 * `--type` / `--path` / preset-id pieces (`addArgs`), an identifier (`kind`)
 * suitable for human display, and any clarifying `notes`.
 */
export interface DeviceAddIntent {
  /** Provider id that produced this intent — echoes the owning provider's `id`. */
  providerId: string;
  /**
   * Device-kind identifier the provider recognises — e.g. preset id
   * `'echo-mini'` for mass-storage, generation id `'nano_5g'` for iPod.
   * The CLI may render this through a display-name lookup.
   */
  kind: string;
  /**
   * Argv tokens to append after `podkit device add -d <name>`.
   * E.g. `['--type', 'echo-mini', '--path', '<mount-point>']`.
   * Placeholders like `<mount-point>` are intentional — the CLI prints
   * them verbatim so the user knows what to substitute.
   */
  addArgs: readonly string[];
  /**
   * Extra context lines printed after the suggested command. Used for
   * device-specific notes such as "mount it first" or "disk: disk5".
   */
  notes?: readonly string[];
}

// =============================================================================
// DeviceProvider
// =============================================================================

/**
 * A provider that can detect and identify a specific class of connected device.
 *
 * @typeParam TIdentity - The identity variant this provider produces.
 *   Defaults to `DeviceIdentity` for generic providers.
 */
export interface DeviceProvider<TIdentity extends DeviceIdentity = DeviceIdentity> {
  /** Unique provider identifier, e.g. `"ipod"` or `"mass-storage"`. */
  readonly id: string;
  /**
   * Attempt to identify the device described by `fp`.
   *
   * @returns The resolved identity, or `null` if this provider does not
   *   recognise the device.
   */
  detect(fp: UsbFingerprint): Promise<TIdentity | null>;
  /**
   * Build an "add this device" hint for a detected identity. Optional —
   * providers that cannot produce a meaningful add hint (e.g. for an iPod
   * detected via USB but requiring a mounted volume to add) may omit this
   * method and the CLI's hint helper will skip them.
   *
   * @param identity - The identity this provider returned from `detect()`.
   * @param discovered - Discovery context (carries `diskIdentifier` when the
   *   device exposes a mass-storage volume). May be empty for USB-only.
   */
  describeAddIntent?(identity: TIdentity, discovered: DiscoveredContext): DeviceAddIntent | null;
}

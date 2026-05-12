/**
 * Mass-storage device provider
 *
 * Implements the `DeviceProvider<MassStorageIdentity>` interface for
 * USB mass-storage devices (Echo Mini, Rockbox, generic DAPs).
 *
 * @module
 */

import type {
  DeviceProvider,
  UsbFingerprint,
  MassStorageIdentity,
  DeviceAddIntent,
  DiscoveredContext,
} from '@podkit/device-types';
import type { MassStoragePreset } from './presets/types.js';
import { identify } from './identity.js';

// =============================================================================
// createMassStorageProvider
// =============================================================================

/**
 * Construct a mass-storage device provider.
 *
 * The provider matches USB devices against the supplied preset map's
 * VID/PID hints. Unmatched non-iPod devices fall back to the generic
 * preset (caller decision: include `'generic'` in the preset map for
 * fallback behaviour, or omit it to require explicit recognition).
 *
 * Stateless: each call to `detect()` re-evaluates against the preset
 * map. Two callers with different preset maps get independent providers.
 *
 * @param presets - Preset map in scope (built-in + user-registered). The
 *   resulting provider sees only these presets. Include `'generic'` to enable
 *   fallback detection for any unrecognised mass-storage USB device.
 * @returns A `DeviceProvider<MassStorageIdentity>` for use with `enumerateConnectedDevices`.
 *
 * @example
 * ```ts
 * import { createMassStorageProvider, BUILT_IN_PRESETS, definePreset } from '@podkit/devices-mass-storage';
 * import { enumerateConnectedDevices } from '@podkit/core';
 *
 * const myDap = definePreset({ id: 'my-dap', extends: 'generic' });
 * const provider = createMassStorageProvider({ ...BUILT_IN_PRESETS, 'my-dap': myDap });
 *
 * const devices = await enumerateConnectedDevices({ providers: [provider] });
 * ```
 */
export function createMassStorageProvider(
  presets: Record<string, MassStoragePreset>
): DeviceProvider<MassStorageIdentity> {
  return {
    id: 'mass-storage',
    async detect(fp: UsbFingerprint): Promise<MassStorageIdentity | null> {
      return identify(fp, presets);
    },
    describeAddIntent(
      identity: MassStorageIdentity,
      discovered: DiscoveredContext
    ): DeviceAddIntent | null {
      // Without a preset id there's nothing actionable to suggest — the CLI
      // would have nothing to pass to `--type`.
      if (!identity.presetId) return null;

      const addArgs: string[] = ['--type', identity.presetId, '--path', '<mount-point>'];
      const notes: string[] = [];
      if (discovered.diskIdentifier) {
        notes.push(`(disk: ${discovered.diskIdentifier} — mount it first if not already mounted)`);
      }

      const intent: DeviceAddIntent = {
        providerId: 'mass-storage',
        kind: identity.presetId,
        addArgs,
      };
      if (notes.length > 0) {
        return { ...intent, notes };
      }
      return intent;
    },
  };
}

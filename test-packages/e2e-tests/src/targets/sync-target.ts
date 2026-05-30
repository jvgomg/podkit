/**
 * `SyncTarget` — the device abstraction the e2e matrix syncs to.
 *
 * Generalises the iPod-only `IpodTarget` to cover both iPod and mass-storage
 * devices behind one capability-carrying interface, so "device" can become a
 * matrix axis (doc-039 P3/P4). Both backends expose a normalised
 * `getTracks()` and a `capabilities` snapshot the reference model keys off.
 *
 * @module
 */

import type { TrackInfo } from '@podkit/gpod-testing';
import type { DeviceCapabilities } from '@podkit/device-types';
import { identify, getCapabilities } from '@podkit/devices-ipod';

export type SyncTargetKind = 'ipod' | 'mass-storage';

/**
 * Path segments, relative to an iPod mount, under which libgpod stores the
 * audio files (`iPod_Control/Music/F00../…`). Shared by the dummy and real
 * iPod targets' `musicRoot()`.
 */
export const IPOD_MUSIC_SUBPATH = ['iPod_Control', 'Music'] as const;

/**
 * A `[devices.<name>]` config block plus the name to reference it by.
 *
 * Mass-storage devices must declare a `type = "<preset>"` stanza so podkit
 * treats the path as a managed mass-storage device rather than probing it as
 * an iPod. iPod targets return `null` — they are addressed purely by path and
 * auto-detected from the iTunesDB.
 */
export interface DeviceConfigFragment {
  name: string;
  /** The `[devices.<name>]` TOML block, newline-terminated. */
  toml: string;
}

/**
 * A device podkit can sync to in tests.
 *
 * Implementations: dummy iPod (`@podkit/gpod-testing`), real iPod (mount
 * point), and temp-directory mass-storage devices.
 */
export interface SyncTarget {
  readonly kind: SyncTargetKind;
  /** Mount path / device root the CLI addresses via `--device`. */
  readonly path: string;
  /** Display name for logging. */
  readonly name: string;
  /** Whether this is a real device (cleanup must never delete user data). */
  readonly isRealDevice: boolean;
  /** iPod model number (e.g. `MA147`) or mass-storage preset id (e.g. `echo-mini`). */
  readonly model?: string;
  /** Capability snapshot — supported codecs, artwork storage model, etc. */
  readonly capabilities: DeviceCapabilities;
  /** Device config block to merge into a sync config, or `null` when path-addressed. */
  deviceConfig(): DeviceConfigFragment | null;
  /**
   * Filesystem root under which the device's *audio files* live. Tests that
   * read the written files directly (e.g. ffprobe their embedded artwork —
   * see `matrix/device-artwork.ts`) walk this root. iPod:
   * `<path>/iPod_Control/Music`; mass-storage: `<path>/<musicDir>`.
   */
  musicRoot(): string;
  /** Tracks currently on the device, normalised across backends. */
  getTracks(): Promise<TrackInfo[]>;
  /** Release resources. No-op for real devices. */
  cleanup(): Promise<void>;
}

/**
 * Derive an iPod model's capabilities from its Apple model number (e.g.
 * `MA147`). Uses the same generation tables podkit ships, so the test's
 * capability view matches production.
 *
 * @throws if the model number is not a known iPod.
 */
export function ipodCapabilitiesForModel(modelNumber: string): DeviceCapabilities {
  const model = identify({ from: 'sysinfo', modelNumStr: modelNumber });
  if (!model) {
    throw new Error(`Unknown iPod model number for capability lookup: ${modelNumber}`);
  }
  return getCapabilities(model);
}

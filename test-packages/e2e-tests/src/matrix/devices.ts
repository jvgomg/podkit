/**
 * Device axis for the e2e sync matrix.
 *
 * A `DeviceSpec` pairs a stable id with the device's *raw* capability snapshot
 * (what `predict()` keys off) and a factory that mints a FRESH `SyncTarget` to
 * sync onto. Every cell that touches a device must construct its own target —
 * a shared target would let a later sync diff against an earlier sync's tracks
 * and pollute the idempotency observation (doc-039 §"Combinatorial control").
 *
 * The capability snapshots come straight from the same sources podkit ships:
 * `@podkit/devices-ipod` generation tables for the iPod, `BUILT_IN_PRESETS`
 * for mass-storage. So the matrix's capability view is the production view.
 *
 * @module
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import { BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';

import {
  createTarget,
  createMassStorageTarget,
  ipodCapabilitiesForModel,
  type SyncTarget,
} from '../targets';
import type { DeviceKind } from './reference-model.js';

/** Stable device-axis identifiers. */
export type DeviceId = 'ipod-MA147' | 'ms-echo-mini' | 'ms-generic' | 'ms-rockbox';

/** One device the matrix can sync to. */
export interface DeviceSpec {
  readonly id: DeviceId;
  readonly kind: DeviceKind;
  /** Raw (unfiltered) capability snapshot the predictions key off. */
  readonly capabilities: DeviceCapabilities;
  /** Mint a fresh, empty target instance. */
  create(): Promise<SyncTarget>;
}

export const DEVICE_SPECS: readonly DeviceSpec[] = [
  {
    id: 'ipod-MA147',
    kind: 'ipod',
    capabilities: ipodCapabilitiesForModel('MA147'),
    create: () => createTarget({ model: 'MA147' }),
  },
  {
    id: 'ms-echo-mini',
    kind: 'mass-storage',
    capabilities: BUILT_IN_PRESETS['echo-mini'],
    create: () => createMassStorageTarget({ preset: 'echo-mini' }),
  },
  {
    id: 'ms-generic',
    kind: 'mass-storage',
    capabilities: BUILT_IN_PRESETS['generic'],
    create: () => createMassStorageTarget({ preset: 'generic' }),
  },
  {
    id: 'ms-rockbox',
    kind: 'mass-storage',
    capabilities: BUILT_IN_PRESETS['rockbox'],
    create: () => createMassStorageTarget({ preset: 'rockbox' }),
  },
];

export const DEVICE_SPEC_BY_ID: Record<DeviceId, DeviceSpec> = Object.fromEntries(
  DEVICE_SPECS.map((spec) => [spec.id, spec])
) as Record<DeviceId, DeviceSpec>;

/**
 * The `--device` argument and any `[devices.<name>]` config fragment for a
 * target. iPods are addressed by mount path with no stanza; mass-storage
 * devices need the `type`/`path` stanza and are addressed by the device name.
 */
export function deviceAddressing(target: SyncTarget): {
  deviceArg: string;
  configFragment: string;
} {
  const fragment = target.deviceConfig();
  if (fragment) {
    return { deviceArg: fragment.name, configFragment: fragment.toml };
  }
  return { deviceArg: target.path, configFragment: '' };
}

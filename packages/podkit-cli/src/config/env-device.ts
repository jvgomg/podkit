/**
 * Mass-storage device declaration via environment variables.
 *
 * ENV can already declare a music source (`PODKIT_MUSIC_PATH`) and global
 * settings, but not a device — forcing a single-mass-storage user into a
 * config file purely to name a preset. This mapper closes that gap: a single
 * declaration (`PODKIT_DEVICE_PATH` + optional `PODKIT_DEVICE_TYPE` /
 * `PODKIT_DEVICE_NAME`) maps to the same `DeviceConfig` shape the config
 * file produces, giving iPod and mass-storage symmetric single-device
 * ENV-only lanes.
 *
 * First slice of the broader ENV↔config parity direction — multi-device
 * declarations remain config-file territory.
 */

import type { DeviceConfig } from './types.js';
import { ENV_KEYS } from './defaults.js';

/** A device declared via ENV, in the shape `config.devices` stores. */
export interface EnvDeviceDeclaration {
  name: string;
  device: DeviceConfig;
}

/**
 * Map a mass-storage device declaration from environment variables to a
 * named `DeviceConfig`.
 *
 * - `PODKIT_DEVICE_PATH` is the trigger: absent/blank → no declaration.
 * - `PODKIT_DEVICE_TYPE` names the preset; defaults to `generic`.
 * - `PODKIT_DEVICE_NAME` (UPPER_SNAKE_CASE, like collection env names)
 *   defaults to `default`.
 *
 * @throws {Error} when the declared type is `ipod` — iPods are auto-detected
 * from the mounted volume and never need an ENV declaration; declaring one
 * here is a misconfiguration, not something to silently coerce to a
 * mass-storage preset.
 */
export function massStorageDeviceFromEnv(
  env: Record<string, string | undefined>
): EnvDeviceDeclaration | null {
  const path = env[ENV_KEYS.devicePath]?.trim();
  if (!path) return null;

  const type = env[ENV_KEYS.deviceType]?.trim() || 'generic';
  if (type === 'ipod') {
    throw new Error(
      `${ENV_KEYS.deviceType}=ipod is not a valid declaration. iPods are detected from the ` +
        `mounted volume and need no ENV declaration — remove ${ENV_KEYS.devicePath}/` +
        `${ENV_KEYS.deviceType}, or declare a mass-storage preset (e.g. echo-mini, rockbox, generic).`
    );
  }

  const rawName = env[ENV_KEYS.deviceName]?.trim();
  const name = rawName ? rawName.toLowerCase().replace(/_/g, '-') : 'default';

  return { name, device: { type, path } };
}

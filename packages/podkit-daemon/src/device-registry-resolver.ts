/**
 * Device-registry resolver — matches a detected device against the config
 * device registry so the daemon can sync by name (per-device settings apply)
 * instead of by raw mount path (global/ENV settings only).
 *
 * The daemon never parses config files itself; the registry is obtained
 * through the CLI's `--json device list` output. Resolution is pure and
 * failure-tolerant: any registry-fetch failure degrades to "unregistered"
 * (path-based sync), never to a failed cycle.
 */

import type { CliResult, DeviceListOutput } from './cli-runner.js';
import type { DetectedDevice } from './device-poller.js';
import { log } from './logger.js';

/** One entry of the config device registry, as reported by `device list`. */
export interface RegistryDevice {
  name: string;
  volumeUuid?: string;
}

/**
 * Resolve a detected volume UUID to a registered device name.
 *
 * Comparison is case-insensitive: lsblk reports UUIDs as-formatted (often
 * lowercase) while config entries are typically stored uppercase. Registry
 * entries without a `volumeUuid` (e.g. path-only mass-storage devices)
 * never match.
 *
 * @returns The registered device name, or `null` when unregistered.
 */
export function resolveRegisteredDeviceName(
  uuid: string | undefined,
  devices: readonly RegistryDevice[]
): string | null {
  if (!uuid) return null;
  const needle = uuid.toUpperCase();
  for (const device of devices) {
    if (device.volumeUuid && device.volumeUuid.toUpperCase() === needle) {
      return device.name;
    }
  }
  return null;
}

/**
 * Build a resolver that fetches the registry via the CLI and resolves a
 * detected device to its registered name.
 *
 * The registry is fetched per call (per sync cycle) so config edits apply
 * without a daemon restart. Every failure mode — CLI missing, non-zero
 * exit, malformed output — logs a warning and resolves to `null` so the
 * caller falls back to path-based sync.
 */
export function createDeviceNameResolver(
  listDevices: () => Promise<CliResult<DeviceListOutput>>
): (device: DetectedDevice) => Promise<string | null> {
  return async (device) => {
    if (!device.uuid) return null;

    let result: CliResult<DeviceListOutput>;
    try {
      result = await listDevices();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('warn', `Device registry lookup failed, syncing by path: ${message}`);
      return null;
    }

    if (result.exitCode !== 0 || !result.json?.success) {
      log('warn', 'Device registry lookup failed, syncing by path', {
        exitCode: result.exitCode,
      });
      return null;
    }

    return resolveRegisteredDeviceName(device.uuid, result.json.devices ?? []);
  };
}

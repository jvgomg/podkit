/**
 * Shared helper: refresh a device's cached `volumeName` and `path` in the
 * podkit config after a disk relabel changes the volume's OS name / mountpoint.
 *
 * This is the real implementation of the `refreshConfig` seam injected into
 * `applyDeviceName` by `rename` (and in slice .04, by `reset`). Core stays
 * free of CLI config imports — the seam is typed in core as `RefreshConfig`
 * and defaulted to a no-op; only the CLI layer supplies this real one.
 *
 * ## Match strategy
 * The device is identified in config by its stable `volumeUuid`. The
 * volume UUID is NOT changed by a relabel, so UUID-based matching is safe
 * here. If no `volumeUuid` is provided, or no config entry carries that UUID,
 * the function skips silently — the relabel still succeeded.
 *
 * ## Fields updated
 * - `volumeName` → the new disk label (what the OS sees; FAT-lossy form).
 * - `path` → the new resolved mountpoint (e.g. `/Volumes/PARTY IPOD`).
 *
 * Fields NOT updated: the config key (alias), `volumeUuid`, quality presets,
 * or any other user setting. The caller's alias (`-d terapod`) remains valid.
 *
 * ## Skip conditions (all silent, no error thrown)
 * - No `volumeUuid` supplied on the info object.
 * - No config file found at `configPath`.
 * - No `[devices.*]` entry carries a matching UUID.
 */

import type { ConfigRefreshInfo } from '@podkit/core';
import { DEFAULT_CONFIG_PATH } from './defaults.js';
import { loadConfigFile } from './loader.js';
import { updateDevice } from './writer.js';

export interface DeviceConfigRefreshOptions {
  /**
   * Path to the config file. Defaults to `DEFAULT_CONFIG_PATH`.
   * Override in tests to use a temp-dir config.
   */
  configPath?: string;
  /**
   * Optional sink for a non-fatal warning when the config write itself fails
   * (e.g. read-only filesystem). The relabel has already succeeded, so this is
   * surfaced as a warning rather than thrown. Defaults to no-op.
   */
  warn?: (message: string) => void;
}

/**
 * Build a `RefreshConfig` seam implementation that updates `volumeName` and
 * `path` for the matching device entry in the podkit config file.
 *
 * Returns an async function that matches the `RefreshConfig` type from
 * `@podkit/core`. Both `rename.ts` and (in slice .04) `reset.ts` call this
 * factory to obtain their injected seam.
 *
 * @example
 * ```ts
 * const refreshConfig = makeDeviceConfigRefresh({ configPath });
 * await applyDeviceName({ ..., refreshConfig, volumeUuid });
 * ```
 */
export function makeDeviceConfigRefresh(
  options?: DeviceConfigRefreshOptions
): (info: ConfigRefreshInfo) => Promise<void> {
  const configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;
  const warn = options?.warn;

  return async (info: ConfigRefreshInfo): Promise<void> => {
    // Skip: no UUID → cannot identify the device safely.
    if (!info.volumeUuid) return;

    // Skip: config file absent (Docker / headless / first-time user).
    let config: ReturnType<typeof loadConfigFile>;
    try {
      config = loadConfigFile(configPath);
    } catch {
      // Unreadable config (malformed TOML, version mismatch, or an I/O error
      // such as EACCES) — don't crash the rename; silently skip the cache update.
      return;
    }
    if (!config) return;

    const devices = config.devices;
    if (!devices) return;

    // Find the config entry whose volumeUuid matches (case-insensitive,
    // matching the convention already used in matchConfiguredDeviceToDiscovered).
    const targetUuid = info.volumeUuid.toUpperCase();
    let matchedName: string | undefined;
    for (const [name, deviceConfig] of Object.entries(devices)) {
      if (deviceConfig.volumeUuid && deviceConfig.volumeUuid.toUpperCase() === targetUuid) {
        matchedName = name;
        break;
      }
    }

    // Skip: no config entry carries this UUID.
    if (!matchedName) return;

    // Update only the stale cache fields. `updateDevice` does a targeted
    // TOML surgery — all other fields in the section are left untouched.
    const result = updateDevice(
      matchedName,
      {
        volumeName: info.newLabel,
        path: info.newPath,
      },
      { configPath }
    );

    // The relabel already succeeded; a failed cache write is non-fatal but the
    // user should know their config is now stale.
    if (!result.success) {
      warn?.(
        `Device renamed, but updating its cached name/path in the config failed: ${result.error ?? 'unknown error'}`
      );
    }
  };
}

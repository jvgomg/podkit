/**
 * Persistence helpers for `podkit device add`.
 *
 * Collapses three repeated patterns across the three add flows:
 *
 *  1. `applyCommonDeviceConfigOptions` — the quality/audioQuality/
 *     videoQuality/encoding/artwork ladder that every flow runs against
 *     the same options shape. Mass-storage extends this with its own
 *     extra options; iPod flows stop at these five.
 *
 *  2. `persistDeviceConfig` — wraps `addDevice` + the
 *     `CONFIG_SAVE_FAILED` error throw + the first-device default
 *     promotion. Returns the save result so the caller can compose the
 *     DeviceAddOutput envelope.
 *
 *  3. `resolveIsFirstDeviceAndConfigPath` — the trivial three-line dance
 *     to figure out first-device status + the effective config path.
 *     Trivial but appears in every flow.
 */

import { addDevice, setDefaultDevice, DEFAULT_CONFIG_PATH } from '../../config/index.js';
import type { DeviceConfig } from '../../config/types.js';
import { CliError } from '../../errors.js';
import { DeviceErrorCodes } from './error-codes.js';

/**
 * The narrowed view of `AddOptions` that `applyCommonDeviceConfigOptions`
 * consumes. Inlined so the helper doesn't have to import the full
 * command-options type and so callers can pass arbitrary shapes (tests).
 */
export interface CommonDeviceConfigOptions {
  quality?: string;
  audioQuality?: string;
  videoQuality?: string;
  encoding?: string;
  artwork?: boolean;
}

/**
 * Apply the common 5-field option ladder to a DeviceConfig. The ladder
 * appeared verbatim in three places in device/add.ts; consolidating it
 * here makes adding a new common option a single-line change.
 *
 * NB: mass-storage adds its own additional fields (artworkMaxResolution,
 * artworkSources, supportedAudioCodecs, supportsVideo, musicDir,
 * moviesDir, tvShowsDir) which stay at the call site because they're
 * not shared with the iPod flow.
 *
 * `as any` casts mirror the original inline code — the CLI option
 * strings are validated upstream by commander/the prior validation
 * block, so the runtime values are always valid preset names.
 */
export function applyCommonDeviceConfigOptions(
  deviceConfig: DeviceConfig,
  options: CommonDeviceConfigOptions
): void {
  if (options.quality) deviceConfig.quality = options.quality as DeviceConfig['quality'];
  if (options.audioQuality)
    deviceConfig.audioQuality = options.audioQuality as DeviceConfig['audioQuality'];
  if (options.videoQuality)
    deviceConfig.videoQuality = options.videoQuality as DeviceConfig['videoQuality'];
  if (options.encoding) deviceConfig.encoding = options.encoding as DeviceConfig['encoding'];
  if (options.artwork !== undefined) deviceConfig.artwork = options.artwork;
}

export interface ConfigResultLike {
  configPath?: string | undefined;
  config?: { devices?: Record<string, unknown> | undefined } | undefined;
}

/**
 * Resolve the two derived fields every add flow needs after deciding
 * which device shape to persist:
 *  - `isFirstDevice` → drives the "set as default" promotion + the
 *    `isDefault` JSON envelope flag.
 *  - `configPath` → falls back to `DEFAULT_CONFIG_PATH` when no config
 *    file was loaded (first-run flow).
 */
export function resolveIsFirstDeviceAndConfigPath(configResult: ConfigResultLike): {
  isFirstDevice: boolean;
  configPath: string;
} {
  const existingDevices = configResult.config?.devices ?? {};
  return {
    isFirstDevice: Object.keys(existingDevices).length === 0,
    configPath: configResult.configPath ?? DEFAULT_CONFIG_PATH,
  };
}

export interface PersistDeviceResult {
  /** Outcome of `addDevice`. `configPath` and `created` reflect the actual save target. */
  result: ReturnType<typeof addDevice>;
}

/**
 * Save a device to the config file and (if this is the first device)
 * promote it as the default. Throws `CliError(CONFIG_SAVE_FAILED)` on
 * persistence failure, matching the inline error shape that the three
 * call sites used.
 */
export function persistDeviceConfig(args: {
  name: string;
  deviceConfig: DeviceConfig;
  configPath: string;
  isFirstDevice: boolean;
  /** Forwarded to CliError.details on save failure for JSON consumers. */
  deviceInfoForErrorDetails: unknown;
}): PersistDeviceResult {
  const result = addDevice(args.name, args.deviceConfig, { configPath: args.configPath });

  if (!result.success) {
    throw new CliError({
      message: `Failed to save config: ${result.error}`,
      code: DeviceErrorCodes.CONFIG_SAVE_FAILED,
      details: { device: args.deviceInfoForErrorDetails },
    });
  }

  if (args.isFirstDevice) {
    setDefaultDevice(args.name, { configPath: args.configPath });
  }

  return { result };
}

/**
 * `podkit device add` — detect and add a device to the configured devices list.
 */
import { Command, Option } from 'commander';
import { confirm } from '../../utils/confirm.js';
import { existsSync, statSync } from '../../utils/fs.js';
import { getContext } from '../../context.js';
import { CliError, runAction } from '../../errors.js';
import {
  addDevice,
  setDefaultDevice,
  DEFAULT_CONFIG_PATH,
  QUALITY_PRESETS,
  VIDEO_QUALITY_PRESETS,
  ENCODING_MODES,
  DEVICE_TYPES,
} from '../../config/index.js';
import { validateCapabilityOverrides } from '@podkit/devices-mass-storage';
import { OutputContext, formatBytes, formatNumber, bold } from '../../output/index.js';
import {
  assessIpodIdentity,
  ensureSysInfoExtendedAndReassess,
  assessMassStorageDevice,
  isFilesystemUnsupportedHere,
  formatHfsplusOnLinuxRefusal,
  makeHfsplusOnLinuxUnsupportedReason,
  isIdentityFullyEmpty,
  summariseIdentitySignals,
  DOCS_URLS,
} from '@podkit/core';
import type { IpodIdentityAssessment, IdentitySignalSummary } from '@podkit/core';
import {
  isMassStorageDevice,
  getDeviceTypeDisplayName,
  getDeviceTypeRichDisplayName,
} from '../open-device.js';
import type { DeviceConfig } from '../../config/index.js';
import { DeviceErrorCodes } from './error-codes.js';
import { formatIFlashEvidence, formatIFlashMountExplanation, resolveDeviceName } from './shared.js';
import type { DeviceAddOutput } from './output-types.js';
import { stripDefaultOptionValues } from '../../utils/option-source.js';
import { confirmUnsupportedDeviceAdd } from './capability-summary.js';
import {
  SYSINFO_MISSING_PROMPT_LINES,
  printIpodDeviceAddSuccess,
  printMassStorageDeviceAddSuccess,
} from './add-render.js';

/**
 * Defensive refusal for TASK-317.15: we cannot persist a device that
 * doesn't carry a real filesystem UUID. podkit identifies iPods by
 * volumeUuid across replug cycles, so without one, downstream commands
 * (`podkit doctor -d <name>`, `podkit sync -d <name>`) can't find the
 * device. The dominant trigger (HFS+ on Linux) is handled explicitly by
 * TASK-317.12; this is the catch-all for corrupt FAT32 tables, unusual
 * filesystem layouts, mass-storage with no FS UUID, etc.
 *
 * Previously, `device add` silently substituted a synthetic
 * `manual-<base64-of-mount-path>` UUID, which collided between any two
 * devices mounted under the same parent dir and didn't survive replug.
 */
/**
 * Test-only escape hatch for the volumeUuid refusal in TASK-317.15. When
 * `PODKIT_TEST_SYNTHETIC_VOLUME_UUID=1` is set in the environment, this
 * returns a deterministic synthetic UUID derived from the mount path so
 * the dummy-iPod e2e target can complete `device add` without a real
 * filesystem behind it. Returns `undefined` when the env var is not set,
 * in which case the caller throws `VOLUME_UUID_REQUIRED`.
 *
 * Production safety: real users never set this variable. Documented in
 * `test-packages/e2e-tests/README.md`.
 */
function synthesizeTestVolumeUuid(path: string): string | undefined {
  if (process.env.PODKIT_TEST_SYNTHETIC_VOLUME_UUID !== '1') return undefined;
  const slug = Buffer.from(path).toString('base64').replace(/[/+=]/g, '').slice(0, 16);
  return `test-${slug}`;
}

/**
 * Throw the empty-identity refusal. Triggered when the cascade resolves
 * nothing at all — no SysInfoExtended access, no classic SysInfo on disk,
 * no USB fingerprint, no `--type` from the user. Persisting a config row
 * with empty identity strands later commands; refuse instead.
 *
 * Bypass via `--force` (explicit override) or `--no-firmware-inquiry`
 * (existing explicit consent).
 */
function throwEmptyIdentityRefusal(opts: { path: string | undefined }): never {
  const lines = [
    'Cannot add this device: no identifying signal is available.',
    '',
    '  • SysInfoExtended could not be read from firmware (USB inquiry path is closed).',
    '  • No classic SysInfo file was found on the device.',
    '  • USB enumeration did not resolve a product fingerprint.',
    '',
    'Persisting a device row with empty identity strands later commands ' +
      '(`podkit doctor`, `podkit sync`) — they cannot reliably identify the',
    'device on replug. Try one of:',
    '',
    '  • Re-mount the device read-write and check the USB connection, then retry.',
    '  • Pass --no-firmware-inquiry if you knowingly want to skip the firmware',
    '    inquiry (cascade-derived identity still applies when present).',
    '  • Pass --force to add the device anyway — some operations may behave',
    '    conservatively without identity.',
  ];
  throw new CliError({
    message: lines.join('\n'),
    code: DeviceErrorCodes.EMPTY_IDENTITY,
    details: { path: opts.path ?? '(unknown)' },
  });
}

/**
 * Print the partial-cascade warning when the device has some identity signal
 * but is missing the model-identifying anchor (SysInfoExtended or classic
 * SysInfo ModelNumStr). Absence of USB fingerprint alone is not actionable
 * for the user — it's transient and resolved on next assessment with USB.
 */
function warnPartialIdentity(out: OutputContext, _signals: IdentitySignalSummary): void {
  if (!out.isText) return;
  out.warn(
    'Unable to determine device model from disk — no SysInfoExtended or classic SysInfo. ' +
      'Proceeding with USB identity only; some operations may behave conservatively. ' +
      'Retry with the device re-mounted or re-plugged.'
  );
}

/**
 * Apply the empty-identity gate to the cascade result. Encapsulates the
 * three-way branch — block / `--force` / `--no-firmware-inquiry` — that
 * `--path` and scan paths both need, plus the partial-cascade warning.
 *
 * Throws `CliError(EMPTY_IDENTITY)` on the block path; otherwise returns,
 * having emitted any warnings as side effects.
 *
 * Single source of truth for the device-add identity policy. Tests pinning
 * the policy reference `isIdentityFullyEmpty` directly.
 */
function enforceIdentityGate(
  out: OutputContext,
  assessment: IpodIdentityAssessment | null,
  options: AddOptions,
  refusalPath: string | undefined
): void {
  const signals = summariseIdentitySignals(assessment, options.type);
  if (isIdentityFullyEmpty(assessment, options.type)) {
    if (options.force) {
      if (out.isText) {
        out.warn(
          'Proceeding with empty device identity (--force). ' +
            'Some operations may not behave correctly.'
        );
      }
      return;
    }
    if (options.firmwareInquiry === false) {
      if (out.isText) {
        out.warn(
          'Proceeding with empty device identity (--no-firmware-inquiry). ' +
            'Some operations may not behave correctly.'
        );
      }
      return;
    }
    throwEmptyIdentityRefusal({ path: refusalPath });
  }
  if (!signals.hasSysInfoExtended && !signals.hasSysInfoModelNumber) {
    warnPartialIdentity(out, signals);
  }
}

function throwVolumeUuidRequired(opts: {
  path: string | undefined;
  identifier: string;
  filesystem: string | null | undefined;
}): never {
  throw new CliError({
    message:
      'Cannot add iPod: this iPod does not have a readable filesystem UUID. ' +
      'podkit identifies iPods by volume UUID across replug cycles — without one, ' +
      'commands like `podkit doctor -d <name>` would fail to find the device.\n\n' +
      'Common causes: corrupt partition table, unusual filesystem layout. ' +
      `See: ${DOCS_URLS.troubleshooting}`,
    code: DeviceErrorCodes.VOLUME_UUID_REQUIRED,
    details: {
      path: opts.path ?? '(unknown)',
      identifier: opts.identifier,
      filesystem: opts.filesystem ?? null,
    },
  });
}

interface AddOptions {
  yes?: boolean;
  type?: string;
  quality?: string;
  audioQuality?: string;
  videoQuality?: string;
  encoding?: string;
  artwork?: boolean;
  artworkMaxResolution?: string;
  artworkSources?: string[];
  supportedAudioCodecs?: string[];
  supportsVideo?: boolean;
  musicDir?: string;
  moviesDir?: string;
  tvShowsDir?: string;
  /**
   * Skip the firmware inquiry that would write SysInfoExtended. Identity
   * still cascades through any classic SysInfo on disk and the USB product
   * ID, so for non-checksum devices this is a viable shortcut. Hash-based
   * generations still need SysInfoExtended for sync to succeed — the flag
   * is a "configure now, repair later" affordance.
   */
  firmwareInquiry?: boolean;
  /**
   * Override the empty-identity refusal. When `device add` resolves no
   * identifying signal (no SysInfoExtended access, no classic SysInfo, no
   * USB fingerprint), it refuses by default — a config row with empty
   * identity confuses downstream commands. `--force` records the user's
   * explicit consent to proceed anyway; expect later commands to behave
   * conservatively.
   */
  force?: boolean;
}

export const addSubcommand = new Command('add')
  .description('detect and add a device to config')
  .argument('[name]', 'device name (alternative to passing -d <name> at the program level)')
  .addOption(new Option('--type <type>', 'device type').choices([...DEVICE_TYPES]))
  .option('--path <path>', 'path to device mount point')
  .option('-y, --yes', 'skip confirmation prompts')
  .option(
    '--no-firmware-inquiry',
    'skip writing SysInfoExtended via USB firmware inquiry (iPod only)'
  )
  .option('--force', 'add the device even when no identifying signal is available (use sparingly)')
  .addOption(
    new Option('--quality <preset>', 'transcoding quality preset').choices([...QUALITY_PRESETS])
  )
  .addOption(
    new Option('--audio-quality <preset>', 'audio quality (overrides --quality)').choices([
      ...QUALITY_PRESETS,
    ])
  )
  .addOption(
    new Option('--video-quality <preset>', 'video quality (overrides --quality)').choices([
      ...QUALITY_PRESETS,
    ])
  )
  .addOption(new Option('--encoding <mode>', 'encoding mode').choices([...ENCODING_MODES]))
  .option('--artwork', 'sync artwork to this device')
  .option('--no-artwork', 'do not sync artwork to this device')
  .option(
    '--artwork-max-resolution <pixels>',
    'max artwork resolution in pixels (mass-storage only)'
  )
  .option(
    '--artwork-sources <sources...>',
    'artwork sources: database, embedded, sidecar (mass-storage only)'
  )
  .option(
    '--supported-audio-codecs <codecs...>',
    'supported audio codecs: aac, alac, mp3, flac, ogg, opus (mass-storage only; wav/aiff sources are transcoded)'
  )
  .option('--supports-video', 'device supports video playback (mass-storage only)')
  .option('--no-supports-video', 'device does not support video playback (mass-storage only)')
  .option(
    '--music-dir <name>',
    'music directory name on device (default: Music, mass-storage only)'
  )
  .option(
    '--movies-dir <name>',
    'movies directory name on device (default: Video/Movies, mass-storage only)'
  )
  .option(
    '--tv-shows-dir <name>',
    'TV shows directory name on device (default: Video/Shows, mass-storage only)'
  )
  .action(
    async (
      positionalName: string | undefined,
      options: AddOptions & { path?: string },
      command
    ) => {
      const { globalOpts } = getContext();
      const out = OutputContext.fromGlobalOpts(globalOpts);
      // Drop Commander's synthesised `--no-X` defaults so unspecified flags
      // don't silently write `artwork: true` (etc.) into the new device
      // config on every `device add` run.
      const cleaned = stripDefaultOptionValues(options, command);
      await runAction(out, () => runDeviceAdd({ ...cleaned, name: positionalName }, out));
    }
  );

/**
 * Dependency injection seam for `runDeviceAdd`. Tests pass stubs to avoid
 * real USB walks / disk operations / interactive prompts. Production passes
 * nothing — the defaults are the real implementations.
 */
export interface DeviceAddDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
  confirm?: (msg: string) => Promise<boolean>;
  loadCore?: () => Promise<typeof import('@podkit/core')>;
  /**
   * Override for `process.platform`. Tests use this to exercise the
   * HFS+-on-Linux refusal (TASK-317.12) from a macOS or Linux test runner
   * without mutating the global `process` object.
   */
  platform?: NodeJS.Platform | string;
  /**
   * Override the cascade-driven identity assessment — tests inject the
   * model + capabilities + firmware-inquiry state without writing a synthetic
   * mount-point fixture. Production uses `assessIpodIdentity` from
   * `@podkit/core`.
   */
  assessIdentity?: (mountPoint: string) => Promise<import('@podkit/core').IpodIdentityAssessment>;
  /**
   * Override the SysInfoExtended write step. Tests assert that this fires
   * (or doesn't, under `--no-firmware-inquiry`) without performing real
   * USB I/O. Production uses `ensureSysInfoExtended` from `@podkit/core`.
   */
  ensureSysInfoExtended?: typeof import('@podkit/core').ensureSysInfoExtended;
  /**
   * Override the iPod database adapter. Tests stub `hasDatabase` / `open` /
   * `initializeIpod` so the runner doesn't load native libgpod bindings.
   */
  ipodDatabase?: {
    hasDatabase: (path: string) => Promise<boolean>;
    open: (path: string) => Promise<{ trackCount: number; close: () => void }>;
    initializeIpod: (path: string) => Promise<{ close: () => void }>;
  };
}

/**
 * `device add` runner — testable in-process.
 *
 * Extracted from the action callback. The body is unchanged; tests construct
 * an OutputContext with BufferSinks, call this directly, then assert on
 * captured output + `process.exitCode`. Use `deps` to inject fakes for the
 * device manager, confirm prompts, and the dynamic `@podkit/core` import.
 */
export async function runDeviceAdd(
  options: AddOptions & { path?: string; name?: string },
  out: OutputContext,
  deps: DeviceAddDeps = {}
): Promise<void> {
  const { globalOpts, configResult } = getContext();
  const name = resolveDeviceName(options.name, globalOpts.device, 'add');
  const explicitPath = options.path;
  const autoConfirm = options.yes ?? false;
  const confirmFn = deps.confirm ?? confirm;
  const loadCore = deps.loadCore ?? (() => import('@podkit/core'));
  const assessIdentity = deps.assessIdentity ?? assessIpodIdentity;
  const platform = deps.platform ?? process.platform;

  // Validate device name
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    throw new CliError({
      message:
        'Invalid device name. Must start with a letter and contain only letters, numbers, hyphens, and underscores.',
      code: DeviceErrorCodes.INVALID_DEVICE_NAME,
    });
  }

  const existingDevices = configResult.config.devices || {};
  if (name in existingDevices) {
    throw new CliError({
      message: `Device "${name}" already exists in config. Use a different name or remove it first.`,
      code: DeviceErrorCodes.DEVICE_EXISTS,
    });
  }

  // Validate quality options
  if (options.quality !== undefined && !QUALITY_PRESETS.includes(options.quality as any)) {
    throw new CliError({
      message: `Invalid quality preset "${options.quality}". Valid values: ${QUALITY_PRESETS.join(', ')}`,
      code: DeviceErrorCodes.INVALID_QUALITY,
    });
  }
  if (
    options.audioQuality !== undefined &&
    !QUALITY_PRESETS.includes(options.audioQuality as any)
  ) {
    throw new CliError({
      message: `Invalid audio quality preset "${options.audioQuality}". Valid values: ${QUALITY_PRESETS.join(', ')}`,
      code: DeviceErrorCodes.INVALID_AUDIO_QUALITY,
    });
  }
  if (
    options.videoQuality !== undefined &&
    !VIDEO_QUALITY_PRESETS.includes(options.videoQuality as any)
  ) {
    throw new CliError({
      message: `Invalid video quality preset "${options.videoQuality}". Valid values: ${VIDEO_QUALITY_PRESETS.join(', ')}`,
      code: DeviceErrorCodes.INVALID_VIDEO_QUALITY,
    });
  }
  if (options.encoding !== undefined && options.encoding !== 'vbr' && options.encoding !== 'cbr') {
    throw new CliError({
      message: `Invalid encoding mode "${options.encoding}". Valid values: vbr, cbr`,
      code: DeviceErrorCodes.INVALID_ENCODING,
    });
  }

  // =========================================================================
  // Mass-storage device flow (--type echo-mini|rockbox|generic)
  // =========================================================================
  const deviceType = options.type;

  if (deviceType && isMassStorageDevice(deviceType)) {
    // Mass-storage devices require --path
    if (!explicitPath) {
      throw new CliError({
        message: `--path is required for ${getDeviceTypeDisplayName({ type: deviceType })} devices. Usage: podkit device add -d <name> --type ${deviceType} --path <mount-point>`,
        code: DeviceErrorCodes.PATH_REQUIRED,
      });
    }

    // Verify path exists and is a directory
    if (!existsSync(explicitPath) || !statSync(explicitPath).isDirectory()) {
      throw new CliError({
        message: existsSync(explicitPath)
          ? `Path is not a directory: ${explicitPath}`
          : `Path not found: ${explicitPath}`,
        code: existsSync(explicitPath)
          ? DeviceErrorCodes.PATH_NOT_DIRECTORY
          : DeviceErrorCodes.PATH_NOT_FOUND,
      });
    }

    // Validate capability override options
    const capabilityOverridePatch: Parameters<typeof validateCapabilityOverrides>[0] = {};
    if (options.artworkMaxResolution !== undefined) {
      capabilityOverridePatch.artworkMaxResolution = parseInt(options.artworkMaxResolution, 10);
    }
    if (options.artworkSources !== undefined) {
      capabilityOverridePatch.artworkSources = options.artworkSources as any;
    }
    if (options.supportedAudioCodecs !== undefined) {
      capabilityOverridePatch.supportedAudioCodecs = options.supportedAudioCodecs as any;
    }
    const capabilityValidation = validateCapabilityOverrides(capabilityOverridePatch);
    if (!capabilityValidation.ok) {
      const [first] = capabilityValidation.errors;
      if (first) {
        throw new CliError({
          message: first.message,
          code: DeviceErrorCodes[first.code as keyof typeof DeviceErrorCodes],
        });
      }
    }

    // Resolve preset + capabilities through the symmetric core helper.
    // Today this catches typo'd preset ids defensively; once TASK-325 wires
    // user-defined presets the same call surface will accept them.
    const assessment = assessMassStorageDevice(explicitPath, {
      presetId: deviceType,
      overrides: capabilityOverridePatch,
    });
    if (!assessment.preset) {
      throw new CliError({
        message: `Unknown device preset "${deviceType}".`,
        code: DeviceErrorCodes.UNSUPPORTED_DEVICE,
      });
    }

    const deviceConfig: DeviceConfig = {
      type: deviceType as DeviceConfig['type'],
      path: explicitPath,
    };
    if (options.quality) deviceConfig.quality = options.quality as any;
    if (options.audioQuality) deviceConfig.audioQuality = options.audioQuality as any;
    if (options.videoQuality) deviceConfig.videoQuality = options.videoQuality as any;
    if (options.encoding) deviceConfig.encoding = options.encoding as any;
    if (options.artwork !== undefined) deviceConfig.artwork = options.artwork;
    if (options.artworkMaxResolution !== undefined)
      deviceConfig.artworkMaxResolution = parseInt(options.artworkMaxResolution, 10);
    if (options.artworkSources !== undefined)
      deviceConfig.artworkSources = options.artworkSources as any;
    if (options.supportedAudioCodecs !== undefined)
      deviceConfig.supportedAudioCodecs = options.supportedAudioCodecs as any;
    if (options.supportsVideo !== undefined) deviceConfig.supportsVideo = options.supportsVideo;
    if (options.musicDir !== undefined) deviceConfig.musicDir = options.musicDir;
    if (options.moviesDir !== undefined) deviceConfig.moviesDir = options.moviesDir;
    if (options.tvShowsDir !== undefined) deviceConfig.tvShowsDir = options.tvShowsDir;

    const volumeName = explicitPath.split('/').pop() || name;
    const deviceCount = Object.keys(existingDevices).length;
    const isFirstDevice = deviceCount === 0;
    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;

    const deviceInfo = {
      name,
      identifier: 'mass-storage',
      volumeName,
      volumeUuid: '',
      size: 0,
      isMounted: true,
      mountPoint: explicitPath,
    };

    // Interactive confirmation (skip if auto-confirm or JSON mode)
    if (!autoConfirm && out.isText) {
      out.newline();
      out.print(`Adding ${getDeviceTypeDisplayName({ type: deviceType })} device:`);
      out.print(`  Name:   ${name}`);
      // Rich form here (`FiiO Snowsky Echo Mini (echo-mini)`) so the user
      // sees the exact `--type` token alongside vendor + product name.
      // No per-device overrides yet at `add` time — those land in config
      // after this confirmation, so subsequent `device info` calls will
      // see them.
      out.print(`  Type:   ${getDeviceTypeRichDisplayName({ type: deviceType })}`);
      out.print(`  Path:   ${explicitPath}`);
      out.newline();

      const shouldSave = await confirmFn(`Add this device as "${name}"?`);
      if (!shouldSave) {
        out.print('Cancelled. No changes made.');
        return;
      }
    }

    // Save device to config
    const result = addDevice(name, deviceConfig, { configPath });

    if (!result.success) {
      throw new CliError({
        message: `Failed to save config: ${result.error}`,
        code: DeviceErrorCodes.CONFIG_SAVE_FAILED,
        details: { device: deviceInfo },
      });
    }

    if (isFirstDevice) {
      setDefaultDevice(name, { configPath });
    }

    out.result<DeviceAddOutput>(
      {
        success: true,
        device: deviceInfo,
        saved: true,
        configPath: result.configPath,
        isDefault: isFirstDevice,
      },
      () =>
        printMassStorageDeviceAddSuccess(out, {
          name,
          deviceType: deviceType as NonNullable<DeviceConfig['type']>,
          configResult: { created: result.created ?? false, configPath: result.configPath ?? '' },
          isFirstDevice,
        })
    );
    return;
  }

  // =========================================================================
  // iPod device flow (--type ipod or no --type)
  // =========================================================================

  // Reject mass-storage-only options on iPod devices
  const massStorageOnlyOptions = [
    options.artworkMaxResolution !== undefined && '--artwork-max-resolution',
    options.artworkSources !== undefined && '--artwork-sources',
    options.supportedAudioCodecs !== undefined && '--supported-audio-codecs',
    options.supportsVideo !== undefined && '--supports-video',
    options.musicDir !== undefined && '--music-dir',
    options.moviesDir !== undefined && '--movies-dir',
    options.tvShowsDir !== undefined && '--tv-shows-dir',
  ].filter(Boolean) as string[];

  if (massStorageOnlyOptions.length > 0) {
    throw new CliError({
      message: `${massStorageOnlyOptions.join(', ')} ${massStorageOnlyOptions.length === 1 ? 'is' : 'are'} only valid for mass-storage devices (--type echo-mini|rockbox|generic).`,
      code: DeviceErrorCodes.INVALID_OPTION_FOR_TYPE,
    });
  }

  // Load core dependencies (overridable via deps.loadCore for tests)
  let core: typeof import('@podkit/core');
  let IpodDatabase: typeof import('@podkit/core').IpodDatabase | DeviceAddDeps['ipodDatabase'];

  try {
    core = await loadCore();
    IpodDatabase = deps.ipodDatabase ?? core.IpodDatabase;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
    throw new CliError({
      message: `Failed to load podkit-core: ${message}`,
      code: DeviceErrorCodes.CORE_LOAD_FAILED,
    });
  }

  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();

  // If explicit path provided, use it directly
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new CliError({
        message: `Path not found: ${explicitPath}`,
        code: DeviceErrorCodes.PATH_NOT_FOUND,
      });
    }

    // Refuse HFS+ iPods on Linux up-front — before any state-mutating work
    // (volumeUuid lookup, DB init, config save). See TASK-317.12 +
    // `filesystem-policy.ts` for the policy rationale.
    if (manager.isSupported) {
      const platformDevices = await manager.listDevices();
      // Normalize trailing slashes — `--path /media/x/disk/` from shell completion
      // must still match `/media/x/disk` returned by lsblk.
      const stripSlash = (p: string) => p.replace(/\/+$/, '') || p;
      const wantPath = stripSlash(explicitPath);
      const matching = platformDevices.find(
        (d) => d.mountPoint && stripSlash(d.mountPoint) === wantPath
      );
      if (matching && isFilesystemUnsupportedHere(matching.storage.filesystem, platform)) {
        throw new CliError({
          message: formatHfsplusOnLinuxRefusal().join('\n'),
          code: DeviceErrorCodes.UNSUPPORTED_FILESYSTEM_ON_LINUX,
          details: {
            filesystem: matching.storage.filesystem,
            platform,
            path: explicitPath,
            unsupported: makeHfsplusOnLinuxUnsupportedReason({
              ...(matching.storage.filesystem ? { filesystem: matching.storage.filesystem } : {}),
              path: explicitPath,
            }),
          },
        });
      }
    }

    // Cascade-driven identity assessment (no writes, no prompts).
    let assessment: IpodIdentityAssessment = await assessIdentity(explicitPath);

    // Empty-identity gate. If the cascade resolved literally nothing — no
    // SysInfoExtended path, no classic SysInfo on disk, no USB fingerprint —
    // refuse unless the user explicitly opted in via `--force`,
    // `--no-firmware-inquiry`, or `--type`. Partial cascades warn-and-proceed.
    enforceIdentityGate(out, assessment, options, explicitPath);

    // Known-unsupported generations: warn-and-allow (TASK-317.03). The user
    // gets the canonical message and an explicit Y/n prompt; `--yes` flips
    // the default to accept. On confirmation we persist `unsupported: true`.
    const unsupportedDecision = await confirmUnsupportedDeviceAdd(out, assessment, {
      autoConfirm,
      confirmFn,
    });
    if (unsupportedDecision === 'cancelled') {
      out.print('Cancelled. No changes made.');
      return;
    }
    const recordUnsupported = unsupportedDecision === 'add-anyway';

    const identityDisplayName = assessment.model?.displayName ?? 'Unknown iPod';

    if (!autoConfirm && out.isText) {
      out.newline();
      out.print(`iPod at path: ${identityDisplayName}`);
      out.print(`  Path:        ${explicitPath}`);
    }

    // Database init / track-count read.
    const hasDb = await IpodDatabase.hasDatabase(explicitPath);
    let trackCount = 0;
    let initialized = false;

    if (!hasDb) {
      out.print('');
      out.print('This iPod needs to be initialized (no iTunesDB found).');

      const shouldInit =
        autoConfirm || out.isJson || (await confirmFn('Initialize iPod database now?'));

      if (!shouldInit) {
        out.print('Cancelled. iPod not initialized.');
        return;
      }

      try {
        out.print('Initializing iPod database...');
        const ipod = await IpodDatabase.initializeIpod(explicitPath);
        ipod.close();
        initialized = true;
        out.print(`Initialized as ${identityDisplayName}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CliError({
          message: `Failed to initialize iPod: ${message}`,
          code: DeviceErrorCodes.INIT_FAILED,
        });
      }
    } else {
      try {
        const ipod = await IpodDatabase.open(explicitPath);
        try {
          trackCount = ipod.trackCount;
        } finally {
          ipod.close();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        out.verbose1(`Warning: Could not read database: ${message}`);
      }
    }

    if (!autoConfirm && out.isText) {
      out.print(`  Tracks:      ${formatNumber(trackCount)}`);
    }

    // Get volume UUID if possible (for macOS)
    let volumeUuid = '';
    let volumeName = explicitPath.split('/').pop() || 'iPod';
    let matchingIdentifier = 'unknown';
    let matchingFilesystem: string | null | undefined;

    if (manager.isSupported) {
      const ipods = await manager.findIpodDevices();
      const matchingDevice = ipods.find((d) => d.isMounted && d.mountPoint === explicitPath);
      if (matchingDevice) {
        volumeUuid = matchingDevice.volumeUuid;
        volumeName = matchingDevice.volumeName;
        matchingIdentifier = matchingDevice.identifier;
        matchingFilesystem = matchingDevice.storage.filesystem;
      }
    }

    // TASK-317.15: refuse cleanly when no real filesystem UUID is available.
    // Replaces the legacy `manual-${base64(path)}` synthetic-UUID fallback,
    // which collided between any two devices mounted under the same parent
    // dir and didn't survive replug. The HFS+-on-Linux case is already
    // caught earlier by TASK-317.12; this is the residual defensive layer.
    if (!volumeUuid || volumeUuid.startsWith('manual-')) {
      const syntheticUuid = synthesizeTestVolumeUuid(explicitPath);
      if (syntheticUuid) {
        volumeUuid = syntheticUuid;
      } else {
        throwVolumeUuidRequired({
          path: explicitPath,
          identifier: matchingIdentifier,
          filesystem: matchingFilesystem,
        });
      }
    }

    const deviceInfo = {
      name,
      identifier: 'unknown',
      volumeName,
      volumeUuid,
      size: 0,
      isMounted: true,
      mountPoint: explicitPath,
      trackCount,
      modelName: identityDisplayName,
    };

    const deviceCount = Object.keys(existingDevices).length;
    const isFirstDevice = deviceCount === 0;
    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
    const deviceConfig: DeviceConfig = { volumeUuid, volumeName };
    if (recordUnsupported) {
      deviceConfig.unsupported = {
        kind: assessment.model?.unsupportedReason?.kind ?? 'unsupported-device',
        confirmedAt: new Date().toISOString(),
      };
    }
    if (options.quality) deviceConfig.quality = options.quality as any;
    if (options.audioQuality) deviceConfig.audioQuality = options.audioQuality as any;
    if (options.videoQuality) deviceConfig.videoQuality = options.videoQuality as any;
    if (options.encoding) deviceConfig.encoding = options.encoding as any;
    if (options.artwork !== undefined) deviceConfig.artwork = options.artwork;

    // Single combined prompt: config persistence + (optional) firmware inquiry.
    // Skip the SIE write entirely when persisting an unsupported device — the
    // user has acknowledged the device won't sync; writing identity files to
    // it is wasted effort and can fail against synthetic / non-writable paths.
    const offerFirmwareInquiry =
      assessment.firmwareInquiry === 'missing' &&
      options.firmwareInquiry !== false &&
      !recordUnsupported;

    if (!autoConfirm && out.isText) {
      if (offerFirmwareInquiry) {
        out.newline();
        for (const line of SYSINFO_MISSING_PROMPT_LINES) out.print(line);
        out.newline();
      } else {
        out.newline();
      }
      const promptText = offerFirmwareInquiry
        ? `Add this iPod as "${name}" and write SysInfoExtended?`
        : `Add this iPod as "${name}"?`;
      const shouldSave = await confirmFn(promptText);
      if (!shouldSave) {
        out.print('Cancelled. No changes made.');
        return;
      }
    } else if (
      assessment.needsChecksum &&
      !offerFirmwareInquiry &&
      options.firmwareInquiry === false
    ) {
      if (out.isText) {
        out.warn(
          `This iPod's generation requires SysInfoExtended for the iTunesDB checksum. ` +
            'Skipping firmware inquiry will leave it unsynced. ' +
            'Run `podkit doctor --repair sysinfo-extended` later.'
        );
      }
    }

    // Perform the firmware inquiry now if opted in. The core helper handles
    // the write → re-assess lifecycle; we surface a non-fatal warning on
    // failure and continue (doctor --repair can retry later).
    let firmwareWritten = false;
    if (offerFirmwareInquiry) {
      const r = await ensureSysInfoExtendedAndReassess(explicitPath, assessment, {
        assessIdentity: deps.assessIdentity,
        ensureSysInfoExtended: deps.ensureSysInfoExtended,
      });
      assessment = r.assessment;
      firmwareWritten = r.firmwareWritten;
      if (r.sysInfoWriteError && out.isText) {
        out.warn(`Failed to read SysInfoExtended from USB: ${r.sysInfoWriteError}`);
        out.print('  Run `podkit doctor --repair sysinfo-extended` to retry.');
      }
    }

    const result = addDevice(name, deviceConfig, { configPath });

    if (!result.success) {
      throw new CliError({
        message: `Failed to save config: ${result.error}`,
        code: DeviceErrorCodes.CONFIG_SAVE_FAILED,
        details: { device: deviceInfo },
      });
    }

    if (isFirstDevice) {
      setDefaultDevice(name, { configPath });
    }

    const finalDisplayName = assessment.model?.displayName ?? identityDisplayName;
    deviceInfo.modelName = finalDisplayName;

    out.result<DeviceAddOutput>(
      {
        success: true,
        device: deviceInfo,
        initialized,
        saved: true,
        configPath: result.configPath,
        isDefault: isFirstDevice,
      },
      () =>
        printIpodDeviceAddSuccess(out, {
          name,
          modelDisplay: finalDisplayName,
          capabilities: assessment.capabilities,
          firmwareWritten,
          isFirstDevice,
          initialized,
        })
    );
    return;
  }

  // No explicit path - scan for devices
  if (!manager.isSupported) {
    throw new CliError({
      message: `Device scanning is not supported on ${manager.platform}. Specify a path explicitly: podkit device add -d <name> --path <path>`,
      code: DeviceErrorCodes.SCAN_UNSUPPORTED,
    });
  }

  out.print('Scanning for attached devices...');

  const ipods = await manager.findIpodDevices();

  if (ipods.length === 0) {
    // Disk scan found nothing. Before the generic "no iPod found" message,
    // enrich the surface by consulting the USB bus directly: an iPod touch
    // (or any iOS device) has no mass-storage mount, so disk scan never sees
    // it. The USB classifier maps Apple-vendor unsupported PIDs to the
    // canonical reason payload — surface that instead of leaving the user
    // staring at "make sure your iPod is connected".
    let iosUnsupportedReason: import('@podkit/core').ReadinessUnsupportedReason | undefined;
    let iosUnsupportedDisplay: string | undefined;
    try {
      const coreMod = await loadCore();
      const enumerated = await coreMod.enumerateUsb();
      const classified = coreMod.classifyUsbDevices(enumerated);
      const unsupportedIpod = classified.find(
        (c): c is Extract<typeof c, { kind: 'ipod' }> => c.kind === 'ipod' && c.supported === false
      );
      if (unsupportedIpod) {
        const pid = parseInt(unsupportedIpod.device.productId.replace(/^0x/i, ''), 16);
        const isIosRange = Number.isFinite(pid) && pid >= 0x1290 && pid <= 0x12af;
        iosUnsupportedDisplay =
          unsupportedIpod.model?.displayName ?? (isIosRange ? 'iOS device' : 'Unsupported iPod');
        // `classifyAsIpod` already attaches the canonical typed payload.
        // Fall back to a synthesised reason only when the classifier somehow
        // returned `supported: false` without one (defensive — currently
        // unreachable on the iPod cascade path).
        iosUnsupportedReason = unsupportedIpod.unsupportedReason ?? {
          kind: isIosRange ? 'ios-device' : 'unsupported-device',
          headline: `${iosUnsupportedDisplay} is not supported by podkit.`,
          docsUrl: DOCS_URLS.supportedDevices,
        };
      }
    } catch {
      // USB enumeration is best-effort; fall through.
    }

    if (iosUnsupportedReason) {
      const lines = [iosUnsupportedReason.headline];
      if (iosUnsupportedReason.details) lines.push(...iosUnsupportedReason.details);
      lines.push(`  See: ${iosUnsupportedReason.docsUrl ?? DOCS_URLS.supportedDevices}`);
      throw new CliError({
        message: lines.join('\n'),
        code: DeviceErrorCodes.UNSUPPORTED_DEVICE,
        details: {
          model: iosUnsupportedDisplay,
          unsupported: iosUnsupportedReason,
        },
      });
    }

    // No iPod found via the manager. Ask each device provider whether it sees
    // an attached device it can describe an "add me" hint for — currently only
    // mass-storage providers implement describeAddIntent, but the contract is
    // open so any future provider (e.g. iPod USB-only) plugs in here.
    let suggestedIntent: import('@podkit/core').DeviceAddIntent | undefined;
    try {
      const { suggestAddIntents } = await loadCore();
      const { ipodProvider } = await import('@podkit/devices-ipod');
      const { createMassStorageProvider, BUILT_IN_PRESETS } =
        await import('@podkit/devices-mass-storage');
      const intents = await suggestAddIntents({
        providers: [ipodProvider, createMassStorageProvider(BUILT_IN_PRESETS)],
      });
      suggestedIntent = intents[0];
    } catch {
      // Enumeration is best-effort: if it fails (e.g. USB walk errors),
      // fall through to the original "no iPod found" error path.
    }

    if (!suggestedIntent) {
      throw new CliError({
        message:
          'No iPod devices found. Make sure your iPod is connected, or specify a path explicitly with --path.',
        code: DeviceErrorCodes.NO_IPOD,
      });
    }

    const displayName = getDeviceTypeDisplayName({ type: suggestedIntent.kind });
    out.print(`Detected ${displayName} via USB.`);
    // Only render the "To add it, run:" block when the intent supplied
    // a concrete command. Empty addArgs means "no command differs from
    // what you just ran" — the notes carry the user-facing guidance.
    if (suggestedIntent.addArgs.length > 0) {
      out.print('To add it, run:');
      out.print(`  podkit device add -d ${name} ${suggestedIntent.addArgs.join(' ')}`);
    }
    for (const note of suggestedIntent.notes ?? []) {
      out.print(`  ${note}`);
    }

    const detailMessage =
      suggestedIntent.addArgs.length > 0
        ? `Detected ${suggestedIntent.kind} device — add with ${suggestedIntent.addArgs.join(' ')}`
        : `Detected ${suggestedIntent.kind} device — see notes above`;
    throw new CliError({
      message: detailMessage,
      code: DeviceErrorCodes.DETECTED_MASS_STORAGE,
      details: { kind: suggestedIntent.kind, providerId: suggestedIntent.providerId },
    });
  }

  // Multiple iPods found - error with guidance
  if (ipods.length > 1) {
    if (out.isText) {
      out.newline();
      for (const ipod of ipods) {
        const path = ipod.isMounted ? ipod.mountPoint : ipod.identifier;
        out.error(`  podkit device add -d ${name} --path ${path}`);
        out.error(`    ${ipod.volumeName || '(unnamed)'} - ${formatBytes(ipod.storage.sizeBytes)}`);
        out.newline();
      }
    }
    throw new CliError({
      message: `Multiple iPod devices found (${ipods.length}). Specify a path explicitly.`,
      code: DeviceErrorCodes.MULTIPLE_IPODS,
      details: {
        ipods: ipods.map((d) => ({
          identifier: d.identifier,
          mountPoint: d.isMounted ? d.mountPoint : undefined,
          volumeName: d.volumeName,
          size: d.storage.sizeBytes,
        })),
      },
    });
  }

  let ipod = ipods[0]!;

  // Refuse HFS+ iPods on Linux up-front — before mount attempts, identity
  // assessment, or any state-mutating work. See TASK-317.12.
  if (isFilesystemUnsupportedHere(ipod.storage.filesystem, platform)) {
    const path = ipod.isMounted ? ipod.mountPoint : `/dev/${ipod.identifier}`;
    throw new CliError({
      message: formatHfsplusOnLinuxRefusal().join('\n'),
      code: DeviceErrorCodes.UNSUPPORTED_FILESYSTEM_ON_LINUX,
      details: {
        filesystem: ipod.storage.filesystem,
        platform,
        path,
        unsupported: makeHfsplusOnLinuxUnsupportedReason({
          ...(ipod.storage.filesystem ? { filesystem: ipod.storage.filesystem } : {}),
          path,
        }),
      },
    });
  }

  // TASK-317.15: refuse cleanly when the scan-found iPod has no readable
  // filesystem UUID. HFS+ on Linux is already caught above; this is the
  // catch-all for corrupt FAT32, unusual layouts, etc. Without a real
  // UUID we cannot identify the device across replug cycles.
  if (!ipod.volumeUuid || ipod.volumeUuid.startsWith('manual-')) {
    const probePath = ipod.isMounted ? ipod.mountPoint : `/dev/${ipod.identifier}`;
    const syntheticUuid = synthesizeTestVolumeUuid(probePath);
    if (syntheticUuid) {
      ipod = { ...ipod, volumeUuid: syntheticUuid };
    } else {
      throwVolumeUuidRequired({
        path: probePath,
        identifier: ipod.identifier,
        filesystem: ipod.storage.filesystem,
      });
    }
  }

  // Handle unmounted device: assess, attempt mount, guide user if sudo required
  if (!ipod.isMounted) {
    const assessment = await manager.assessDevice(ipod.identifier);

    out.newline();
    out.print(
      `Found iPod: ${ipod.volumeName} (${formatBytes(ipod.storage.sizeBytes)}) — not mounted`
    );
    if (assessment?.usb?.productId) {
      const { identify } = await loadCore();
      const assessModel = identify({ from: 'usb', productId: assessment.usb.productId });
      out.print(
        `  Model:   ${assessModel?.displayName ?? `iPod (USB ${assessment.usb.productId})`}`
      );
    }
    if (assessment?.iFlash.confirmed) {
      out.print(
        `  Storage: iFlash confirmed — ${formatIFlashEvidence(assessment.iFlash.evidence)}`
      );
    }
    out.newline();
    out.print('Attempting to mount...');

    const mountResult = await manager.mount(ipod.identifier);

    if (mountResult.success && mountResult.mountPoint) {
      out.print(`Mounted at ${mountResult.mountPoint}.`);
      // Re-fetch device info so subsequent code has the mount point
      const updated = await manager.findByVolumeUuid(ipod.volumeUuid);
      if (updated?.isMounted) ipod = updated;
    } else if (mountResult.requiresSudo) {
      const explanationLines = assessment?.iFlash.confirmed
        ? formatIFlashMountExplanation(assessment)
        : ['Mounting requires elevated privileges.'];
      if (out.isText) {
        for (const line of explanationLines) {
          out.error(line);
        }
        out.newline();
        out.error(`Run:  ${bold('sudo')} podkit device add -d ${name}`);
      }
      throw new CliError({
        message: 'Elevated privileges required to mount device',
        code: DeviceErrorCodes.MOUNT_REQUIRES_SUDO,
        details: { explanation: explanationLines },
      });
    } else {
      throw new CliError({
        message: `Failed to mount: ${mountResult.error ?? 'unknown error'}`,
        code: DeviceErrorCodes.MOUNT_FAILED,
      });
    }
  }

  // Assess identity from disk + USB without writing anything. The cascade
  // resolves model + capabilities from the most specific signal we have:
  // SysInfoExtended → classic SysInfo ModelNumStr → USB product ID.
  // This runs before database init so SysInfoExtended is available for the
  // hash58/72/AB checksum stack when we eventually write it.
  let assessment: IpodIdentityAssessment | null = null;
  if (ipod.isMounted) {
    assessment = await assessIdentity(ipod.mountPoint);
  }

  // Empty-identity gate (mirrors the --path branch above).
  // The scan branch can still proceed when we identified the iPod via the
  // OS-level device walk (volume UUID, mount point) even though the cascade
  // resolved nothing — the user is plainly looking at a recognised iPod —
  // but persisting a config row without any model/USB/SysInfo signal still
  // strands downstream commands that depend on identity. Same gate.
  enforceIdentityGate(
    out,
    assessment,
    options,
    ipod.isMounted ? ipod.mountPoint : `/dev/${ipod.identifier}`
  );

  // Known-unsupported generations (touch_*, nano_6/7, shuffle_3g/4g, iOS): warn-allow.
  // The cascade-resolved model carries `unsupportedReason`; we surface the
  // canonical message and prompt explicitly. On confirmation we mark the
  // persisted device with `unsupported: true` so `sync` + mutating
  // `doctor --repair` flows can still refuse.
  const scanUnsupportedDecision = await confirmUnsupportedDeviceAdd(out, assessment, {
    autoConfirm,
    confirmFn,
  });
  if (scanUnsupportedDecision === 'cancelled') {
    out.print('Cancelled. No changes made.');
    return;
  }
  const recordUnsupportedScan = scanUnsupportedDecision === 'add-anyway';

  // Render identity to the user before any prompts. Cascade-derived display
  // name; USB product ID is enough for the nano 2G "empty SysInfo" case.
  const identityDisplayName = assessment?.model?.displayName ?? 'Unknown iPod';
  if (!autoConfirm && out.isText) {
    out.newline();
    out.print(`Found ${identityDisplayName}:`);
    out.print(`  Name:        ${ipod.volumeName || '(unnamed)'}`);
    out.print(`  Mount:       ${ipod.isMounted ? ipod.mountPoint : '(not mounted)'}`);
    out.print(`  Capacity:    ${formatBytes(ipod.storage.sizeBytes)}`);
    out.print(`  Volume UUID: ${ipod.volumeUuid}`);
    out.print(`  Device:      /dev/${ipod.identifier}`);
  }

  // Database init / track-count read (model name comes from cascade, not libgpod).
  let trackCount = 0;
  let initialized = false;

  if (ipod.isMounted) {
    const mountPoint = ipod.mountPoint;
    const hasDb = await IpodDatabase.hasDatabase(mountPoint);

    if (!hasDb) {
      out.newline();
      out.print('This iPod needs to be initialized (no iTunesDB found).');

      const shouldInit =
        autoConfirm || out.isJson || (await confirmFn('Initialize iPod database now?'));

      if (!shouldInit) {
        out.print('Cancelled. iPod not initialized.');
        return;
      }

      try {
        out.print('Initializing iPod database...');
        const db = await IpodDatabase.initializeIpod(mountPoint);
        db.close();
        initialized = true;
        out.print(`Initialized as ${identityDisplayName}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CliError({
          message: `Failed to initialize iPod: ${message}`,
          code: DeviceErrorCodes.INIT_FAILED,
        });
      }
    } else {
      try {
        const db = await IpodDatabase.open(mountPoint);
        try {
          trackCount = db.trackCount;
        } finally {
          db.close();
        }
      } catch {
        // Couldn't read database info, continue anyway
      }
    }
  }

  if (!autoConfirm && out.isText) {
    out.print(`  Tracks:      ${formatNumber(trackCount)}`);
  }

  const deviceInfo = {
    name,
    identifier: ipod.identifier,
    volumeName: ipod.volumeName,
    volumeUuid: ipod.volumeUuid,
    size: ipod.storage.sizeBytes,
    isMounted: ipod.isMounted,
    mountPoint: ipod.isMounted ? ipod.mountPoint : undefined,
    trackCount,
    modelName: identityDisplayName,
  };

  const deviceCount = Object.keys(existingDevices).length;
  const isFirstDevice = deviceCount === 0;
  const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
  const deviceConfig: DeviceConfig = {
    volumeUuid: ipod.volumeUuid,
    volumeName: ipod.volumeName,
  };
  if (recordUnsupportedScan) {
    deviceConfig.unsupported = {
      kind: assessment?.model?.unsupportedReason?.kind ?? 'unsupported-device',
      confirmedAt: new Date().toISOString(),
    };
  }
  if (options.quality) deviceConfig.quality = options.quality as any;
  if (options.audioQuality) deviceConfig.audioQuality = options.audioQuality as any;
  if (options.videoQuality) deviceConfig.videoQuality = options.videoQuality as any;
  if (options.encoding) deviceConfig.encoding = options.encoding as any;
  if (options.artwork !== undefined) deviceConfig.artwork = options.artwork;

  // Single combined prompt: config persistence + (optional) firmware inquiry.
  // The firmware inquiry is offered when SysInfoExtended is missing and a
  // complete USB fingerprint was resolved — see assessIpodIdentity for state.
  // `--no-firmware-inquiry` opts out of the write while keeping the cascade-derived
  // identity. `--yes` defaults to the slick path (writes when offered).
  // Skip entirely when persisting an unsupported device — writing identity
  // files to a device we've recorded as unsupported is wasted work and can
  // fail against non-writable / synthetic paths.
  const offerFirmwareInquiry =
    !!assessment &&
    assessment.firmwareInquiry === 'missing' &&
    options.firmwareInquiry !== false &&
    !recordUnsupportedScan;

  if (!autoConfirm && out.isText) {
    if (offerFirmwareInquiry) {
      out.newline();
      for (const line of SYSINFO_MISSING_PROMPT_LINES) out.print(line);
      out.newline();
    } else {
      out.newline();
    }
    const promptText = offerFirmwareInquiry
      ? `Add this iPod as "${name}" and write SysInfoExtended?`
      : `Add this iPod as "${name}"?`;
    const shouldSave = await confirmFn(promptText);
    if (!shouldSave) {
      out.print('Cancelled. No changes made.');
      return;
    }
  } else if (
    assessment?.needsChecksum &&
    !offerFirmwareInquiry &&
    options.firmwareInquiry === false
  ) {
    // Hard requirement: hash-based devices won't sync without SysInfoExtended.
    // Don't silently strand the user — surface this even in non-interactive modes.
    if (out.isText) {
      out.warn(
        `This iPod's generation requires SysInfoExtended for the iTunesDB checksum. ` +
          'Skipping firmware inquiry will leave it unsynced. ' +
          'Run `podkit doctor --repair sysinfo-extended` later.'
      );
    }
  }

  // Perform the firmware inquiry now if opted in (or auto-confirmed). The
  // core helper handles the write → re-assess lifecycle; we surface a
  // non-fatal warning on failure and continue.
  let firmwareWritten = false;
  if (offerFirmwareInquiry && assessment && ipod.isMounted) {
    const r = await ensureSysInfoExtendedAndReassess(ipod.mountPoint, assessment, {
      assessIdentity: deps.assessIdentity,
      ensureSysInfoExtended: deps.ensureSysInfoExtended,
    });
    assessment = r.assessment;
    firmwareWritten = r.firmwareWritten;
    if (r.sysInfoWriteError && out.isText) {
      out.warn(`Failed to read SysInfoExtended from USB: ${r.sysInfoWriteError}`);
      out.print('  Run `podkit doctor --repair sysinfo-extended` to retry.');
    }
  }

  // Save device to config
  const result = addDevice(name, deviceConfig, { configPath });

  if (!result.success) {
    throw new CliError({
      message: `Failed to save config: ${result.error}`,
      code: DeviceErrorCodes.CONFIG_SAVE_FAILED,
      details: { device: deviceInfo },
    });
  }

  if (isFirstDevice) {
    setDefaultDevice(name, { configPath });
  }

  const finalModel = assessment?.model;
  const finalCapabilities = assessment?.capabilities;
  const finalDisplayName = finalModel?.displayName ?? identityDisplayName;
  // Refresh deviceInfo's modelName for JSON consumers — post-write cascade
  // may resolve a more specific variant.
  deviceInfo.modelName = finalDisplayName;

  out.result<DeviceAddOutput>(
    {
      success: true,
      device: deviceInfo,
      initialized,
      saved: true,
      configPath: result.configPath,
      isDefault: isFirstDevice,
    },
    () =>
      printIpodDeviceAddSuccess(out, {
        name,
        modelDisplay: finalDisplayName,
        capabilities: finalCapabilities,
        firmwareWritten,
        isFirstDevice,
        initialized,
      })
  );
}

/**
 * `podkit device add` — detect and add a device to the configured devices list.
 *
 * The runner is a thin orchestration of three pure modules + a small set of
 * impure I/O steps:
 *
 *   1. M3 `resolveAddRequest` — static argument validation → {@link AddRequest}
 *      (tier, claim, target, config patch, config-inject identity). Throws
 *      `CliError` only for static arg errors.
 *   2. Reach the device (impure; SKIPPED for `config-inject`) — `scan` for a
 *      `scan` target, `locate` for `path`/`uuid`, + mount-if-unmounted.
 *   3. Assess (impure, per-kind adapter) — `assessIpodIdentity` /
 *      `assessMassStorageDevice` → kind-agnostic {@link DeviceAssessmentView}.
 *   4. Verify-tier cross-check (only for `verify`) — run the
 *      `sysinfo-consistency` + `sysinfo-modelnum-mismatch` diagnostics and
 *      collapse to `crossCheck: 'pass' | 'mismatch' | 'skipped'`.
 *   5. M4 `decideAddOutcome` — the scenario matrix → {@link Outcome}.
 *   6. Act on the Outcome — the ONLY place that prompts / throws `CliError`.
 *   7. DB init / track-count + persist — shared tail for every tier/kind.
 */
import { Command, Option } from 'commander';
import { confirm } from '../../utils/confirm.js';
import { existsSync, statSync } from '../../utils/fs.js';
import { getContext } from '../../context.js';
import { mergedPresets, knownDeviceTypeIds } from '../../config/preset-registry.js';
import { CliError, runAction } from '../../errors.js';
import { QUALITY_PRESETS, ENCODING_MODES } from '../../config/index.js';
import { validateCapabilityOverrides } from '@podkit/devices-mass-storage';
import { OutputContext, formatBytes, formatNumber, bold } from '../../output/index.js';
import {
  assessIpodIdentity,
  assessMassStorageDevice,
  formatHfsplusOnLinuxRefusal,
  makeHfsplusOnLinuxUnsupportedReason,
  DOCS_URLS,
} from '@podkit/core';
import type {
  IpodIdentityAssessment,
  PlatformDeviceInfo,
  DeviceManager,
  IpodModel,
} from '@podkit/core';
import { isMassStorageDevice, getDeviceTypeDisplayName, displayForConfig } from '../open-device.js';
import type { DeviceConfig } from '../../config/index.js';
import { DeviceErrorCodes } from './error-codes.js';
import { formatIFlashEvidence, formatIFlashMountExplanation, resolveDeviceName } from './shared.js';
import type { DeviceAddSuccess } from './output-types.js';
import { stripDefaultOptionValues } from '../../utils/option-source.js';
import { confirmUnsupportedDeviceAdd } from './capability-summary.js';
import { printIpodDeviceAddSuccess, printMassStorageDeviceAddSuccess } from './add-render.js';
import { offerFirmwareInquiry } from './add-firmware-inquiry.js';
import {
  applyCommonDeviceConfigOptions,
  persistDeviceConfig,
  resolveIsFirstDeviceAndConfigPath,
} from './add-persist.js';
import { resolveAddRequest } from './resolve-add-request.js';
import type {
  AddRequest,
  RawAddOptions,
  DeviceConfigPatch,
  MassStoragePatch,
} from './resolve-add-request.js';
import { decideAddOutcome } from './verification-policy.js';
import type { DeviceStateView, Outcome } from './verification-policy.js';
import { ipodAssessmentToView } from './assessment-views.js';

// =============================================================================
// Options + Commander definition
// =============================================================================

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
  /** Plain identity input — explicit mount path. */
  path?: string;
  /** Plain identity input — volume UUID (config-inject / direct locate). */
  volumeUuid?: string;
  /** Plain identity input — friendly volume name (config-inject). */
  volumeName?: string;
  /**
   * Commander `--no-verify` boolean: `false` when the user passed
   * `--no-verify`. Drops the live SCSI cross-check + SysInfoExtended write
   * (trust-disk tier) — the old `--no-firmware-inquiry`, renamed and widened.
   */
  verify?: boolean;
  /**
   * Commander `--no-validate` boolean: `false` when the user passed
   * `--no-validate`. Pure config write from complete args, no device read
   * (config-inject tier). Structurally implies `--no-verify`.
   */
  validate?: boolean;
  /**
   * Override the empty-identity / no-UUID refusal. The only flag that
   * bypasses the empty-identity gate now (M4 enforces this).
   */
  force?: boolean;
}

export const addSubcommand = new Command('add')
  .description('detect and add a device to config')
  .argument('[name]', 'device name (alternative to passing -d <name> at the program level)')
  // `--type` is validated post-parse against the merged registry
  // (built-in ∪ user-defined `[presets.X]`) so users can pass their own
  // preset ids. The built-in list still drives shell completion via the
  // generated completion file.
  .option('--type <type>', 'device type')
  .option('--path <path>', 'path to device mount point')
  .option('--volume-uuid <uuid>', 'volume UUID (direct lookup / config-inject)')
  .option('--volume-name <name>', 'friendly volume name (config-inject)')
  .option('-y, --yes', 'skip confirmation prompts')
  .option(
    '--no-verify',
    'skip the live cross-check + SysInfoExtended write; trust on-disk SysInfo (iPod only)'
  )
  .option(
    '--no-validate',
    'write config purely from args without reading the device (requires a complete identity)'
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
  .action(async (positionalName: string | undefined, options: AddOptions, command) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    // Drop Commander's synthesised `--no-X` defaults so unspecified flags
    // don't silently write `artwork: true` (etc.) into the new device
    // config on every `device add` run.
    const cleaned = stripDefaultOptionValues(options, command);
    await runAction(out, () => runDeviceAdd({ ...cleaned, name: positionalName }, out));
  });

// =============================================================================
// Dependency injection seam
// =============================================================================

/**
 * Dependency injection seam for `runDeviceAdd`. Tests pass stubs to avoid
 * real USB walks / disk operations / interactive prompts. Production passes
 * nothing — the defaults are the real implementations.
 */
export interface DeviceAddDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
  confirm?: (msg: string) => Promise<boolean>;
  loadCore?: () => Promise<typeof import('@podkit/core')>;
  /** Override for `process.platform`. */
  platform?: NodeJS.Platform | string;
  /** Override the cascade-driven identity assessment. */
  assessIdentity?: (mountPoint: string) => Promise<import('@podkit/core').IpodIdentityAssessment>;
  /** Override the SysInfoExtended write step. */
  ensureSysInfoExtended?: typeof import('@podkit/core').ensureSysInfoExtended;
  /** Override the iPod database adapter. */
  ipodDatabase?: {
    hasDatabase: (path: string) => Promise<boolean>;
    open: (path: string) => Promise<{ trackCount: number; close: () => void }>;
    initializeIpod: (path: string) => Promise<{ close: () => void }>;
  };
}

// =============================================================================
// Internal orchestration types
// =============================================================================

type CoreModule = typeof import('@podkit/core');

interface IpodDatabaseLike {
  hasDatabase: (path: string) => Promise<boolean>;
  open: (path: string) => Promise<{ trackCount: number; close: () => void }>;
  initializeIpod: (path: string) => Promise<{ close: () => void }>;
}

/** The located, mounted device + a small bundle of resolution context. */
interface ReachedDevice {
  device: PlatformDeviceInfo;
}

// =============================================================================
// Runner
// =============================================================================

/**
 * `device add` runner — testable in-process.
 *
 * Thin orchestration over M3 (`resolveAddRequest`) and M4
 * (`decideAddOutcome`) with impure reach/assess/cross-check steps in between.
 */
export async function runDeviceAdd(
  options: AddOptions & { name?: string },
  out: OutputContext,
  deps: DeviceAddDeps = {}
): Promise<void> {
  const { globalOpts, configResult } = getContext();
  const name = resolveDeviceName(options.name, globalOpts.device, 'add');
  const confirmFn = deps.confirm ?? confirm;
  const loadCore = deps.loadCore ?? (() => import('@podkit/core'));
  const assessIdentity = deps.assessIdentity ?? assessIpodIdentity;
  const platform = String(deps.platform ?? process.platform);

  // ── M3: resolve the static request ──────────────────────────────────────
  const presets = mergedPresets(configResult.config);
  const raw: RawAddOptions = { ...options, name };
  const req = resolveAddRequest(raw, {
    globalDevice: globalOpts.device,
    existingDeviceNames: Object.keys(configResult.config.devices ?? {}),
    knownDeviceTypeIds: knownDeviceTypeIds(configResult.config),
    isMassStorageType: (type) => isMassStorageDevice(type),
    validateCapabilityOverrides: (patch) => {
      const result = validateCapabilityOverrides(patch);
      if (result.ok) return { ok: true };
      const [first] = result.errors;
      return {
        ok: false,
        ...(first
          ? {
              firstError: {
                message: first.message,
                code: first.code as keyof typeof DeviceErrorCodes,
              },
            }
          : {}),
      };
    },
  });

  const isMassStorage = req.claim.mode === 'declared' && isMassStorageDevice(req.claim.deviceType);

  // ── Tier: config-inject — pure config write, ZERO device I/O ─────────────
  if (req.tier === 'config-inject') {
    return await persistInjectedConfig(req, out, isMassStorage, presets);
  }

  // ── Load core (iPod tiers need the manager + db adapter) ─────────────────
  let core: CoreModule;
  let IpodDatabase: IpodDatabaseLike;
  try {
    core = await loadCore();
    IpodDatabase = (deps.ipodDatabase ?? core.IpodDatabase) as IpodDatabaseLike;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
    throw new CliError({
      message: `Failed to load podkit-core: ${message}`,
      code: DeviceErrorCodes.CORE_LOAD_FAILED,
    });
  }
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();

  // =========================================================================
  // Mass-storage flow (verify / trust-disk — both treat the path as truth)
  // =========================================================================
  if (isMassStorage) {
    return await runMassStorageAdd(req, out, presets, confirmFn);
  }

  // =========================================================================
  // iPod flow (verify / trust-disk)
  // =========================================================================

  // ── Reach the device ─────────────────────────────────────────────────────
  const reached = await reachDevice(req, {
    out,
    manager,
    platform,
    loadCore,
    name,
    presets: () => mergedPresets(configResult.config),
  });
  if (!reached) return; // a hint/refusal was already emitted (scan path)
  const ipod = reached.device;

  const probePath = ipod.isMounted ? ipod.mountPoint : `/dev/${ipod.identifier}`;
  const userTypeOpt = req.claim.mode === 'declared' ? { userType: req.claim.deviceType } : {};

  // Device-state view is independent of the (expensive) identity assessment,
  // so build it now and short-circuit the device-state refusals (HFS+,
  // no-UUID) BEFORE assessing — those refusals don't need the assessment, and
  // assessing an HFS+-on-Linux iPod would be wasted (and pin the refusal late).
  const baseStateView: DeviceStateView = {
    located: true,
    ...(ipod.volumeUuid ? { volumeUuid: ipod.volumeUuid } : {}),
    ...(ipod.storage.filesystem !== undefined ? { filesystem: ipod.storage.filesystem } : {}),
    platform,
    path: probePath,
    crossCheck: 'skipped',
  };
  // Pre-pass: fire the location-based refusals (HFS+-on-Linux, no readable
  // volume UUID) BEFORE assessing, preserving the long-standing "refuse HFS+
  // before any disk read" ordering. M4 with a null assessment also produces
  // refuse-empty-identity for an undeclared claim — that one is NOT actionable
  // yet (the real assessment may carry identity), so we deliberately ignore
  // every outcome here except the two location refusals and re-run M4 below
  // with the real assessment.
  const preCheck = decideAddOutcome(req.tier, req.claim, null, baseStateView, req.force);
  if (preCheck.kind === 'refuse-hfsplus-on-linux' || preCheck.kind === 'refuse-no-uuid') {
    throwOutcomeError(preCheck, { platform, probePath, identifier: ipod.identifier });
  }

  // ── Assess ───────────────────────────────────────────────────────────────
  let assessment: IpodIdentityAssessment | null = null;
  if (ipod.isMounted) {
    assessment = await assessIdentity(ipod.mountPoint);
  }

  // ── Act on the Outcome ───────────────────────────────────────────────────
  let recordUnsupported = false;
  let firmwareWritten = false;
  let firmwarePrompted = false;
  let sieReEntered = false;

  // Known-unsupported generation/kind: surface the canonical refusal copy + an
  // explicit confirm (user story 22) up front — every tier that *reads* the
  // device does this, and it must precede the SysInfoExtended offer so the user
  // isn't asked to write firmware to a device they may not want. M4 still emits
  // `prompt-unsupported` as the deciding outcome in other cases; the loop below
  // treats it as already-handled when we recorded the decision here.
  let unsupportedHandled = false;
  if (assessment?.model?.unsupportedReason) {
    const decision = await confirmUnsupportedDeviceAdd(out, assessment, {
      autoConfirm: req.autoConfirm,
      confirmFn,
    });
    if (decision === 'cancelled') {
      out.print('Cancelled. No changes made.');
      return;
    }
    recordUnsupported = decision === 'add-anyway';
    unsupportedHandled = true;
  }

  // ── Build views, run M4, act ─────────────────────────────────────────────
  let view = ipodAssessmentToView(assessment ?? emptyIpodAssessment(), userTypeOpt);

  const crossCheck =
    req.tier === 'verify' && assessment && ipod.isMounted
      ? await runVerifyCrossCheck(ipod.mountPoint, assessment)
      : { crossCheck: 'skipped' as const };

  const stateView: DeviceStateView = {
    ...baseStateView,
    crossCheck: crossCheck.crossCheck,
    ...(crossCheck.detail !== undefined ? { crossCheckDetail: crossCheck.detail } : {}),
  };

  let outcome = decideAddOutcome(req.tier, req.claim, view, stateView, req.force);

  // The outcome loop runs at most twice: the second pass only happens after a
  // successful prompt-write-sie re-assess, and a second prompt-write-sie is
  // collapsed to proceed-with-warning so it can never loop.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (outcome.kind === 'proceed') break;

    if (outcome.kind === 'proceed-with-warning') {
      emitOutcomeWarning(out, outcome.warning);
      break;
    }

    if (outcome.kind === 'prompt-unsupported') {
      if (unsupportedHandled) break; // already prompted up front
      const decision = await confirmUnsupportedDeviceAdd(out, assessment, {
        autoConfirm: req.autoConfirm,
        confirmFn,
      });
      if (decision === 'cancelled') {
        out.print('Cancelled. No changes made.');
        return;
      }
      recordUnsupported = decision === 'add-anyway';
      break;
    }

    if (outcome.kind === 'prompt-write-sie') {
      if (sieReEntered) {
        // Defensive: a second prompt-write-sie must not loop. Treat as
        // proceed-with-warning (the write was already attempted once).
        emitOutcomeWarning(out, 'partial-identity');
        break;
      }
      const firmwareResult = await offerFirmwareInquiry({
        assessment,
        autoConfirm: req.autoConfirm,
        recordUnsupported,
        out,
        name,
        mountPoint: outcome.mountPoint,
        confirmFn,
        deps: {
          assessIdentity: deps.assessIdentity,
          ensureSysInfoExtended: deps.ensureSysInfoExtended,
        },
      });
      if (!firmwareResult.proceed) return;
      assessment = firmwareResult.assessment;
      firmwareWritten = firmwareWritten || firmwareResult.firmwareWritten;
      firmwarePrompted = true;
      sieReEntered = true;
      // Re-assess view + state, re-enter M4 once.
      view = ipodAssessmentToView(assessment ?? emptyIpodAssessment(), userTypeOpt);
      outcome = decideAddOutcome(req.tier, req.claim, view, stateView, req.force);
      continue;
    }

    // Refusals + errors.
    throwOutcomeError(outcome, { platform, probePath, identifier: ipod.identifier });
  }

  // ── DB init / track-count + persist (shared iPod tail) ───────────────────
  await finishIpodAdd({
    req,
    out,
    ipod,
    assessment,
    recordUnsupported,
    firmwareWritten,
    firmwarePrompted,
    IpodDatabase,
    confirmFn,
    name,
  });
}

// =============================================================================
// Phase: config-inject (pure config write, ZERO device I/O)
// =============================================================================

async function persistInjectedConfig(
  req: AddRequest,
  out: OutputContext,
  isMassStorage: boolean,
  presets: Record<string, import('@podkit/devices-mass-storage').MassStoragePreset>
): Promise<void> {
  const injected = req.injectedIdentity;
  // M3 guarantees `injectedIdentity` is present + complete for config-inject.
  if (!injected) {
    throw new CliError({
      message:
        '--no-validate requires a complete device identity (--type plus --volume-uuid or --path).',
      code: DeviceErrorCodes.EMPTY_IDENTITY,
    });
  }

  const { configResult } = getContext();
  const { isFirstDevice, configPath } = resolveIsFirstDeviceAndConfigPath(configResult);

  const deviceConfig: DeviceConfig = isMassStorage
    ? { type: injected.deviceType as DeviceConfig['type'], path: injected.path ?? '' }
    : {
        ...(injected.volumeUuid ? { volumeUuid: injected.volumeUuid } : {}),
        volumeName:
          injected.volumeName ?? injected.path?.split('/').pop() ?? injected.volumeUuid ?? req.name,
      };
  applyCommonConfigFromPatch(deviceConfig, req.config);
  if (isMassStorage) applyMassStorageConfigFromPatch(deviceConfig, req.config.massStorage);

  const deviceInfo = {
    name: req.name,
    identifier: isMassStorage ? 'mass-storage' : 'unknown',
    volumeName: injected.volumeName ?? injected.path?.split('/').pop() ?? req.name,
    volumeUuid: injected.volumeUuid ?? '',
    size: 0,
    isMounted: false,
    ...(injected.path ? { mountPoint: injected.path } : {}),
  };

  const { result } = persistDeviceConfig({
    name: req.name,
    deviceConfig,
    configPath,
    isFirstDevice,
    deviceInfoForErrorDetails: deviceInfo,
  });

  out.result<DeviceAddSuccess>(
    {
      success: true,
      device: deviceInfo,
      saved: true,
      configPath: result.configPath,
      isDefault: isFirstDevice,
      verification: 'config-only',
    },
    () => {
      if (isMassStorage) {
        printMassStorageDeviceAddSuccess(out, {
          name: req.name,
          deviceType: injected.deviceType as NonNullable<DeviceConfig['type']>,
          configResult: { created: result.created ?? false, configPath: result.configPath ?? '' },
          isFirstDevice,
          presets,
        });
      } else {
        printIpodDeviceAddSuccess(out, {
          name: req.name,
          modelDisplay: deviceInfo.volumeName,
          capabilities: null,
          firmwareWritten: false,
          isFirstDevice,
          initialized: false,
        });
      }
    }
  );
}

// =============================================================================
// Phase: mass-storage add (verify / trust-disk)
// =============================================================================

async function runMassStorageAdd(
  req: AddRequest,
  out: OutputContext,
  presets: Record<string, import('@podkit/devices-mass-storage').MassStoragePreset>,
  confirmFn: (msg: string) => Promise<boolean>
): Promise<void> {
  // M3 guarantees a `path` target for declared mass-storage types.
  const explicitPath = req.target.kind === 'path' ? req.target.path : '';
  const deviceType = (req.claim.mode === 'declared' ? req.claim.deviceType : '') as string;

  // Path existence/stat is device I/O — performed here, not in M3.
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

  const assessment = assessMassStorageDevice(explicitPath, {
    presetId: deviceType,
    overrides: massStorageOverridesFromPatch(req.config.massStorage),
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
  applyCommonConfigFromPatch(deviceConfig, req.config);
  applyMassStorageConfigFromPatch(deviceConfig, req.config.massStorage);

  const volumeName = explicitPath.split('/').pop() || req.name;
  const { configResult } = getContext();
  const { isFirstDevice, configPath } = resolveIsFirstDeviceAndConfigPath(configResult);

  const deviceInfo = {
    name: req.name,
    identifier: 'mass-storage',
    volumeName,
    volumeUuid: '',
    size: 0,
    isMounted: true,
    mountPoint: explicitPath,
  };

  if (!req.autoConfirm && out.isText) {
    out.newline();
    const confirmDisplay = displayForConfig({ type: deviceType }, presets);
    out.print(`Adding ${confirmDisplay.short} device:`);
    out.print(`  Name:   ${req.name}`);
    out.print(`  Type:   ${confirmDisplay.rich}`);
    out.print(`  Path:   ${explicitPath}`);
    out.newline();
    const shouldSave = await confirmFn(`Add this device as "${req.name}"?`);
    if (!shouldSave) {
      out.print('Cancelled. No changes made.');
      return;
    }
  }

  const { result } = persistDeviceConfig({
    name: req.name,
    deviceConfig,
    configPath,
    isFirstDevice,
    deviceInfoForErrorDetails: deviceInfo,
  });

  out.result<DeviceAddSuccess>(
    {
      success: true,
      device: deviceInfo,
      saved: true,
      configPath: result.configPath,
      isDefault: isFirstDevice,
      verification: req.tier === 'verify' ? 'verified' : 'trusted-disk',
    },
    () =>
      printMassStorageDeviceAddSuccess(out, {
        name: req.name,
        deviceType: deviceType as NonNullable<DeviceConfig['type']>,
        configResult: { created: result.created ?? false, configPath: result.configPath ?? '' },
        isFirstDevice,
        presets,
      })
  );
}

// =============================================================================
// Phase: reach the device (scan | locate + mount)
// =============================================================================

interface ReachDeviceCtx {
  out: OutputContext;
  manager: DeviceManager;
  platform: string;
  loadCore: () => Promise<CoreModule>;
  name: string;
  presets: () => Record<string, import('@podkit/devices-mass-storage').MassStoragePreset>;
}

/**
 * Reach the iPod the request targets. Returns the located, mounted device, or
 * `null` when a hint / refusal was already emitted (the scan "no device"
 * surface). HFS+ + UUID gating is left to M4 — this only locates + mounts.
 */
async function reachDevice(req: AddRequest, ctx: ReachDeviceCtx): Promise<ReachedDevice | null> {
  if (req.target.kind === 'path') {
    return await reachByPath(req.target.path, ctx);
  }
  if (req.target.kind === 'uuid') {
    return await reachByUuid(req.target.volumeUuid, ctx);
  }
  return await reachByScan(req, ctx);
}

async function reachByPath(path: string, ctx: ReachDeviceCtx): Promise<ReachedDevice | null> {
  const { manager } = ctx;
  if (!existsSync(path)) {
    throw new CliError({
      message: `Path not found: ${path}`,
      code: DeviceErrorCodes.PATH_NOT_FOUND,
    });
  }

  // Path targets always proceed from the path: when the OS can locate a volume
  // we use its real record (UUID, filesystem); otherwise we synthesise a
  // minimal one (bind mount / tmpfs) and let M4's no-UUID gate decide.
  if (!manager.isSupported) {
    return { device: synthLocatedDevice(path) };
  }
  const located = await manager.locate({ path });
  return { device: located ?? synthLocatedDevice(path) };
}

async function reachByUuid(volumeUuid: string, ctx: ReachDeviceCtx): Promise<ReachedDevice | null> {
  const { manager } = ctx;
  if (!manager.isSupported) {
    throw new CliError({
      message: `Device scanning is not supported on ${manager.platform}. Specify a path explicitly: podkit device add -d <name> --path <path>`,
      code: DeviceErrorCodes.SCAN_UNSUPPORTED,
    });
  }
  const located = await manager.locate({ volumeUuid });
  if (!located) {
    throw new CliError({
      message: `No device found for volume UUID ${volumeUuid}.`,
      code: DeviceErrorCodes.DEVICE_NOT_FOUND,
    });
  }
  return { device: located };
}

async function reachByScan(req: AddRequest, ctx: ReachDeviceCtx): Promise<ReachedDevice | null> {
  const { out, manager, loadCore, name } = ctx;

  if (!manager.isSupported) {
    throw new CliError({
      message: `Device scanning is not supported on ${manager.platform}. Specify a path explicitly: podkit device add -d <name> --path <path>`,
      code: DeviceErrorCodes.SCAN_UNSUPPORTED,
    });
  }

  out.print('Scanning for attached devices...');
  const ipods = await manager.scan({ kinds: ['ipod'] });

  if (ipods.length === 0) {
    await handleNoDeviceFound(ctx);
    return null; // handleNoDeviceFound always throws; this is unreachable.
  }

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

  // Refuse an unsupported filesystem (HFS+ on Linux) BEFORE attempting to
  // mount — mounting an HFS+ volume on Linux is exactly what the refusal
  // exists to prevent. The main-flow pre-pass also covers no-UUID, but that
  // is checked post-mount (a device may only expose its UUID once mounted),
  // so here we fire only the pre-mount filesystem refusal.
  const scanProbePath = ipod.isMounted ? ipod.mountPoint : `/dev/${ipod.identifier}`;
  const scanStateView: DeviceStateView = {
    located: true,
    ...(ipod.volumeUuid ? { volumeUuid: ipod.volumeUuid } : {}),
    ...(ipod.storage.filesystem !== undefined ? { filesystem: ipod.storage.filesystem } : {}),
    platform: ctx.platform,
    path: scanProbePath,
    crossCheck: 'skipped',
  };
  const scanPreCheck = decideAddOutcome(req.tier, req.claim, null, scanStateView, req.force);
  if (scanPreCheck.kind === 'refuse-hfsplus-on-linux') {
    throwOutcomeError(scanPreCheck, {
      platform: ctx.platform,
      probePath: scanProbePath,
      identifier: ipod.identifier,
    });
  }

  // Mount-if-unmounted (mount logic stays here).
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
      const updated = await manager.locate({ volumeUuid: ipod.volumeUuid });
      if (updated?.isMounted) ipod = updated;
    } else if (mountResult.requiresSudo) {
      const explanationLines = assessment?.iFlash.confirmed
        ? formatIFlashMountExplanation(assessment)
        : ['Mounting requires elevated privileges.'];
      if (out.isText) {
        for (const line of explanationLines) out.error(line);
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

  if (!ipod.isMounted) {
    // Mount failed silently — keep the original render context.
    if (!req.autoConfirm && out.isText) {
      out.newline();
      out.print(`  Name:        ${ipod.volumeName || '(unnamed)'}`);
      out.print(`  Mount:       (not mounted)`);
      out.print(`  Capacity:    ${formatBytes(ipod.storage.sizeBytes)}`);
      out.print(`  Volume UUID: ${ipod.volumeUuid}`);
      out.print(`  Device:      /dev/${ipod.identifier}`);
    }
  }

  return { device: ipod };
}

/**
 * The scan "no iPod found" surface — consults the discovery orchestrator for
 * unsupported-device / hint cases, then throws the right `CliError`. Always
 * throws.
 */
async function handleNoDeviceFound(ctx: ReachDeviceCtx): Promise<never> {
  const { manager, loadCore, name, presets } = ctx;
  const massStoragePresets = presets();

  let earlyUnsupportedReason: import('@podkit/core').ReadinessUnsupportedReason | undefined;
  let earlyUnsupportedDisplay: string | undefined;
  try {
    const coreMod = await loadCore();
    const discovered = await coreMod.discoverConnectedDevices({
      deviceManager: manager,
      massStoragePresets,
    });
    const unsupportedIpod = discovered.find(
      (d): d is import('@podkit/core').DiscoveredDeviceIpod =>
        d.kind === 'ipod' && d.usb?.supported === false
    );
    if (unsupportedIpod?.usb) {
      const usb = unsupportedIpod.usb;
      const pid = parseInt(usb.device.productId.replace(/^0x/i, ''), 16);
      const isIosRange = Number.isFinite(pid) && pid >= 0x1290 && pid <= 0x12af;
      earlyUnsupportedDisplay =
        usb.model?.displayName ?? (isIosRange ? 'iOS device' : 'Unsupported iPod');
      earlyUnsupportedReason = usb.unsupportedReason ?? {
        kind: isIosRange ? 'ios-device' : 'unsupported-device',
        headline: `${earlyUnsupportedDisplay} is not supported by podkit.`,
        docsUrl: DOCS_URLS.supportedDevices,
      };
    } else {
      const unsupportedKind = discovered.find(
        (d): d is import('@podkit/core').DiscoveredDeviceUnsupported => d.kind === 'unsupported'
      );
      if (unsupportedKind) {
        earlyUnsupportedDisplay = unsupportedKind.usb.family ?? 'Unsupported device';
        earlyUnsupportedReason = {
          kind: 'unsupported-device',
          headline: unsupportedKind.usb.reason,
          docsUrl: DOCS_URLS.supportedDevices,
        };
      }
    }
  } catch {
    // Discovery is best-effort; fall through.
  }

  if (earlyUnsupportedReason) {
    const lines = [earlyUnsupportedReason.headline];
    if (earlyUnsupportedReason.details) lines.push(...earlyUnsupportedReason.details);
    lines.push(`  See: ${earlyUnsupportedReason.docsUrl ?? DOCS_URLS.supportedDevices}`);
    throw new CliError({
      message: lines.join('\n'),
      code: DeviceErrorCodes.UNSUPPORTED_DEVICE,
      details: { model: earlyUnsupportedDisplay, unsupported: earlyUnsupportedReason },
    });
  }

  let suggestedIntent: import('@podkit/core').DeviceAddIntent | undefined;
  try {
    const core = await loadCore();
    const intents = await core.suggestAddIntents({
      deviceManager: manager,
      massStoragePresets,
    });
    suggestedIntent = intents.find((i) => i.providerId !== 'unsupported');
  } catch {
    // Enumeration is best-effort.
  }

  if (!suggestedIntent) {
    throw new CliError({
      message:
        'No iPod devices found. Make sure your iPod is connected, or specify a path explicitly with --path.',
      code: DeviceErrorCodes.NO_IPOD,
    });
  }

  const displayName = getDeviceTypeDisplayName({ type: suggestedIntent.kind }, massStoragePresets);
  ctx.out.print(`Detected ${displayName} via USB.`);
  if (suggestedIntent.addArgs.length > 0) {
    ctx.out.print('To add it, run:');
    ctx.out.print(`  podkit device add -d ${name} ${suggestedIntent.addArgs.join(' ')}`);
  }
  for (const note of suggestedIntent.notes ?? []) ctx.out.print(`  ${note}`);

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

// =============================================================================
// Phase: verify-tier cross-check
// =============================================================================

/**
 * Run the `sysinfo-consistency` + `sysinfo-modelnum-mismatch` diagnostics and
 * collapse their `CheckResult.status` into a single `crossCheck`:
 *   - `fail` / `warn` → `mismatch`
 *   - `pass`          → `pass`
 *   - `skip`          → `skipped`
 *
 * `mismatch` from either check wins; `pass` beats `skipped`. The `liveIdentity`
 * the checks expect is assembled from the assessment's USB fingerprint.
 */
async function runVerifyCrossCheck(
  mountPoint: string,
  assessment: IpodIdentityAssessment
): Promise<{ crossCheck: 'pass' | 'mismatch' | 'skipped'; detail?: string }> {
  const { getDiagnosticCheck } = await import('@podkit/core');
  const consistency = getDiagnosticCheck('sysinfo-consistency');
  const modelnum = getDiagnosticCheck('sysinfo-modelnum-mismatch');

  const { identify } = await import('@podkit/core');
  const liveModel: IpodModel | undefined =
    assessment.usbFingerprint?.productId !== undefined
      ? identify({ from: 'usb', productId: assessment.usbFingerprint.productId })
      : undefined;
  const liveIdentity = {
    ...(assessment.usbFingerprint?.serialNumber
      ? { firewireGuid: assessment.usbFingerprint.serialNumber }
      : {}),
    ...(liveModel ? { model: liveModel } : {}),
  };

  const ctx = {
    mountPoint,
    deviceType: 'ipod' as const,
    liveIdentity,
  };

  // `mismatch` from either check wins (early return); otherwise a `pass` on
  // either axis lifts the result above `skipped`.
  let sawPass = false;
  for (const check of [consistency, modelnum]) {
    if (!check) continue;
    const result = await check.check(ctx);
    if (result.status === 'fail' || result.status === 'warn') {
      return { crossCheck: 'mismatch', detail: result.summary };
    }
    if (result.status === 'pass') sawPass = true;
  }

  return { crossCheck: sawPass ? 'pass' : 'skipped' };
}

// =============================================================================
// Phase: shared iPod tail (DB init / track-count + persist)
// =============================================================================

async function finishIpodAdd(args: {
  req: AddRequest;
  out: OutputContext;
  ipod: PlatformDeviceInfo;
  assessment: IpodIdentityAssessment | null;
  recordUnsupported: boolean;
  firmwareWritten: boolean;
  /** True when the firmware/add prompt already fired in the outcome loop. */
  firmwarePrompted: boolean;
  IpodDatabase: IpodDatabaseLike;
  confirmFn: (msg: string) => Promise<boolean>;
  name: string;
}): Promise<void> {
  const { req, out, ipod, recordUnsupported, firmwarePrompted, IpodDatabase, confirmFn, name } =
    args;
  const assessment = args.assessment;
  const firmwareWritten = args.firmwareWritten;
  const autoConfirm = req.autoConfirm;
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
        // Couldn't read database info, continue anyway.
      }
    }
  }

  if (!autoConfirm && out.isText) {
    out.print(`  Tracks:      ${formatNumber(trackCount)}`);
  }

  const { configResult } = getContext();
  const { isFirstDevice, configPath } = resolveIsFirstDeviceAndConfigPath(configResult);
  const deviceConfig: DeviceConfig = {
    volumeUuid: ipod.volumeUuid,
    volumeName: ipod.volumeName,
  };
  if (recordUnsupported) {
    deviceConfig.unsupported = {
      kind: assessment?.model?.unsupportedReason?.kind ?? 'unsupported-device',
      confirmedAt: new Date().toISOString(),
    };
  }
  applyCommonConfigFromPatch(deviceConfig, req.config);

  // Final add confirmation. The SysInfoExtended write (verify tier, SIE
  // missing) was already handled by the prompt-write-sie outcome, which also
  // served as the confirmation — so only prompt here when that did NOT fire
  // (SIE already present, or the trust-disk tier). Skipped under --yes / JSON.
  if (!firmwarePrompted && !autoConfirm && out.isText) {
    const shouldSave = await confirmFn(`Add this iPod as "${name}"?`);
    if (!shouldSave) {
      out.print('Cancelled. No changes made.');
      return;
    }
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
    modelName: assessment?.model?.displayName ?? identityDisplayName,
  };

  const { result } = persistDeviceConfig({
    name,
    deviceConfig,
    configPath,
    isFirstDevice,
    deviceInfoForErrorDetails: deviceInfo,
  });

  out.result<DeviceAddSuccess>(
    {
      success: true,
      device: deviceInfo,
      initialized,
      saved: true,
      configPath: result.configPath,
      isDefault: isFirstDevice,
      verification: req.tier === 'verify' ? 'verified' : 'trusted-disk',
    },
    () =>
      printIpodDeviceAddSuccess(out, {
        name,
        modelDisplay: deviceInfo.modelName,
        capabilities: assessment?.capabilities,
        firmwareWritten,
        isFirstDevice,
        initialized,
      })
  );
}

// =============================================================================
// Outcome → side-effect mappers
// =============================================================================

function emitOutcomeWarning(
  out: OutputContext,
  warning: 'partial-identity' | 'path-only-no-uuid' | 'empty-identity-forced'
): void {
  if (!out.isText) return;
  if (warning === 'partial-identity') {
    out.warn(
      'Unable to determine device model from disk — no SysInfoExtended or classic SysInfo. ' +
        'Proceeding with USB identity only; some operations may behave conservatively. ' +
        'Retry with the device re-mounted or re-plugged.'
    );
  } else if (warning === 'path-only-no-uuid') {
    out.warn(
      'Proceeding without a stable volume UUID (--force). This device may not be re-found ' +
        'if its mount path changes — pass --volume-uuid to make it durable across replug.'
    );
  } else {
    out.warn('Proceeding with empty device identity. Some operations may not behave correctly.');
  }
}

/** Map a refusal/error Outcome to a `CliError`. Always throws. */
function throwOutcomeError(
  outcome: Outcome,
  ctx: { platform: string; probePath: string; identifier?: string }
): never {
  switch (outcome.kind) {
    case 'error-mismatch':
      throw new CliError({
        message:
          'On-disk SysInfo disagrees with the connected device. ' +
          (outcome.detail ? `${outcome.detail}\n\n` : '') +
          'Run `podkit doctor --repair sysinfo-modelnum-mismatch` to reconcile the device identity, ' +
          'then retry the add.',
        code: DeviceErrorCodes.IDENTITY_MISMATCH,
        ...(outcome.detail ? { details: { detail: outcome.detail } } : {}),
      });
    case 'error-missing-sysinfo':
      throw new CliError({
        message:
          'This iPod has no on-disk SysInfo and --no-verify skips the firmware inquiry that would ' +
          'write it. Run `podkit doctor` on a host that can perform the USB inquiry to write ' +
          'SysInfoExtended, then retry, or drop --no-verify to let add write it now.',
        code: DeviceErrorCodes.EMPTY_IDENTITY,
        details: { path: ctx.probePath },
      });
    case 'refuse-no-uuid':
      throw new CliError({
        message:
          'Cannot add iPod: this iPod does not have a readable filesystem UUID. ' +
          'podkit identifies iPods by volume UUID across replug cycles — without one, ' +
          'commands like `podkit doctor -d <name>` would fail to find the device.\n\n' +
          'Common causes: corrupt partition table, unusual filesystem layout. ' +
          `See: ${DOCS_URLS.troubleshooting}`,
        code: DeviceErrorCodes.VOLUME_UUID_REQUIRED,
        details: {
          path: outcome.path ?? ctx.probePath,
          identifier: ctx.identifier ?? 'unknown',
          filesystem: outcome.filesystem ?? null,
        },
      });
    case 'refuse-hfsplus-on-linux':
      throw new CliError({
        message: formatHfsplusOnLinuxRefusal().join('\n'),
        code: DeviceErrorCodes.UNSUPPORTED_FILESYSTEM_ON_LINUX,
        details: {
          filesystem: outcome.filesystem ?? null,
          platform: ctx.platform,
          path: outcome.path ?? ctx.probePath,
          unsupported: makeHfsplusOnLinuxUnsupportedReason({
            ...(outcome.filesystem ? { filesystem: outcome.filesystem } : {}),
            path: outcome.path ?? ctx.probePath,
          }),
        },
      });
    case 'refuse-empty-identity':
      throw new CliError({
        message: emptyIdentityRefusalLines().join('\n'),
        code: DeviceErrorCodes.EMPTY_IDENTITY,
        details: { path: outcome.path ?? ctx.probePath },
      });
    case 'error-incomplete-injection':
      throw new CliError({
        message: `--no-validate requires a complete device identity. Missing: ${outcome.missing.join(', ')}.`,
        code: DeviceErrorCodes.EMPTY_IDENTITY,
        details: { missing: outcome.missing },
      });
    default:
      // Exhaustiveness: every non-refusal kind is handled by the caller.
      throw new CliError({
        message: `Unexpected add outcome: ${outcome.kind}`,
        code: DeviceErrorCodes.UNSUPPORTED_DEVICE,
      });
  }
}

function emptyIdentityRefusalLines(): string[] {
  return [
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
    '  • Pass --force to add the device anyway — some operations may behave',
    '    conservatively without identity.',
  ];
}

// =============================================================================
// Config-patch appliers
// =============================================================================

function applyCommonConfigFromPatch(deviceConfig: DeviceConfig, patch: DeviceConfigPatch): void {
  applyCommonDeviceConfigOptions(deviceConfig, {
    ...(patch.quality !== undefined ? { quality: patch.quality } : {}),
    ...(patch.audioQuality !== undefined ? { audioQuality: patch.audioQuality } : {}),
    ...(patch.videoQuality !== undefined ? { videoQuality: patch.videoQuality } : {}),
    ...(patch.encoding !== undefined ? { encoding: patch.encoding } : {}),
    ...(patch.artwork !== undefined ? { artwork: patch.artwork } : {}),
  });
}

function applyMassStorageConfigFromPatch(deviceConfig: DeviceConfig, ms: MassStoragePatch): void {
  if (ms.artworkMaxResolution !== undefined)
    deviceConfig.artworkMaxResolution = ms.artworkMaxResolution;
  if (ms.artworkSources !== undefined)
    deviceConfig.artworkSources = ms.artworkSources as DeviceConfig['artworkSources'];
  if (ms.supportedAudioCodecs !== undefined)
    deviceConfig.supportedAudioCodecs =
      ms.supportedAudioCodecs as DeviceConfig['supportedAudioCodecs'];
  if (ms.supportsVideo !== undefined) deviceConfig.supportsVideo = ms.supportsVideo;
  if (ms.musicDir !== undefined) deviceConfig.musicDir = ms.musicDir;
  if (ms.moviesDir !== undefined) deviceConfig.moviesDir = ms.moviesDir;
  if (ms.tvShowsDir !== undefined) deviceConfig.tvShowsDir = ms.tvShowsDir;
}

function massStorageOverridesFromPatch(
  ms: MassStoragePatch
): Parameters<typeof validateCapabilityOverrides>[0] {
  const overrides: Parameters<typeof validateCapabilityOverrides>[0] = {};
  if (ms.artworkMaxResolution !== undefined)
    overrides.artworkMaxResolution = ms.artworkMaxResolution;
  if (ms.artworkSources !== undefined) overrides.artworkSources = ms.artworkSources;
  if (ms.supportedAudioCodecs !== undefined)
    overrides.supportedAudioCodecs = ms.supportedAudioCodecs;
  return overrides;
}

// =============================================================================
// Small synth helpers
// =============================================================================

/** Synthesise a minimal located device from a bare path (no OS volume info). */
function synthLocatedDevice(path: string): PlatformDeviceInfo {
  return {
    identifier: 'unknown',
    volumeName: path.split('/').pop() || 'iPod',
    volumeUuid: '',
    storage: { sizeBytes: 0 },
    isMounted: true,
    mountPoint: path,
  } as PlatformDeviceInfo;
}

/** A neutral assessment used to build a view when assessment is null. */
function emptyIpodAssessment(): IpodIdentityAssessment {
  return {
    model: null,
    capabilities: null,
    needsChecksum: false,
    checksumType: undefined,
    firmwareInquiry: 'unwritable',
    existing: null,
    usbFingerprint: null,
    sysInfoModelNumber: undefined,
  };
}

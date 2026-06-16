/**
 * Doctor command — run health checks on a device
 *
 * Checks the device for known issues and reports findings.
 * When a check fails and is repairable, the CLI maps domain-level
 * repair requirements to flags and UX.
 *
 * For mass-storage devices, runs applicable checks (e.g. orphan file detection)
 * using content paths resolved from the device preset/config chain.
 *
 * @example
 * ```bash
 * podkit doctor                                           # Run all checks
 * podkit doctor --json                                    # JSON output
 * podkit doctor --repair artwork-rebuild -c main        # Repair by check ID
 * podkit doctor --repair artwork-rebuild -c main --dry-run  # Preview repair
 * ```
 */

import { basename } from 'node:path';
import { Command, Option } from 'commander';
import { getContext } from '../context.js';
import {
  resolveDevicePath,
  formatDeviceError,
  getDeviceIdentity,
  formatDeviceLookupMessage,
  parseCliDeviceArg,
  resolveEffectiveDevice,
} from '../device-resolver.js';
import type { DeviceConfig } from '../config/types.js';
import { OutputContext } from '../output/index.js';
import { CliError, runAction, type CliErrorOutput } from '../errors.js';
import { loadCoreOrFail, type CoreLoaderDeps } from '../handler-deps.js';
import { withCleanOptions } from '../utils/option-source.js';
import { shellQuote } from '../utils/shell.js';
import { formatFailureCopy } from './doctor-failure-copy.js';
import {
  printGroupedChecks,
  printOrphanSummary,
  emitOrphanCsv,
  formatCheckRow,
  printSummaryLine,
} from './doctor-render.js';
import { preflightCascadeRefusal, runRepairPipeline } from './doctor-repair.js';

/**
 * Error codes emitted by `podkit doctor`.
 *
 * Exhaustive — every CliError thrown from this command's runners (default
 * doctor + repair pathways) uses one of these. Consumers branching on
 * `output.code` can rely on this union.
 */
export const DoctorErrorCodes = {
  CORE_LOAD_FAILED: 'CORE_LOAD_FAILED',
  UNKNOWN_CHECK: 'UNKNOWN_CHECK',
  CHECK_NOT_REPAIRABLE: 'CHECK_NOT_REPAIRABLE',
  DEVICE_REQUIRED: 'DEVICE_REQUIRED',
  COLLECTION_REQUIRED: 'COLLECTION_REQUIRED',
  DEVICE_NOT_RESOLVED: 'DEVICE_NOT_RESOLVED',
  INCOMPATIBLE_DEVICE_TYPE: 'INCOMPATIBLE_DEVICE_TYPE',
  REPAIR_FAILED: 'REPAIR_FAILED',
  IPOD_DATABASE_OPEN_FAILED: 'IPOD_DATABASE_OPEN_FAILED',
  COLLECTION_NOT_FOUND: 'COLLECTION_NOT_FOUND',
  ADAPTER_CONNECT_FAILED: 'ADAPTER_CONNECT_FAILED',
  SCOPE_CONFLICT: 'SCOPE_CONFLICT',
  LOCK_HELD: 'LOCK_HELD',
  LOCK_UNAVAILABLE: 'LOCK_UNAVAILABLE',
} as const;

/**
 * Exit code emitted when another podkit process holds the per-device sync
 * lock. Mirrors `SYNC_LOCK_HELD_EXIT_CODE` from `sync.ts` so callers (and
 * the daemon) can branch on a single contention exit code regardless of
 * whether `sync` or `doctor --repair` lost the race.
 */
export const DOCTOR_LOCK_HELD_EXIT_CODE = 4;
export type DoctorErrorCode = (typeof DoctorErrorCodes)[keyof typeof DoctorErrorCodes];

export type DoctorErrorOutput = CliErrorOutput & { code: DoctorErrorCode };
import { existsSync } from '../utils/fs.js';
import { createMusicAdapter } from '../utils/source-adapter.js';
import { openDevice, getDeviceTypeDisplayName } from './open-device.js';
import type { ReadinessResult } from '@podkit/core';
import { DOCS_URLS } from '@podkit/core';
import { resolveDeviceContentPaths } from '../resolvers/content-paths.js';
import { mergedPresets } from '../config/preset-registry.js';
import {
  stageMarker,
  printReadinessSummary,
  collectReadinessIssues,
  printIssues,
  type ReadinessIssue,
} from './readiness-display.js';

// ── Output types ────────────────────────────────────────────────────────────

interface DoctorCheckOutput {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  summary: string;
  repairable: boolean;
  details?: Record<string, unknown>;
  docsUrl?: string;
  /**
   * Section the renderer puts this check under. Mirrors the underlying
   * `DiagnosticCheck.scope`:
   * - `'system'` → host environment (FFmpeg encoders, transports, udev).
   * - `'device-readiness'` → connectivity / format / mount prerequisites.
   * - `'database-health'` → on-device data-store health.
   */
  scope: 'system' | 'device-readiness' | 'database-health';
}

interface DoctorOutput {
  /** Always `true` — the diagnostic ran. Use `status` to read the result. */
  success: true;
  /**
   * Outcome of the diagnostic.
   * - `'ok'`: every check passed, exit code 0
   * - `'issues-found'`: ran cleanly but found problems, exit code 2
   */
  status: 'ok' | 'issues-found';
  healthy: boolean;
  mountPoint: string;
  deviceModel: string;
  deviceType: 'ipod' | 'mass-storage';
  readiness?: {
    level: string;
    stages: Array<{
      stage: string;
      status: 'pass' | 'fail' | 'warn' | 'skip';
      summary: string;
      details?: Record<string, unknown>;
    }>;
    /** Structured rejection payload; only set when level === 'unsupported'. */
    unsupported?: import('@podkit/core').ReadinessUnsupportedReason;
  };
  checks: DoctorCheckOutput[];
}

/**
 * JSON envelope for `podkit doctor --scope system`. Distinct from
 * `DoctorOutput` because mountPoint / deviceModel / deviceType / readiness
 * are inapplicable when no device is resolved — emitting them as
 * placeholders would be misleading.
 */
interface SystemDoctorOutput {
  success: true;
  status: 'ok' | 'issues-found';
  healthy: boolean;
  scope: 'system';
  checks: DoctorCheckOutput[];
}

// ── Options ─────────────────────────────────────────────────────────────────

export type DoctorScope = 'system' | 'device' | 'all';

interface DoctorOptions {
  repair?: string;
  dryRun?: boolean;
  collection?: string;
  format?: 'csv';
  /**
   * commander's `--no-system` flag sets `system: false`. Default is `true`.
   * Skips system-scope checks (FFmpeg encoders, SCSI transport availability,
   * etc.) when the user wants device-only diagnostics.
   */
  system?: boolean;
  /**
   * Limits which check groups run. `'system'` skips device resolution and
   * runs only host-environment checks; `'device'` requires `-d` and skips
   * system checks; `'all'` (default) preserves the legacy combined run and
   * honours `--no-system`.
   */
  scope?: DoctorScope;
  /**
   * Discoverable sugar for `--scope system`. Equivalent in every way; lives
   * because users coming from "I don't have an iPod connected, just check
   * my host" don't reach for `--scope system` first. Symmetrical with
   * `--no-system` (device-only).
   */
  systemOnly?: boolean;
}

/**
 * Resolve the effective diagnostic scopes from the parsed flag combination.
 *
 * `--scope` is the new primary control; the legacy `--no-system` flag only
 * applies when `--scope` is `'all'` (i.e. the default). The result is the
 * exact list passed to `core.runDiagnostics({ scopes })`.
 *
 * Exported for unit-test coverage of the flag matrix (TASK-333 AC #6).
 */
export function resolveDoctorScopes(
  options: Pick<DoctorOptions, 'scope' | 'system' | 'systemOnly'>
): ReadonlyArray<'system' | 'device-readiness' | 'database-health'> {
  const scope: DoctorScope = options.systemOnly ? 'system' : (options.scope ?? 'all');
  const deviceScopes = ['device-readiness', 'database-health'] as const;
  if (scope === 'system') return ['system'];
  if (scope === 'device') return deviceScopes;
  return options.system === false ? deviceScopes : ['system', ...deviceScopes];
}

// ── Suggested actions ────────────────────────────────────────────────────────

interface SuggestedAction {
  /** Why the user might want to run this — printed as a section heading. */
  reason: string;
  /** Exact command to run, including the user's `-d` argument. */
  command: string;
}

/**
 * Dependency injection seam shared by `runDoctorDiagnostics` and the
 * doctor command's internal `resolveDevice` helper. Tests pass stubs to
 * avoid real USB walks and the dynamic `@podkit/core` import.
 *
 * NOTE: `resolveDevice` deliberately surfaces core-load failures as a
 * `{ error }` return value rather than throwing, so the helper has its
 * own try/catch and does NOT use the throw-style `loadCoreOrFail`.
 */
export interface DoctorDeps extends CoreLoaderDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
}

// ── Resolve device helper ───────────────────────────────────────────────────

async function resolveDevice(
  out: OutputContext,
  deps: DoctorDeps = {}
): Promise<{ path: string; deviceConfig?: DeviceConfig } | { error: string }> {
  const { config, globalOpts } = getContext();

  const cliDeviceArg = parseCliDeviceArg(globalOpts.device, config);
  const deviceResult = resolveEffectiveDevice(cliDeviceArg, undefined, config);

  if (!deviceResult.success) {
    return { error: deviceResult.error };
  }

  const resolvedDevice = deviceResult.device;
  const cliPath = deviceResult.cliPath;
  const deviceIdentity = getDeviceIdentity(resolvedDevice);

  let core: typeof import('@podkit/core');
  try {
    core = await (deps.loadCore ?? (() => import('@podkit/core')))();
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load podkit-core' };
  }

  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();

  if (deviceIdentity?.volumeUuid) {
    out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
  }

  const resolveResult = await resolveDevicePath({
    cliDevice: cliPath,
    deviceIdentity,
    manager,
    requireMounted: true,
    quiet: true,
  });

  if (!resolveResult.path) {
    return { error: resolveResult.error ?? formatDeviceError(resolveResult) };
  }

  if (!existsSync(resolveResult.path)) {
    return { error: `Device path not found: ${resolveResult.path}` };
  }

  return { path: resolveResult.path, deviceConfig: resolvedDevice?.config };
}

// ── Doctor command ──────────────────────────────────────────────────────────

export const doctorCommand = new Command('doctor')
  .description('run health checks on a device')
  .addOption(
    // Note: this list must be kept in sync with diagnostic checks registered
    // in packages/podkit-core/src/diagnostics/index.ts (getDiagnosticCheckIds)
    new Option('--repair <check-id>', 'repair a specific check by ID').choices([
      // Keep this list in lockstep with PUBLIC_REPAIR_IDS in
      // packages/podkit-core/src/diagnostics/repair-dispatch.ts. A test there
      // pins the canonical set.
      'artwork-rebuild',
      'artwork-reset',
      'debris-files',
      'debris-transcode-tmp',
      'orphan-files',
      'sysinfo-consistency',
      'sysinfo-extended',
      'sysinfo-modelnum-mismatch',
      'udev-rule',
    ])
  )
  .option('-c, --collection <name>', 'music collection to use as artwork source')
  .option('--dry-run', 'preview repair without modifying the iPod')
  .option('--format <fmt>', 'output format for file lists (csv)')
  .option('--no-system', 'skip system-scope checks (FFmpeg, SCSI transport, udev rule, etc.)')
  .option(
    '--system-only',
    'run system-scope checks only (no device required); same as --scope system'
  )
  .addOption(
    // No commander-level `.default('all')` — the default is applied at the use
    // site (`options.scope ?? 'all'`) so the conflict check between
    // `--system-only` and a user-passed `--scope` can distinguish "user wrote
    // --scope all" from "scope absent, defaulted to all".
    new Option(
      '--scope <scope>',
      'restrict checks: system-only (no device required), device-only (requires -d), or all (default)'
    ).choices(['system', 'device', 'all'])
  )
  .action(
    withCleanOptions(async (options: DoctorOptions) => {
      const { globalOpts } = getContext();
      const out = OutputContext.fromGlobalOpts(globalOpts);
      await runAction(out, () => runDoctorAction(options, out));
    })
  );

/**
 * Body of the `podkit doctor` action callback, extracted so the flag-matrix
 * tests (TASK-307) can drive it in-process with stubbed deps. Production goes
 * through `.action()` above; tests construct their own `OutputContext` (with
 * `BufferSink` + `BufferExitCodeSink`) and pass injectable deps.
 *
 * The flow is unchanged from the previous inline body — this function is a
 * pure extraction.
 */
export async function runDoctorAction(
  options: DoctorOptions,
  out: OutputContext,
  deps: DoctorDeps = {}
): Promise<void> {
  const { config, globalOpts } = getContext();
  // `--system-only` is sugar for `--scope system`; passing both is allowed
  // (both are explicit and consistent), but a conflicting `--scope device`
  // / `--scope all` is rejected here so the user isn't silently overridden.
  if (options.systemOnly && options.scope !== undefined && options.scope !== 'system') {
    throw new CliError({
      message: `--system-only conflicts with --scope ${options.scope}. Pick one.`,
      code: DoctorErrorCodes.SCOPE_CONFLICT,
    });
  }
  const scope: DoctorScope = options.systemOnly ? 'system' : (options.scope ?? 'all');

  // System-only mode: no device or registered config required. Repair
  // owns its own scope detection (system-scope repairs already bypass
  // device resolution today), so --repair always falls through.
  if (scope === 'system' && !options.repair) {
    await runSystemOnlyDoctor(out, options, deps);
    return;
  }

  // Device-only mode without a repair must have an explicit device —
  // mirror the message style used by --repair to keep UX consistent.
  if (scope === 'device' && !options.repair && !globalOpts.device) {
    throw new CliError({
      message:
        'Doctor --scope device requires an explicit device. Use -d <name|path> to specify which iPod to check.',
      code: DoctorErrorCodes.DEVICE_REQUIRED,
    });
  }

  // Repair mode: validate requirements before resolving device
  if (options.repair) {
    // Look up the check
    const core = await loadCoreOrFail(deps, DoctorErrorCodes.CORE_LOAD_FAILED);
    const { getRepairCheckForValidation, getRepairCheck, PUBLIC_REPAIR_IDS } = core;

    // Use a device-agnostic variant for pre-device validation. For unified
    // IDs (orphan-files, debris-files) the iPod variant is the safe early
    // proxy — both variants share scope + requirements. After device
    // resolution we look up the device-specific variant via getRepairCheck.
    let check = getRepairCheckForValidation(options.repair);
    if (!check) {
      throw new CliError({
        message: `Unknown check ID: "${options.repair}". Available checks: ${[...PUBLIC_REPAIR_IDS].join(', ')}`,
        code: DoctorErrorCodes.UNKNOWN_CHECK,
        details: { checkId: options.repair, available: [...PUBLIC_REPAIR_IDS] },
      });
    }

    if (!check.repair) {
      throw new CliError({
        message: `Check "${options.repair}" does not support automatic repair.`,
        code: DoctorErrorCodes.CHECK_NOT_REPAIRABLE,
        details: { checkId: options.repair },
      });
    }

    // System-level repairs (scope === 'system' with no requirements) don't need a device.
    // Run them immediately without device resolution or database access.
    const isSystemRepair = check.scope === 'system' && check.repair.requirements.length === 0;

    if (isSystemRepair) {
      await runSystemRepair(check, options, out);
      return;
    }

    // Map domain requirements to CLI validation
    if (!globalOpts.device) {
      throw new CliError({
        message:
          'Repair requires an explicit device. Use -d <name|path> to specify which iPod to repair.',
        code: DoctorErrorCodes.DEVICE_REQUIRED,
      });
    }

    const needsSource = check.repair.requirements.includes('source-collection');
    if (needsSource && !options.collection) {
      const available = Object.keys(config.music ?? {});
      const hint = available.length > 0 ? ` Available collections: ${available.join(', ')}` : '';
      throw new CliError({
        message: `Repair "${options.repair}" requires a source collection. Use -c <name> to specify.${hint}`,
        code: DoctorErrorCodes.COLLECTION_REQUIRED,
        details: { checkId: options.repair, available },
      });
    }

    // Resolve device and run repair
    const resolved = await resolveDevice(out, deps);
    if ('error' in resolved) {
      throw new CliError({
        message: resolved.error,
        code: DoctorErrorCodes.DEVICE_NOT_RESOLVED,
      });
    }

    const isMassStorage =
      resolved.deviceConfig?.type !== undefined && resolved.deviceConfig.type !== 'ipod';

    // Re-resolve the check now that we know the device type. For unified
    // public IDs this swaps the iPod-variant `check` we used for early
    // validation with the actual device-specific variant. For non-unified
    // IDs it's a no-op (same check).
    const deviceTypeForDispatch: 'ipod' | 'mass-storage' = isMassStorage ? 'mass-storage' : 'ipod';
    const resolvedCheck = getRepairCheck(options.repair, deviceTypeForDispatch);
    if (!resolvedCheck) {
      // Should not happen — the early validation would have caught an
      // unknown public ID. But if a unified ID has no implementation for
      // this device type (e.g. a future ID with iPod-only support), we
      // need to fail explicitly.
      throw new CliError({
        message: `Repair "${options.repair}" is not available for ${isMassStorage ? 'mass-storage' : 'iPod'} devices.`,
        code: DoctorErrorCodes.INCOMPATIBLE_DEVICE_TYPE,
        details: { checkId: options.repair, deviceType: deviceTypeForDispatch },
      });
    }
    check = resolvedCheck;

    const applicableTypes = check.applicableTo ?? ['ipod'];
    if (isMassStorage) {
      if (!applicableTypes.includes('mass-storage')) {
        throw new CliError({
          message: `Repair "${options.repair}" is not available for mass-storage devices.`,
          code: DoctorErrorCodes.INCOMPATIBLE_DEVICE_TYPE,
          details: { checkId: options.repair, deviceType: resolved.deviceConfig?.type },
        });
      }
      await withDeviceWriteLock(
        resolved.path,
        /* isIpodDevice */ false,
        core,
        () =>
          runMassStorageRepair(resolved.path, resolved.deviceConfig!, check, options, out, config),
        { dryRun: options.dryRun ?? false }
      );
      return;
    }

    if (!applicableTypes.includes('ipod')) {
      throw new CliError({
        message: `Repair "${options.repair}" is not available for iPod devices.`,
        code: DoctorErrorCodes.INCOMPATIBLE_DEVICE_TYPE,
        details: { checkId: options.repair, deviceType: resolved.deviceConfig?.type ?? 'ipod' },
      });
    }

    await withDeviceWriteLock(
      resolved.path,
      /* isIpodDevice */ true,
      core,
      () => runRepair(resolved.path, check, options, out, config),
      { dryRun: options.dryRun ?? false }
    );
    return;
  }

  // Diagnostic-only mode
  const resolved = await resolveDevice(out, deps);
  if ('error' in resolved) {
    throw new CliError({
      message: `${resolved.error}\n\nTo run host-environment checks without a device, use \`podkit doctor --system-only\`.`,
      code: DoctorErrorCodes.DEVICE_NOT_RESOLVED,
    });
  }

  await runDoctorDiagnostics(resolved.path, resolved.deviceConfig, out, options, deps);
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

/**
 * Run iPod / mass-storage diagnostics for a resolved device path.
 *
 * Exported for unit tests (TASK-308) — production callers go through
 * the Commander action above. Tests pass `deps.loadCore` to inject a fake
 * `@podkit/core` module and `deps.getDeviceManager` for the readiness path.
 * For iPod tests that need to drive past `core.IpodDatabase.open`, supply a
 * fake `IpodDatabase` on the stubbed core module — the function calls
 * `core.IpodDatabase.open(devicePath)` and only reads `.getInfo()` + `.close()`.
 */
export async function runDoctorDiagnostics(
  devicePath: string,
  deviceConfig: DeviceConfig | undefined,
  out: OutputContext,
  options: DoctorOptions,
  deps: DoctorDeps = {}
): Promise<void> {
  const core = await loadCoreOrFail(deps, DoctorErrorCodes.CORE_LOAD_FAILED);

  const { config, globalOpts } = getContext();
  const isMassStorage = deviceConfig?.type !== undefined && deviceConfig.type !== 'ipod';
  const scopes = resolveDoctorScopes(options);

  // Mass-storage devices: resolve content paths and run applicable checks
  if (isMassStorage) {
    const presets = mergedPresets(config);
    const label = getDeviceTypeDisplayName(deviceConfig, presets);

    const contentPaths = resolveDeviceContentPaths(deviceConfig, config.deviceDefaults, presets);

    const report = await core.runDiagnostics({
      mountPoint: devicePath,
      deviceType: 'mass-storage',
      deviceModel: label,
      contentPaths,
      scopes,
    });

    // CSV format: dump the orphan-file list and exit before the human-
    // readable rendering. Symmetrical with the iPod path's CSV branch at
    // the bottom of this function — extracted into emitOrphanCsv so both
    // device-type code paths funnel through the same `details.orphans[]`
    // shape regardless of whether the underlying check ID is
    // `orphan-files` (iPod) or `orphan-files-mass-storage`.
    if (options.format === 'csv') {
      emitOrphanCsv(out, report);
      return;
    }

    const checksOutput: DoctorCheckOutput[] = report.checks.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      summary: c.summary,
      repairable: c.repairable,
      details: c.details,
      docsUrl: c.docsUrl,
      scope: c.scope,
    }));

    const output: DoctorOutput = {
      success: true,
      status: report.healthy ? 'ok' : 'issues-found',
      healthy: report.healthy,
      mountPoint: devicePath,
      deviceModel: label,
      deviceType: 'mass-storage',
      checks: checksOutput,
    };

    const getDiagnosticCheck = core.getDiagnosticCheck;

    out.result<DoctorOutput>(output, () => {
      out.print(`podkit doctor \u2014 ${label} at ${devicePath}`);

      const visibleChecks = report.checks.filter((c) => !c.repairOnly);

      if (visibleChecks.length === 0) {
        out.newline();
        out.print('  No health checks are currently available for this device.');
        out.print('  Run `podkit sync --dry-run` to verify your collection configuration.');
      } else {
        // Unified section structure \u2014 same as the iPod path, so users see a
        // consistent System / Device Readiness / Database Health layout
        // regardless of which device is plugged in. Empty sections omitted.
        printGroupedChecks(out, visibleChecks);
      }

      out.newline();
      const msIssueCount = report.checks.filter(
        (c) => (c.status === 'fail' || c.status === 'warn') && !c.repairOnly
      ).length;
      printSummaryLine(out, report.healthy, msIssueCount);

      // Issues section
      const msDeviceArg = shellQuote(globalOpts.device ?? devicePath);
      const msIssues: ReadinessIssue[] = [];
      for (const check of report.checks) {
        if (check.repairOnly || check.status === 'pass' || check.status === 'skip') continue;
        const diagCheck = getDiagnosticCheck(check.id);
        const fixCommand =
          check.repairable && diagCheck?.repair
            ? `podkit doctor --repair ${check.id} -d ${msDeviceArg}`
            : undefined;
        msIssues.push({
          marker: stageMarker(check.status),
          label: check.name,
          summary: check.summary,
          details: [],
          docsUrl: check.docsUrl,
          fixCommand,
        });
      }
      if (msIssues.length > 0) {
        out.newline();
        printIssues(out, msIssues);
      }
    });

    if (!report.healthy) {
      // Diagnostic ran cleanly but found problems — exit 2 distinguishes
      // this from a command error (exit 1).
      out.setExitCode(2);
    }
    return;
  }

  // ── Phase 1: Readiness checks ──────────────────────────────────────────

  // Locate the device's `DiscoveredDevice` record. After T5, the readiness
  // pipeline consumes the unified union directly — going through
  // `discoverConnectedDevices` gives us the iPod arm with its full
  // reconciled USB context (vendorId/productId/usb classification with the
  // unsupported reason already attached when applicable).
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();
  let discoveredIpod: import('@podkit/core').DiscoveredDeviceIpod | undefined;

  if (manager.isSupported) {
    try {
      const discovered = await core.discoverConnectedDevices({
        deviceManager: manager,
        massStoragePresets: mergedPresets(config),
      });
      discoveredIpod = discovered.find(
        (d): d is import('@podkit/core').DiscoveredDeviceIpod =>
          d.kind === 'ipod' && d.block?.mountPoint === devicePath
      );
    } catch {
      // Platform scanning not available — fall back to constructed info below.
    }
  }

  if (!discoveredIpod) {
    // Fallback: device path is known but doesn't correspond to a discovered
    // record (path-mode doctor against a directory; unsupported platform;
    // discovery threw). Synthesise a minimal block-side iPod arm so
    // readiness still runs.
    const syntheticBlock: import('@podkit/core').PlatformDeviceInfo = {
      identifier: 'unknown',
      volumeName: basename(devicePath),
      volumeUuid: '',
      isMounted: true,
      mountPoint: devicePath,
      storage: { sizeBytes: 0 },
    };
    discoveredIpod = core.ipodFromBlock(syntheticBlock);
  }

  let readinessResult: ReadinessResult | undefined;
  try {
    readinessResult = await core.checkReadiness({ device: discoveredIpod });
  } catch {
    // Readiness check failed — proceed without it
  }

  // Determine if the database is available from readiness results
  const dbStage = readinessResult?.stages.find((s) => s.stage === 'database');
  const dbAvailable = dbStage?.status === 'pass';

  // ── Phase 2: Database health checks (conditional) ──────────────────────

  let opened: Awaited<ReturnType<typeof openDevice>> | undefined;
  let report: import('@podkit/core').DiagnosticReport | undefined;

  if (dbAvailable) {
    try {
      opened = await openDevice(
        core,
        devicePath,
        deviceConfig,
        config.deviceDefaults,
        mergedPresets(config)
      );
    } catch {
      // Failed to open device — we'll show readiness results and skip DB checks
    }

    if (opened) {
      try {
        // Resolve a live FireWireGUID so device-scope checks (sysinfo
        // consistency) can compare against the connected device. Falls back
        // to undefined when the platform can't read USB descriptors —
        // checks then skip the GUID axis rather than failing.
        const usbDevice = await core.resolveUsbDeviceFromPath(devicePath).catch(() => null);

        const liveIdentity = {
          firewireGuid: usbDevice?.serialNumber ?? undefined,
          model: readinessResult?.usbModel,
        };

        report = await core.runDiagnostics({
          mountPoint: devicePath,
          deviceType: 'ipod',
          db: opened.ipod,
          deviceModel: opened.ipod?.getInfo().device.modelName ?? undefined,
          liveIdentity,
          scopes,
        });
      } catch {
        // Diagnostics failed — we'll show readiness results and skip DB checks
      }
    }
  }

  // ── Build output ───────────────────────────────────────────────────────

  const deviceModel =
    report?.deviceModel ??
    (readinessResult?.deviceModel ?? readinessResult?.usbModel)?.displayName ??
    'Unknown';

  const readinessOutput = readinessResult
    ? {
        level: readinessResult.level,
        stages: readinessResult.stages.map((s) => ({
          stage: s.stage,
          status: s.status,
          summary: s.summary,
          details: s.details,
        })),
        ...(readinessResult.unsupported ? { unsupported: readinessResult.unsupported } : {}),
      }
    : undefined;

  const checksOutput: DoctorCheckOutput[] = report
    ? report.checks.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        summary: c.summary,
        repairable: c.repairable,
        details: c.details,
        docsUrl: c.docsUrl,
        scope: c.scope,
      }))
    : [];

  // Healthy = readiness OK + all DB checks pass
  const readinessHealthy = !readinessResult || readinessResult.level === 'ready';
  const dbHealthy = report ? report.healthy : dbAvailable !== false || !readinessResult;
  const healthy = readinessHealthy && dbHealthy;

  const output: DoctorOutput = {
    success: true,
    status: healthy ? 'ok' : 'issues-found',
    healthy,
    mountPoint: devicePath,
    deviceModel,
    deviceType: 'ipod',
    readiness: readinessOutput,
    checks: checksOutput,
  };

  // Unsupported short-circuit: the device is recognised but podkit refuses
  // to operate on it. Skip the rest of the rendering — there's no useful
  // database section, no repair to suggest. Render a focused message and
  // emit exit 1 (distinguished from exit 2 "issues found"; this is
  // closer to a hard rejection than a fixable issue).
  if (readinessResult?.level === 'unsupported') {
    out.result<DoctorOutput>(output, () => {
      out.print(`podkit doctor — checking iPod at ${devicePath}`);
      out.newline();
      out.error('Device is not supported by podkit.');
      const unsupported = readinessResult.unsupported;
      if (unsupported) {
        out.newline();
        out.print(unsupported.headline);
        if (unsupported.details) {
          for (const line of unsupported.details) {
            out.print(`  ${line}`);
          }
        }
      }
      out.newline();
      out.print(`See: ${unsupported?.docsUrl ?? DOCS_URLS.supportedDevices}`);
    });
    opened?.ipod?.close();
    out.setExitCode(1);
    return;
  }

  // CSV format: dump orphan file list and exit
  if (options.format === 'csv') {
    if (report) {
      emitOrphanCsv(out, report);
    }
    opened?.ipod?.close();
    return;
  }

  const getDiagnosticCheck = core.getDiagnosticCheck;

  // Echo back the device argument the user typed (config name or path)
  // so action commands are copy-pasteable verbatim.
  const deviceArg = shellQuote(globalOpts.device ?? devicePath);

  // Collect actions across readiness + DB checks; rendered as a single
  // section after the issue summary.
  const actions: SuggestedAction[] = [];
  if (readinessResult) {
    for (const stage of readinessResult.stages) {
      if (stage.stage === 'sysinfo' && (stage.status === 'fail' || stage.status === 'warn')) {
        actions.push({
          reason: 'Create SysInfoExtended from USB device information',
          command: `podkit doctor --repair sysinfo-extended -d ${deviceArg}`,
        });
      }
      if (stage.stage === 'database' && stage.status === 'fail') {
        actions.push({
          reason: 'Initialize the iPod database',
          command: `podkit device init -d ${deviceArg}`,
        });
      }
    }
  }
  if (report) {
    for (const check of report.checks) {
      if (!check.repairable || check.repairOnly || check.scope !== 'database-health') continue;
      if (check.status !== 'fail' && check.status !== 'warn') continue;
      const diagCheck = getDiagnosticCheck(check.id);
      if (!diagCheck?.repair) continue;
      const needsCollection = diagCheck.repair.requirements.includes('source-collection');
      const colArg = needsCollection ? ' -c <collection>' : '';
      actions.push({
        reason: check.name,
        command: `podkit doctor --repair ${check.id} -d ${deviceArg}${colArg}`,
      });
      if (check.id === 'artwork-rebuild') {
        actions.push({
          reason: 'Or clear all artwork (no source needed)',
          command: `podkit doctor --repair artwork-reset -d ${deviceArg}`,
        });
      }
    }
  }

  out.result<DoctorOutput>(output, () => {
    out.print(`podkit doctor \u2014 checking iPod at ${devicePath}`);

    // ── System section ──
    if (report) {
      const systemChecks = report.checks.filter((c) => c.scope === 'system' && !c.repairOnly);
      if (systemChecks.length > 0) {
        out.newline();
        out.print('System');
        for (const check of systemChecks) {
          out.print(formatCheckRow(check));
        }
      }
    }

    // ── Device Readiness section (compact summary) ──
    out.newline();
    out.print('Device Readiness');

    if (readinessResult) {
      printReadinessSummary(out, readinessResult.stages);
    }

    // ── Database Health section (compact summary) ──
    out.newline();
    out.print('Database Health');

    if (!report) {
      if (readinessResult && !dbAvailable) {
        out.print('  Skipped \u2014 device database is not available.');
      } else if (!readinessResult) {
        out.print('  Skipped \u2014 could not run database health checks.');
      } else {
        out.print('  Skipped \u2014 could not open the device database.');
      }
    } else {
      for (const check of report.checks) {
        if (check.repairOnly) continue;
        // Only database-health checks render here. Device-readiness checks are
        // surfaced by the dedicated readiness pipeline above on the iPod path;
        // system-scope checks render in the "System" section.
        if (check.scope !== 'database-health') continue;
        out.print(formatCheckRow(check));

        // Orphan files: verbose summary inline (it's informational, not an error)
        if (check.id === 'orphan-files' && check.status === 'warn' && check.details) {
          printOrphanSummary(out, check.details as Record<string, unknown>);
        }
      }
    }

    // ── Summary line ──
    out.newline();
    let issueCount = 0;
    if (readinessResult) {
      issueCount += readinessResult.stages.filter(
        (s) => s.status === 'fail' || s.status === 'warn'
      ).length;
    }
    if (report) {
      issueCount += report.checks.filter(
        (c) => (c.status === 'fail' || c.status === 'warn') && !c.repairOnly
      ).length;
    }
    printSummaryLine(out, healthy, issueCount);

    // ── Issues section (detailed) ──
    const allIssues: ReadinessIssue[] = [];

    // Readiness issues
    if (readinessResult) {
      allIssues.push(...collectReadinessIssues(readinessResult.stages, deviceArg));
    }

    // System check issues
    if (report) {
      const systemChecks = report.checks.filter((c) => c.scope === 'system' && !c.repairOnly);
      for (const check of systemChecks) {
        if (check.status !== 'fail' && check.status !== 'warn') continue;
        allIssues.push({
          marker: stageMarker(check.status),
          label: check.name,
          summary: check.summary,
          details: [],
          docsUrl: check.docsUrl,
        });
      }
    }

    // Database health issues
    if (report) {
      for (const check of report.checks) {
        if (check.repairOnly || check.scope !== 'database-health') continue;
        if (check.status !== 'fail' && check.status !== 'warn') continue;

        const details = formatFailureCopy(
          check.id,
          check.details as Record<string, unknown> | undefined,
          check.status
        );

        // Build fix command from actions
        const action = actions.find((a) => a.command.includes(check.id));
        const fixCommand = action?.command;

        allIssues.push({
          marker: stageMarker(check.status),
          label: check.name,
          summary: check.summary,
          details,
          docsUrl: check.docsUrl,
          fixCommand,
        });

        // Artwork rebuild also suggests artwork-reset
        if (check.id === 'artwork-rebuild') {
          const resetAction = actions.find((a) => a.command.includes('artwork-reset'));
          if (resetAction) {
            allIssues.push({
              marker: '!',
              label: 'Alternative',
              summary: 'Clear all artwork (no source needed)',
              details: [],
              fixCommand: resetAction.command,
            });
          }
        }
      }
    }

    if (allIssues.length > 0) {
      out.newline();
      printIssues(out, allIssues);
    }
  });

  opened?.ipod?.close();

  if (!healthy) {
    // Diagnostic ran cleanly but found problems — exit 2 distinguishes
    // this from a command error (exit 1).
    out.setExitCode(2);
  }
}

// ── System-only diagnostics (no device required) ────────────────────────────

/**
 * Run only system-scope checks. Skips device resolution, readiness, and
 * database health — callable on a machine with no iPod plugged in, which
 * is the entry point for VM-test baseline assertions (see TASK-322.06).
 *
 * Exported for unit-test injection: tests pass a `loadCore` stub to assert
 * which scopes are forwarded to `runDiagnostics`.
 */
export async function runSystemOnlyDoctor(
  out: OutputContext,
  _options: DoctorOptions,
  deps: DoctorDeps = {}
): Promise<void> {
  const core = await loadCoreOrFail(deps, DoctorErrorCodes.CORE_LOAD_FAILED);

  // mountPoint is empty: the only checks that run are system-scope, none of
  // which read it. The internal IpodDatabase.open attempt fails silently
  // (see runDiagnostics) and the system checks proceed without a db handle.
  const report = await core.runDiagnostics({
    mountPoint: '',
    deviceType: 'ipod',
    scopes: ['system'],
  });

  const checksOutput: DoctorCheckOutput[] = report.checks.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    summary: c.summary,
    repairable: c.repairable,
    details: c.details,
    docsUrl: c.docsUrl,
    scope: c.scope,
  }));

  const healthy = report.healthy;
  const output: SystemDoctorOutput = {
    success: true,
    status: healthy ? 'ok' : 'issues-found',
    healthy,
    scope: 'system',
    checks: checksOutput,
  };

  out.result<SystemDoctorOutput>(output, () => {
    out.print('podkit doctor — system checks');

    if (report.checks.length === 0) {
      out.newline();
      out.print('  No system checks are registered.');
    } else {
      out.newline();
      out.print('System');
      for (const check of report.checks) {
        out.print(formatCheckRow(check));
      }
    }

    out.newline();
    const issueCount = report.checks.filter(
      (c) => c.status === 'fail' || c.status === 'warn'
    ).length;
    printSummaryLine(out, healthy, issueCount);

    const issues: ReadinessIssue[] = [];
    for (const check of report.checks) {
      if (check.status !== 'fail' && check.status !== 'warn') continue;
      issues.push({
        marker: stageMarker(check.status),
        label: check.name,
        summary: check.summary,
        details: [],
        docsUrl: check.docsUrl,
      });
    }
    if (issues.length > 0) {
      out.newline();
      printIssues(out, issues);
    }
  });

  if (!healthy) {
    out.setExitCode(2);
  }
}

// ── System-level repair (no device required) ─────────────────────────────────

/**
 * Run a system-level repair that requires no device or database access.
 * Used for repairs like `udev-rule` that operate on the host system
 * independently of any connected iPod.
 */
async function runSystemRepair(
  check: NonNullable<ReturnType<typeof import('@podkit/core').getDiagnosticCheck>>,
  options: DoctorOptions,
  out: OutputContext
): Promise<void> {
  // Verbose defensively read so direct test invocation (no CLI context)
  // doesn't break the surface.
  let verbose = 0;
  try {
    verbose = getContext().globalOpts.verbose ?? 0;
  } catch {
    /* no CLI context (test path) — default to 0 */
  }

  await runRepairPipeline({
    check,
    ctx: { mountPoint: '', deviceType: 'ipod', adapters: [] },
    dryRun: options.dryRun ?? false,
    verbose,
    out,
    withoutShutdown: true,
    successLine: 'Repair complete.',
  });
}

// ── Repair ──────────────────────────────────────────────────────────────────

/**
 * Exported for unit testing. Runs an iPod-scoped repair, opening the iTunesDB
 * only when the repair declares a `'database'` requirement.
 */
export async function runRepair(
  devicePath: string,
  check: NonNullable<ReturnType<typeof import('@podkit/core').getDiagnosticCheck>>,
  options: DoctorOptions,
  out: OutputContext,
  config: ReturnType<typeof getContext>['config'],
  deps: {
    loadCore?: () => Promise<typeof import('@podkit/core')>;
    /** Override the cascade-unsupported preflight assessor (tests). */
    assessIpodIdentity?: typeof import('@podkit/core').assessIpodIdentity;
  } = {}
): Promise<void> {
  const repair = check.repair!;
  const dryRun = options.dryRun ?? false;
  // Verbose defensively read — tests invoke this helper without
  // bootstrapping the CLI context.
  let verbose = 0;
  try {
    verbose = getContext().globalOpts.verbose ?? 0;
  } catch {
    /* test path — no CLI context, default to 0 */
  }

  let core: typeof import('@podkit/core');
  try {
    core = await (deps.loadCore ?? (() => import('@podkit/core')))();
  } catch (err) {
    throw new CliError({
      message: err instanceof Error ? err.message : 'Failed to load podkit-core',
      code: DoctorErrorCodes.CORE_LOAD_FAILED,
    });
  }

  // Refuse mutating repair on cascade-unsupported devices BEFORE opening
  // the iPod database. Opening libgpod against SQLite-based unsupported
  // generations (hashAB nano 6/7, shuffle 3/4, iOS) risks corrupting
  // on-device state — the preflight must run before any device handle is
  // acquired, so we can't rely on the pipeline's own internal preflight.
  await preflightCascadeRefusal(
    check,
    { deviceType: 'ipod', mountPoint: devicePath },
    { assessIpodIdentity: deps.assessIpodIdentity ?? core.assessIpodIdentity }
  );

  // Open the iPod database only when this repair declares it needs it.
  // Repairs that populate identity (sysinfo-extended, sysinfo-consistency)
  // must run on freshly-formatted iPods that have no database yet — gating
  // them behind IpodDatabase.open() would create a chicken-and-egg failure.
  const needsDatabase = repair.requirements.includes('database');
  let db: Awaited<ReturnType<typeof core.IpodDatabase.open>> | undefined;
  if (needsDatabase) {
    try {
      db = await core.IpodDatabase.open(devicePath);
    } catch (err) {
      throw new CliError({
        message: err instanceof Error ? err.message : 'Failed to open iPod database',
        code: DoctorErrorCodes.IPOD_DATABASE_OPEN_FAILED,
      });
    }
  }

  const adapters: import('@podkit/core').CollectionAdapter[] = [];

  try {
    // Resolve source collection adapters if needed.
    const needsSource = repair.requirements.includes('source-collection');
    if (needsSource && options.collection) {
      const allMusic = config.music ?? {};
      const found = allMusic[options.collection];
      if (!found) {
        const available = Object.keys(allMusic);
        const msg =
          available.length > 0
            ? `Available collections: ${available.join(', ')}`
            : 'No music collections configured.';
        throw new CliError({
          message: `Music collection "${options.collection}" not found. ${msg}`,
          code: DoctorErrorCodes.COLLECTION_NOT_FOUND,
          details: { collection: options.collection, available },
        });
      }
      try {
        const adapter = createMusicAdapter({ config: found, name: options.collection });
        await adapter.connect();
        adapters.push(adapter);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CliError({
          message: `Failed to connect to source collection: ${message}`,
          code: DoctorErrorCodes.ADAPTER_CONNECT_FAILED,
          details: { collection: options.collection },
        });
      }
    }

    await runRepairPipeline({
      check,
      ctx: {
        mountPoint: devicePath,
        deviceType: 'ipod',
        adapters,
        ...(db ? { db } : {}),
      },
      dryRun,
      verbose,
      out,
    });
  } finally {
    for (const adapter of adapters) {
      try {
        await adapter.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    db?.close();
  }
}

// ── Per-device write lock ──────────────────────────────────────────────

/**
 * Acquire the per-device sync lock, run `fn`, release the lock in a
 * `finally`. Translates `LockHeldError` / `LockContestedError` into a
 * `CliError` with code `LOCK_HELD` and exit code `4`, mirroring `podkit
 * sync` so the daemon (and any other caller) can branch on a single
 * contention exit code regardless of which writer surface lost the race.
 *
 * When `dryRun` is `true`, the lock is skipped entirely — the repair fn
 * runs directly with no lock acquire and no `finally` release. This
 * mirrors `podkit sync --dry-run`, which also bypasses the lock on the
 * grounds that dry-run is read-only by design and cannot corrupt state.
 *
 * Every doctor repair that mutates on-device state (manifest writes,
 * iTunesDB writes via libgpod, SysInfo / SysInfoExtended writes, physical
 * file deletes that could collide with an in-flight sync's adds) must go
 * through this wrapper. Read-only repairs do not exist today — every
 * registered repair writes something — so this helper is exercised on
 * every `--repair` path that requires a device.
 *
 * Release is best-effort: an `unlink` failure (already-released file,
 * unmounted device) is swallowed because the next acquireLock's liveness
 * probe will reclaim it.
 *
 * Exported for unit-test coverage of the contention path — production
 * callers go through `runDoctorAction`.
 */
export async function withDeviceWriteLock<T>(
  devicePath: string,
  isIpodDevice: boolean,
  core: typeof import('@podkit/core'),
  fn: () => Promise<T>,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<T> {
  // Dry-run is read-only by design — skip lock acquisition entirely so a
  // user can inspect state during a live sync without contending on the lock.
  if (dryRun) {
    return fn();
  }

  const lockPath = await core.resolveSyncLockPath(devicePath, isIpodDevice);
  let handle: import('@podkit/core').LockHandle;
  try {
    handle = await core.acquireLock(lockPath);
  } catch (err) {
    if (err instanceof core.LockHeldError) {
      const heldPid = err.pid;
      throw new CliError({
        message: `Another podkit process is using ${devicePath} (pid ${heldPid}). Wait for it to finish or kill it.`,
        code: DoctorErrorCodes.LOCK_HELD,
        exitCode: DOCTOR_LOCK_HELD_EXIT_CODE,
        details: { device: devicePath, holderPid: heldPid, lockPath: err.lockPath },
        printText: (o) => {
          o.error(`Another podkit process is using ${devicePath} (pid ${heldPid}).`);
          o.error('Wait for it to finish or kill it.');
          if (o.isVerbose) {
            o.error('');
            o.error(`Lock file: ${err.lockPath}`);
          }
        },
      });
    }
    if (err instanceof core.LockContestedError) {
      throw new CliError({
        message: err.message,
        code: DoctorErrorCodes.LOCK_HELD,
        exitCode: DOCTOR_LOCK_HELD_EXIT_CODE,
        details: { device: devicePath, lockPath: err.lockPath },
        printText: (o) => {
          o.error(err.message);
        },
      });
    }
    if (err instanceof core.LockUnavailableError) {
      // FS-level write refusal on the lock path itself — mirror sync.ts.
      // Exit code 1 (generic) is intentional: contention exit code 4 is
      // reserved for cases where another process IS using the device.
      throw new CliError({
        message: err.message,
        code: DoctorErrorCodes.LOCK_UNAVAILABLE,
        details: { device: devicePath, lockPath: err.lockPath, errno: err.code },
        printText: (o) => {
          o.error(`Cannot acquire sync lock at ${err.lockPath} (${err.code}).`);
          o.error(
            'The directory containing the lock file is not writable. ' +
              'Check permissions and that the device is mounted read-write.'
          );
        },
      });
    }
    throw err;
  }
  try {
    return await fn();
  } finally {
    try {
      await handle.release();
    } catch {
      // See LockHandle.release: tolerant by design.
    }
  }
}

// ── Mass-storage helpers ─────────────────────────────────────────────────

async function runMassStorageRepair(
  devicePath: string,
  deviceConfig: DeviceConfig,
  check: NonNullable<ReturnType<typeof import('@podkit/core').getDiagnosticCheck>>,
  options: DoctorOptions,
  out: OutputContext,
  config: ReturnType<typeof getContext>['config']
): Promise<void> {
  await runRepairPipeline({
    check,
    ctx: {
      mountPoint: devicePath,
      deviceType: 'mass-storage',
      contentPaths: resolveDeviceContentPaths(
        deviceConfig,
        config.deviceDefaults,
        mergedPresets(config)
      ),
      adapters: [],
    },
    dryRun: options.dryRun ?? false,
    verbose: 0,
    out,
    compactProgress: true,
  });
}

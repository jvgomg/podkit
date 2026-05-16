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

import { basename, dirname } from 'node:path';
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
} as const;
export type DoctorErrorCode = (typeof DoctorErrorCodes)[keyof typeof DoctorErrorCodes];

export type DoctorErrorOutput = CliErrorOutput & { code: DoctorErrorCode };
import { existsSync } from '../utils/fs.js';
import { createMusicAdapter } from '../utils/source-adapter.js';
import { createShutdownController } from '../shutdown.js';
import { openDevice, getDeviceTypeDisplayName } from './open-device.js';
import type { ReadinessResult } from '@podkit/core';
import { BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';
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
    /** Canonical rejection reason; only set when level === 'unsupported'. */
    unsupportedReason?: string;
  };
  checks: DoctorCheckOutput[];
}

interface RepairOutput {
  success: true;
  summary: string;
  checkId: string;
  dryRun: boolean;
  details?: Record<string, unknown>;
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
  options: Pick<DoctorOptions, 'scope' | 'system'>
): ReadonlyArray<'system' | 'device'> {
  const scope: DoctorScope = options.scope ?? 'all';
  if (scope === 'system') return ['system'];
  if (scope === 'device') return ['device'];
  return options.system === false ? ['device'] : ['system', 'device'];
}

// ── Suggested actions ────────────────────────────────────────────────────────

interface SuggestedAction {
  /** Why the user might want to run this — printed as a section heading. */
  reason: string;
  /** Exact command to run, including the user's `-d` argument. */
  command: string;
}

/**
 * Quote a CLI argument so users can copy-paste the action verbatim. Returns
 * an unquoted token when the value has no whitespace or shell metacharacters,
 * otherwise wraps it in double quotes with embedded `"` and `\` escaped.
 */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+,=-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
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
      'artwork-rebuild',
      'artwork-reset',
      'orphan-files',
      'orphan-files-mass-storage',
      'sysinfo-consistency',
      'sysinfo-extended',
      'udev-rule',
    ])
  )
  .option('-c, --collection <name>', 'music collection to use as artwork source')
  .option('--dry-run', 'preview repair without modifying the iPod')
  .option('--format <fmt>', 'output format for file lists (csv)')
  .option('--no-system', 'skip system-scope checks (FFmpeg, SCSI transport, udev rule, etc.)')
  .addOption(
    new Option(
      '--scope <scope>',
      'restrict checks: system-only (no device required), device-only (requires -d), or all'
    )
      .choices(['system', 'device', 'all'])
      .default('all')
  )
  .action(async (options: DoctorOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runDoctorAction(options, out));
  });

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
  const scope: DoctorScope = options.scope ?? 'all';

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
    const { getDiagnosticCheck, getDiagnosticCheckIds } = core;

    const check = getDiagnosticCheck(options.repair);
    if (!check) {
      const available = getDiagnosticCheckIds();
      throw new CliError({
        message: `Unknown check ID: "${options.repair}". Available checks: ${available.join(', ')}`,
        code: DoctorErrorCodes.UNKNOWN_CHECK,
        details: { checkId: options.repair, available },
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
    if (isMassStorage) {
      // Check if this repair check applies to mass-storage
      const applicableTypes = check.applicableTo ?? ['ipod'];
      if (!applicableTypes.includes('mass-storage')) {
        throw new CliError({
          message: `Repair "${options.repair}" is not available for mass-storage devices.`,
          code: DoctorErrorCodes.INCOMPATIBLE_DEVICE_TYPE,
          details: { checkId: options.repair, deviceType: resolved.deviceConfig?.type },
        });
      }
      await runMassStorageRepair(
        resolved.path,
        resolved.deviceConfig!,
        check,
        options,
        out,
        config
      );
      return;
    }

    await runRepair(resolved.path, check, options, out, config);
    return;
  }

  // Diagnostic-only mode
  const resolved = await resolveDevice(out, deps);
  if ('error' in resolved) {
    throw new CliError({
      message: resolved.error,
      code: DoctorErrorCodes.DEVICE_NOT_RESOLVED,
    });
  }

  await runDoctorDiagnostics(resolved.path, resolved.deviceConfig, out, options, deps);
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

/**
 * Run iPod / mass-storage diagnostics for a resolved device path.
 *
 * Exported for Tier-1 unit tests (TASK-308) — production callers go through
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
    const label = getDeviceTypeDisplayName(deviceConfig?.type);

    const contentPaths = resolveMassStorageContentPaths(deviceConfig!, config.deviceDefaults, core);

    const report = await core.runDiagnostics({
      mountPoint: devicePath,
      deviceType: 'mass-storage',
      deviceModel: label,
      contentPaths,
      scopes,
    });

    const checksOutput: DoctorCheckOutput[] = report.checks.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      summary: c.summary,
      repairable: c.repairable,
      details: c.details,
      docsUrl: c.docsUrl,
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

      if (report.checks.length === 0) {
        out.newline();
        out.print('  No health checks are currently available for this device.');
        out.print('  Run `podkit sync --dry-run` to verify your collection configuration.');
      } else {
        out.newline();
        out.print('Device Health');

        for (const check of report.checks) {
          if (check.repairOnly) continue;
          const sym = stageMarker(check.status);
          out.print(`  ${sym} ${check.name}    ${check.summary}`);
        }
      }

      out.newline();
      if (report.healthy) {
        out.success('All checks passed.');
      } else {
        const issueCount = report.checks.filter(
          (c) => (c.status === 'fail' || c.status === 'warn') && !c.repairOnly
        ).length;
        out.error(`${issueCount || 1} issue${issueCount === 1 ? '' : 's'} found.`);
      }

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

  // Build a PlatformDeviceInfo for the readiness pipeline.
  // Try to find the real device info from the platform device manager first,
  // fall back to a minimal constructed info if not found.
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();
  let deviceInfo: import('@podkit/core').PlatformDeviceInfo | undefined;

  if (manager.isSupported) {
    try {
      const ipods = await manager.findIpodDevices();
      deviceInfo = ipods.find((d) => d.mountPoint === devicePath);
    } catch {
      // Platform scanning not available — fall back to constructed info
    }
  }

  if (!deviceInfo) {
    deviceInfo = {
      identifier: 'unknown',
      volumeName: basename(devicePath),
      volumeUuid: '',
      size: 0,
      isMounted: true,
      mountPoint: devicePath,
    };
  }

  let readinessResult: ReadinessResult | undefined;
  try {
    readinessResult = await core.checkReadiness({ device: deviceInfo });
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
      opened = await openDevice(core, devicePath, deviceConfig, config.deviceDefaults);
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
        ...(readinessResult.unsupportedReason
          ? { unsupportedReason: readinessResult.unsupportedReason }
          : {}),
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
      if (readinessResult.unsupportedReason) {
        out.newline();
        out.print(readinessResult.unsupportedReason);
      }
      out.newline();
      out.print('See: https://jvgomg.github.io/podkit/devices/supported-devices');
    });
    opened?.ipod?.close();
    out.setExitCode(1);
    return;
  }

  // CSV format: dump orphan file list and exit
  if (options.format === 'csv') {
    if (report) {
      const orphanCheck = report.checks.find((c) => c.id === 'orphan-files');
      const orphans = (orphanCheck?.details as Record<string, unknown>)?.orphans as
        | Array<{ path: string; size: number }>
        | undefined;
      if (orphans && orphans.length > 0) {
        out.stdout('path,size');
        for (const o of orphans) {
          out.stdout(`${escapeCsvField(o.path)},${o.size}`);
        }
      }
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
      if (!check.repairable || check.repairOnly || check.scope === 'system') continue;
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
          const sym = stageMarker(check.status);
          out.print(`  ${sym} ${check.name}    ${check.summary}`);
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
        if (check.repairOnly || check.scope === 'system') continue;
        const sym = stageMarker(check.status);
        out.print(`  ${sym} ${check.name}    ${check.summary}`);

        // Orphan files: verbose summary inline (it's informational, not an error)
        if (check.id === 'orphan-files' && check.status === 'warn' && check.details) {
          printOrphanSummary(check.details as Record<string, unknown>, out);
        }
      }
    }

    // ── Summary line ──
    out.newline();
    if (healthy) {
      out.success('All checks passed.');
    } else {
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
      if (issueCount === 0) issueCount = 1;
      out.error(`${issueCount} issue${issueCount === 1 ? '' : 's'} found.`);
    }

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
        if (check.repairOnly || check.scope === 'system') continue;
        if (check.status !== 'fail' && check.status !== 'warn') continue;

        const details: string[] = [];

        // Artwork corruption details
        if (check.status === 'fail' && check.details) {
          const d = check.details as Record<string, unknown>;
          if (d.totalEntries !== undefined) {
            const total = (d.totalEntries as number).toLocaleString();
            const corrupt = (d.corruptEntries as number).toLocaleString();
            const healthyEntries = (d.healthyEntries as number).toLocaleString();
            const pct = d.corruptPercent;
            details.push(
              `Corrupt: ${corrupt} / ${total} entries (${pct}%) reference data beyond ithmb file bounds`
            );
            details.push(`Healthy: ${healthyEntries} entries with valid offsets`);
          }
          details.push('The artwork database is out of sync with the thumbnail files.');
          details.push('Affected tracks display wrong or missing artwork on the iPod.');
        }

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
 * is the entry point for Tier-3 baseline assertions (see TASK-322.06).
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
        const sym = stageMarker(check.status);
        out.print(`  ${sym} ${check.name}    ${check.summary}`);
      }
    }

    out.newline();
    if (healthy) {
      out.success('All checks passed.');
    } else {
      const issueCount = report.checks.filter(
        (c) => c.status === 'fail' || c.status === 'warn'
      ).length;
      out.error(`${issueCount || 1} issue${issueCount === 1 ? '' : 's'} found.`);
    }

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
  const repair = check.repair!;
  const dryRun = options.dryRun ?? false;

  if (!dryRun) {
    out.print(`Repairing ${check.id}: ${repair.description}...`);
    out.newline();
  } else {
    out.print(`Dry run: ${repair.description}...`);
    out.newline();
  }

  // System repairs receive a minimal stub context (no real device needed).
  const stubCtx = {
    mountPoint: '',
    deviceType: 'ipod' as const,
    adapters: [],
  };

  let result: Awaited<ReturnType<typeof repair.run>>;
  try {
    result = await repair.run(stubCtx, { dryRun });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError({
      message: `Repair failed: ${message}`,
      code: DoctorErrorCodes.REPAIR_FAILED,
      details: { checkId: check.id },
    });
  }

  if (!result.success) {
    throw new CliError({
      message: result.summary,
      code: DoctorErrorCodes.REPAIR_FAILED,
      details: { checkId: check.id, dryRun, ...result.details },
    });
  }

  const output: RepairOutput = {
    success: true,
    summary: result.summary,
    checkId: check.id,
    dryRun,
    details: result.details,
  };

  out.result<RepairOutput>(output, () => {
    out.print(result.summary);

    if (!dryRun) {
      out.newline();
      out.success('Repair complete.');
    }
  });
}

// ── Repair ──────────────────────────────────────────────────────────────────

async function runRepair(
  devicePath: string,
  check: NonNullable<ReturnType<typeof import('@podkit/core').getDiagnosticCheck>>,
  options: DoctorOptions,
  out: OutputContext,
  config: ReturnType<typeof getContext>['config']
): Promise<void> {
  const repair = check.repair!;
  const dryRun = options.dryRun ?? false;

  let core: typeof import('@podkit/core');
  try {
    core = await import('@podkit/core');
  } catch (err) {
    throw new CliError({
      message: err instanceof Error ? err.message : 'Failed to load podkit-core',
      code: DoctorErrorCodes.CORE_LOAD_FAILED,
    });
  }

  // Open iPod database
  let db: Awaited<ReturnType<typeof core.IpodDatabase.open>>;
  try {
    db = await core.IpodDatabase.open(devicePath);
  } catch (err) {
    throw new CliError({
      message: err instanceof Error ? err.message : 'Failed to open iPod database',
      code: DoctorErrorCodes.IPOD_DATABASE_OPEN_FAILED,
    });
  }

  const adapters: import('@podkit/core').CollectionAdapter[] = [];

  try {
    // Resolve source collection adapters if needed
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
        const adapter = createMusicAdapter({
          config: found,
          name: options.collection,
        });
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

    if (!dryRun) {
      out.print(`Repairing ${check.id}: ${repair.description}...`);
      out.newline();
    } else {
      out.print(`Dry run: ${repair.description}...`);
      out.newline();
    }

    const shutdown = createShutdownController();
    shutdown.install();

    let result: Awaited<ReturnType<typeof repair.run>>;
    try {
      result = await repair.run(
        { mountPoint: devicePath, deviceType: 'ipod', db, adapters },
        {
          dryRun,
          signal: shutdown.signal,
          onProgress: (progress) => {
            if (!out.isText) return;
            const p = progress as Record<string, unknown>;
            if (typeof p.current === 'number' && typeof p.total === 'number') {
              const pct = Math.round((p.current / p.total) * 100);
              let line = `\r  ${p.current} / ${p.total}  (${pct}%)`;
              // Append check-specific counters when present
              if (typeof p.matched === 'number') line += `  Matched: ${p.matched}`;
              if (typeof p.noSource === 'number') line += `  No source: ${p.noSource}`;
              if (typeof p.noArtwork === 'number') line += `  No artwork: ${p.noArtwork}`;
              process.stderr.write(line);
            } else if (typeof p.message === 'string') {
              process.stderr.write(`\r  ${p.message}`);
            }
          },
        }
      );
    } catch (err) {
      // Clear progress line before bubbling
      if (out.isText) {
        process.stderr.write('\r' + ' '.repeat(100) + '\r');
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new CliError({
        message: `Repair failed: ${message}`,
        code: DoctorErrorCodes.REPAIR_FAILED,
        details: { checkId: check.id },
      });
    } finally {
      shutdown.uninstall();
    }

    // Clear progress line
    if (out.isText) {
      process.stderr.write('\r' + ' '.repeat(100) + '\r');
    }

    if (!result.success) {
      throw new CliError({
        message: result.summary,
        code: DoctorErrorCodes.REPAIR_FAILED,
        details: { checkId: check.id, dryRun, ...result.details },
      });
    }

    const output: RepairOutput = {
      success: true,
      summary: result.summary,
      checkId: check.id,
      dryRun,
      details: result.details,
    };

    out.result<RepairOutput>(output, () => {
      out.print(result.summary);

      if (!dryRun) {
        out.newline();
        out.success('Repair complete. Run `podkit doctor` to verify.');
      }
    });
  } finally {
    for (const adapter of adapters) {
      try {
        await adapter.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    db.close();
  }
}

// ── Mass-storage helpers ─────────────────────────────────────────────────

/**
 * Resolve content paths for a mass-storage device from the config chain:
 * preset defaults < global deviceDefaults < per-device config.
 */
function resolveMassStorageContentPaths(
  deviceConfig: DeviceConfig,
  globalDefaults: ReturnType<typeof getContext>['config']['deviceDefaults'],
  core: typeof import('@podkit/core')
): import('@podkit/core').ContentPaths {
  const presetId = (deviceConfig.type ?? 'generic') as keyof typeof BUILT_IN_PRESETS;
  const builtInPreset = BUILT_IN_PRESETS[presetId];
  const presetDefaults = builtInPreset?.contentPaths;
  const overrides: Partial<import('@podkit/core').ContentPaths> = {};
  if (globalDefaults?.musicDir !== undefined) overrides.musicDir = globalDefaults.musicDir;
  if (globalDefaults?.moviesDir !== undefined) overrides.moviesDir = globalDefaults.moviesDir;
  if (globalDefaults?.tvShowsDir !== undefined) overrides.tvShowsDir = globalDefaults.tvShowsDir;
  if (deviceConfig.musicDir !== undefined) overrides.musicDir = deviceConfig.musicDir;
  if (deviceConfig.moviesDir !== undefined) overrides.moviesDir = deviceConfig.moviesDir;
  if (deviceConfig.tvShowsDir !== undefined) overrides.tvShowsDir = deviceConfig.tvShowsDir;

  const hasOverrides = Object.keys(overrides).length > 0;
  return hasOverrides || presetDefaults
    ? core.normalizeContentPaths(overrides, presetDefaults)
    : core.normalizeContentPaths({});
}

async function runMassStorageRepair(
  devicePath: string,
  deviceConfig: DeviceConfig,
  check: NonNullable<ReturnType<typeof import('@podkit/core').getDiagnosticCheck>>,
  options: DoctorOptions,
  out: OutputContext,
  config: ReturnType<typeof getContext>['config']
): Promise<void> {
  const repair = check.repair!;
  const dryRun = options.dryRun ?? false;

  let core: typeof import('@podkit/core');
  try {
    core = await import('@podkit/core');
  } catch (err) {
    throw new CliError({
      message: err instanceof Error ? err.message : 'Failed to load podkit-core',
      code: DoctorErrorCodes.CORE_LOAD_FAILED,
    });
  }

  const contentPaths = resolveMassStorageContentPaths(deviceConfig, config.deviceDefaults, core);

  if (!dryRun) {
    out.print(`Repairing ${check.id}: ${repair.description}...`);
    out.newline();
  } else {
    out.print(`Dry run: ${repair.description}...`);
    out.newline();
  }

  const shutdown = createShutdownController();
  shutdown.install();

  let result: Awaited<ReturnType<typeof repair.run>>;
  try {
    result = await repair.run(
      {
        mountPoint: devicePath,
        deviceType: 'mass-storage',
        contentPaths,
        adapters: [],
      },
      {
        dryRun,
        signal: shutdown.signal,
        onProgress: (progress) => {
          if (!out.isText) return;
          const p = progress as Record<string, number>;
          if (p.current !== undefined && p.total !== undefined) {
            const pct = Math.round((p.current / p.total) * 100);
            process.stderr.write(`\r  ${p.current} / ${p.total}  (${pct}%)`);
          }
        },
      }
    );
  } catch (err) {
    // Clear progress line before bubbling
    if (out.isText) {
      process.stderr.write('\r' + ' '.repeat(80) + '\r');
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError({
      message: `Repair failed: ${message}`,
      code: DoctorErrorCodes.REPAIR_FAILED,
      details: { checkId: check.id },
    });
  } finally {
    shutdown.uninstall();
  }

  // Clear progress line
  if (out.isText) {
    process.stderr.write('\r' + ' '.repeat(80) + '\r');
  }

  if (!result.success) {
    throw new CliError({
      message: result.summary,
      code: DoctorErrorCodes.REPAIR_FAILED,
      details: { checkId: check.id, dryRun, ...result.details },
    });
  }

  const output: RepairOutput = {
    success: true,
    summary: result.summary,
    checkId: check.id,
    dryRun,
    details: result.details,
  };

  out.result<RepairOutput>(output, () => {
    out.print(result.summary);

    if (!dryRun) {
      out.newline();
      out.success('Repair complete. Run `podkit doctor` to verify.');
    }
  });
}

// ── Orphan file helpers ────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Print a verbose summary of orphan files: breakdown by directory and extension,
 * plus the 10 largest files.
 */
function printOrphanSummary(details: Record<string, unknown>, out: OutputContext): void {
  const orphans = details.orphans as Array<{ path: string; size: number }> | undefined;
  if (!orphans || orphans.length === 0) return;

  // Breakdown by F* directory
  const byDir = new Map<string, { count: number; size: number }>();
  for (const o of orphans) {
    const dir = basename(dirname(o.path));
    const entry = byDir.get(dir) ?? { count: 0, size: 0 };
    entry.count++;
    entry.size += o.size;
    byDir.set(dir, entry);
  }

  out.newline();
  out.verbose1('    By directory:');
  const sortedDirs = [...byDir.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [dir, { count, size }] of sortedDirs) {
    out.verbose1(
      `      ${dir.padEnd(5)} ${String(count).padStart(5)} files  ${formatBytes(size).padStart(10)}`
    );
  }

  // Breakdown by extension
  const byExt = new Map<string, { count: number; size: number }>();
  for (const o of orphans) {
    const name = basename(o.path);
    const dotIdx = name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? name.slice(dotIdx).toLowerCase() : '(none)';
    const entry = byExt.get(ext) ?? { count: 0, size: 0 };
    entry.count++;
    entry.size += o.size;
    byExt.set(ext, entry);
  }

  out.verbose1('    By extension:');
  const sortedExts = [...byExt.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [ext, { count, size }] of sortedExts) {
    out.verbose1(
      `      ${ext.padEnd(8)} ${String(count).padStart(5)} files  ${formatBytes(size).padStart(10)}`
    );
  }

  // Top 10 largest files
  const sorted = [...orphans].sort((a, b) => b.size - a.size);
  const top = sorted.slice(0, 10);
  out.verbose1('    Largest orphans:');
  for (const o of top) {
    const rel = o.path.replace(/.*iPod_Control\/Music\//, '');
    out.verbose1(`      ${formatBytes(o.size).padStart(10)}  ${rel}`);
  }

  out.verbose1(`    Use --format csv to export the full list.`);
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

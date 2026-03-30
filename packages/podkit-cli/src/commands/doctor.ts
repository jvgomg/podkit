/**
 * Doctor command — run health checks on a device
 *
 * Checks the device for known issues and reports findings.
 * When a check fails and is repairable, the CLI maps domain-level
 * repair requirements to flags and UX.
 *
 * For mass-storage devices, reports that no checks are currently available
 * and suggests using `podkit sync --dry-run` to verify configuration.
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
import { Command } from 'commander';
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
import { existsSync } from '../utils/fs.js';
import { createMusicAdapter } from '../utils/source-adapter.js';
import { createShutdownController } from '../shutdown.js';
import { openDevice, getDeviceTypeDisplayName } from './open-device.js';
import { STAGE_DISPLAY_NAMES } from '@podkit/core';
import type { ReadinessStageResult, ReadinessResult } from '@podkit/core';

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
  };
  checks: DoctorCheckOutput[];
}

interface RepairOutput {
  success: boolean;
  summary: string;
  checkId: string;
  dryRun: boolean;
  details?: Record<string, unknown>;
}

// ── Options ─────────────────────────────────────────────────────────────────

interface DoctorOptions {
  repair?: string;
  dryRun?: boolean;
  collection?: string;
  format?: 'csv';
}

// ── Status symbols ──────────────────────────────────────────────────────────

function statusSymbol(status: string): string {
  switch (status) {
    case 'pass':
      return '\u2713'; // ✓
    case 'fail':
      return '\u2717'; // ✗
    case 'warn':
      return '!';
    case 'skip':
      return '-';
    default:
      return '?';
  }
}

// ── Resolve device helper ───────────────────────────────────────────────────

async function resolveDevice(
  out: OutputContext
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

  let getDeviceManager: typeof import('@podkit/core').getDeviceManager;
  try {
    const core = await import('@podkit/core');
    getDeviceManager = core.getDeviceManager;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load podkit-core' };
  }

  const manager = getDeviceManager();

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
  .option('--repair <check-id>', 'repair a specific check by ID (e.g. artwork-rebuild)')
  .option('-c, --collection <name>', 'music collection to use as artwork source')
  .option('--dry-run', 'preview repair without modifying the iPod')
  .option('--format <fmt>', 'output format for file lists (csv)')
  .action(async (options: DoctorOptions) => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    // Repair mode: validate requirements before resolving device
    if (options.repair) {
      // Look up the check
      let getDiagnosticCheck: typeof import('@podkit/core').getDiagnosticCheck;
      let getDiagnosticCheckIds: typeof import('@podkit/core').getDiagnosticCheckIds;
      try {
        const core = await import('@podkit/core');
        getDiagnosticCheck = core.getDiagnosticCheck;
        getDiagnosticCheckIds = core.getDiagnosticCheckIds;
      } catch (err) {
        out.error(err instanceof Error ? err.message : 'Failed to load podkit-core');
        process.exitCode = 1;
        return;
      }

      const check = getDiagnosticCheck(options.repair);
      if (!check) {
        const available = getDiagnosticCheckIds();
        out.error(
          `Unknown check ID: "${options.repair}". Available checks: ${available.join(', ')}`
        );
        process.exitCode = 1;
        return;
      }

      if (!check.repair) {
        out.error(`Check "${options.repair}" does not support automatic repair.`);
        process.exitCode = 1;
        return;
      }

      // Map domain requirements to CLI validation
      if (!globalOpts.device) {
        out.error(
          'Repair requires an explicit device. Use -d <name|path> to specify which iPod to repair.'
        );
        process.exitCode = 1;
        return;
      }

      const needsSource = check.repair.requirements.includes('source-collection');
      if (needsSource && !options.collection) {
        const available = Object.keys(config.music ?? {});
        const hint = available.length > 0 ? ` Available collections: ${available.join(', ')}` : '';
        out.error(
          `Repair "${options.repair}" requires a source collection. Use -c <name> to specify.${hint}`
        );
        process.exitCode = 1;
        return;
      }

      // Resolve device and run repair
      const resolved = await resolveDevice(out);
      if ('error' in resolved) {
        out.error(resolved.error);
        process.exitCode = 1;
        return;
      }

      // Mass-storage devices don't support repair
      const isMassStorage =
        resolved.deviceConfig?.type !== undefined && resolved.deviceConfig.type !== 'ipod';
      if (isMassStorage) {
        out.error('Repair is not available for mass-storage devices.');
        process.exitCode = 1;
        return;
      }

      await runRepair(resolved.path, check, options, out, config);
      return;
    }

    // Diagnostic-only mode
    const resolved = await resolveDevice(out);
    if ('error' in resolved) {
      out.result<DoctorOutput>(
        { healthy: false, mountPoint: '', deviceModel: '', deviceType: 'ipod', checks: [] },
        () => out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    await runDoctorDiagnostics(resolved.path, resolved.deviceConfig, out, options);
  });

// ── Readiness display helpers ────────────────────────────────────────────────

function printReadinessStages(out: OutputContext, stages: ReadinessStageResult[]): void {
  for (const stage of stages) {
    const marker = statusSymbol(stage.status);
    const name = STAGE_DISPLAY_NAMES[stage.stage] || stage.stage;
    out.print(`  ${marker} ${name}`);

    // Show detail line for certain stages
    if (stage.stage === 'mount' && stage.status === 'pass') {
      out.print(`    ${stage.summary}`);
    } else if (stage.stage === 'mount' && stage.status === 'warn') {
      out.print(`    ${stage.details?.mountPoint} (read-only)`);
    } else if (stage.stage === 'sysinfo' && stage.status === 'pass') {
      out.print(`    ${stage.summary}`);
    } else if (stage.stage === 'database' && stage.status === 'pass') {
      out.print(`    ${stage.summary}`);
    } else if (
      stage.status === 'fail' &&
      stage.stage !== 'usb' &&
      stage.stage !== 'partition' &&
      stage.stage !== 'filesystem'
    ) {
      out.print(`    ${stage.summary}`);
    } else if (stage.status === 'skip') {
      out.print(`    ${stage.summary}`);
    }
  }
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

async function runDoctorDiagnostics(
  devicePath: string,
  deviceConfig: DeviceConfig | undefined,
  out: OutputContext,
  options: DoctorOptions
): Promise<void> {
  let core: typeof import('@podkit/core');
  try {
    core = await import('@podkit/core');
  } catch (err) {
    out.error(err instanceof Error ? err.message : 'Failed to load podkit-core');
    process.exitCode = 1;
    return;
  }

  const { config } = getContext();
  const isMassStorage = deviceConfig?.type !== undefined && deviceConfig.type !== 'ipod';

  // Mass-storage devices: no checks available yet
  if (isMassStorage) {
    const label = getDeviceTypeDisplayName(deviceConfig?.type);
    const output: DoctorOutput = {
      healthy: true,
      mountPoint: devicePath,
      deviceModel: label,
      deviceType: 'mass-storage',
      checks: [],
    };
    out.result<DoctorOutput>(output, () => {
      out.print(`podkit doctor \u2014 ${label} at ${devicePath}`);
      out.newline();
      out.print('  No health checks are currently available for mass-storage devices.');
      out.print('  Run `podkit sync --dry-run` to verify your collection configuration.');
    });
    return;
  }

  // ── Phase 1: Readiness checks ──────────────────────────────────────────

  // Build a PlatformDeviceInfo for the readiness pipeline.
  // Try to find the real device info from the platform device manager first,
  // fall back to a minimal constructed info if not found.
  const manager = core.getDeviceManager();
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
        report = await core.runDiagnostics({
          mountPoint: devicePath,
          deviceType: 'ipod',
          db: opened.ipod,
          deviceModel: opened.ipod?.getInfo().device.modelName ?? undefined,
        });
      } catch {
        // Diagnostics failed — we'll show readiness results and skip DB checks
      }
    }
  }

  // ── Build output ───────────────────────────────────────────────────────

  const deviceModel =
    report?.deviceModel ??
    (readinessResult?.summary?.modelName ? readinessResult.summary.modelName : 'Unknown');

  const readinessOutput = readinessResult
    ? {
        level: readinessResult.level,
        stages: readinessResult.stages.map((s) => ({
          stage: s.stage,
          status: s.status,
          summary: s.summary,
          details: s.details,
        })),
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
    healthy,
    mountPoint: devicePath,
    deviceModel,
    deviceType: 'ipod',
    readiness: readinessOutput,
    checks: checksOutput,
  };

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

  out.result<DoctorOutput>(output, () => {
    out.print(`podkit doctor \u2014 checking iPod at ${devicePath}`);

    // ── System section ──
    if (report) {
      const systemChecks = report.checks.filter((c) => c.scope === 'system' && !c.repairOnly);
      if (systemChecks.length > 0) {
        out.newline();
        out.print('System');
        for (const check of systemChecks) {
          const sym = statusSymbol(check.status);
          out.print(`  ${sym} ${check.name}    ${check.summary}`);
          if (check.docsUrl) {
            out.print(`    More info: ${check.docsUrl}`);
          }
        }
      }
    }

    // ── Device Readiness section ──
    out.newline();
    out.print('Device Readiness');

    if (readinessResult) {
      printReadinessStages(out, readinessResult.stages);
    }

    // ── Database Health section ──
    out.newline();
    out.print('Database Health');

    if (!report) {
      // DB not available — show skip message
      if (readinessResult && !dbAvailable) {
        out.print('  Skipped \u2014 device database is not available.');
        out.print('  Run `podkit device init` to initialize the iPod database.');
      } else if (!readinessResult) {
        out.print('  Skipped \u2014 could not run database health checks.');
      } else {
        out.print('  Skipped \u2014 could not open the device database.');
      }
    } else {
      for (const check of report.checks) {
        // Skip repair-only and system checks here
        if (check.repairOnly || check.scope === 'system') continue;

        const sym = statusSymbol(check.status);
        out.print(`  ${sym} ${check.name}    ${check.summary}`);

        // For failures, show details and repair instructions
        if (check.status === 'fail' && check.details) {
          out.newline();
          const d = check.details as Record<string, unknown>;

          if (d.totalEntries !== undefined) {
            const total = (d.totalEntries as number).toLocaleString();
            const corrupt = (d.corruptEntries as number).toLocaleString();
            const healthyEntries = (d.healthyEntries as number).toLocaleString();
            const pct = d.corruptPercent;

            out.print(
              `    Corrupt:      ${corrupt} / ${total} entries (${pct}%) reference data beyond ithmb file bounds`
            );
            out.print(`    Healthy:      ${healthyEntries} entries with valid offsets`);
          }

          out.newline();
          out.print('    The artwork database is out of sync with the thumbnail files.');
          out.print('    Affected tracks display wrong or missing artwork on the iPod.');
        }

        // Orphan files: verbose summary
        if (check.id === 'orphan-files' && check.status === 'warn' && check.details) {
          printOrphanSummary(check.details as Record<string, unknown>, out);
        }

        // Show repair instructions if the check is repairable
        if (check.repairable) {
          const diagCheck = getDiagnosticCheck(check.id);
          if (diagCheck?.repair) {
            out.newline();
            const reqHints: string[] = [];
            if (diagCheck.repair.requirements.includes('source-collection')) {
              reqHints.push('-c <collection>');
            }
            const reqStr = reqHints.length > 0 ? ` ${reqHints.join(' ')}` : '';
            out.print(`    To repair: podkit doctor --repair ${check.id}${reqStr}`);

            // For artwork-rebuild, offer the reset alternative (no source needed)
            if (check.id === 'artwork-rebuild') {
              out.print(
                `    Or clear all artwork (no source needed): podkit doctor --repair artwork-reset`
              );
            }
          }
        }

        if (check.docsUrl) {
          out.print(`    More info: ${check.docsUrl}`);
        }
      }
    }

    // ── Summary line ──
    out.newline();
    if (healthy) {
      out.success('All checks passed.');
    } else {
      // Count issues: readiness failures + DB check failures
      let issueCount = 0;
      if (readinessResult) {
        issueCount += readinessResult.stages.filter((s) => s.status === 'fail').length;
      }
      if (report) {
        issueCount += report.checks.filter((c) => c.status === 'fail' && !c.repairOnly).length;
      }
      // Ensure at least 1 if unhealthy
      if (issueCount === 0) issueCount = 1;
      out.error(`${issueCount} issue${issueCount === 1 ? '' : 's'} found.`);
    }
  });

  opened?.ipod?.close();

  if (!healthy) {
    process.exitCode = 1;
  }
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
    out.error(err instanceof Error ? err.message : 'Failed to load podkit-core');
    process.exitCode = 1;
    return;
  }

  // Open iPod database
  let db: Awaited<ReturnType<typeof core.IpodDatabase.open>>;
  try {
    db = await core.IpodDatabase.open(devicePath);
  } catch (err) {
    out.error(err instanceof Error ? err.message : 'Failed to open iPod database');
    process.exitCode = 1;
    return;
  }

  // Resolve source collection adapters if needed
  const adapters: import('@podkit/core').CollectionAdapter[] = [];
  const needsSource = repair.requirements.includes('source-collection');

  if (needsSource && options.collection) {
    const allMusic = config.music ?? {};
    const found = allMusic[options.collection];
    if (!found) {
      db.close();
      const available = Object.keys(allMusic);
      const msg =
        available.length > 0
          ? `Available collections: ${available.join(', ')}`
          : 'No music collections configured.';
      out.error(`Music collection "${options.collection}" not found. ${msg}`);
      process.exitCode = 1;
      return;
    }

    try {
      const adapter = createMusicAdapter({
        config: found,
        name: options.collection,
      });
      await adapter.connect();
      adapters.push(adapter);
    } catch (err) {
      db.close();
      out.error(
        `Failed to connect to source collection: ${err instanceof Error ? err.message : String(err)}`
      );
      process.exitCode = 1;
      return;
    }
  }

  if (!dryRun) {
    out.print(`Repairing ${check.id} for ${db.trackCount.toLocaleString()} tracks...`);
    out.newline();
  } else {
    out.print(
      `Dry run: checking ${check.id} repair for ${db.trackCount.toLocaleString()} tracks...`
    );
    out.newline();
  }

  const shutdown = createShutdownController();
  shutdown.install();

  try {
    const result = await repair.run(
      { mountPoint: devicePath, deviceType: 'ipod', db, adapters },
      {
        dryRun,
        signal: shutdown.signal,
        onProgress: (progress) => {
          if (!out.isText) return;
          const p = progress as Record<string, number>;
          if (p.current !== undefined && p.total !== undefined) {
            const pct = Math.round((p.current / p.total) * 100);
            process.stderr.write(
              `\r  ${p.current} / ${p.total}  (${pct}%)  Matched: ${p.matched ?? 0}  No source: ${p.noSource ?? 0}  No artwork: ${p.noArtwork ?? 0}`
            );
          }
        },
      }
    );

    // Clear progress line
    if (out.isText) {
      process.stderr.write('\r' + ' '.repeat(100) + '\r');
    }

    const output: RepairOutput = {
      success: result.success,
      summary: result.summary,
      checkId: check.id,
      dryRun,
      details: result.details,
    };

    out.result<RepairOutput>(output, () => {
      out.print(result.summary);

      if (result.details) {
        const d = result.details;
        if (d.errorDetails && Array.isArray(d.errorDetails)) {
          out.newline();
          out.error('Error details:');
          for (const err of (
            d.errorDetails as Array<{ artist: string; title: string; error: string }>
          ).slice(0, 10)) {
            out.error(`  ${err.artist} - ${err.title}: ${err.error}`);
          }
          if ((d.errorDetails as Array<unknown>).length > 10) {
            out.error(`  ... and ${(d.errorDetails as Array<unknown>).length - 10} more`);
          }
        }
      }

      if (!dryRun && result.success) {
        out.newline();
        out.success('Repair complete. Run `podkit doctor` to verify.');
      }
    });

    if (!result.success) {
      process.exitCode = 1;
    }
  } catch (err) {
    out.error(`Repair failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    shutdown.uninstall();
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

/**
 * udev-rule repair-only diagnostic check.
 *
 * Installs the podkit udev rule to `/etc/udev/rules.d/` so that Linux users
 * can access iPod SCSI devices without sudo. Invocable via:
 *
 *   podkit doctor --repair udev-rule
 *
 * This is the first podkit repair that requires sudo elevation. We let sudo
 * prompt natively (the user will see a sudo password prompt in the terminal)
 * rather than trying to use sudo -A or askpass helpers — keep it simple.
 *
 * Rule content is embedded as a string constant (the single source of truth
 * is packages/podkit-cli/share/91-podkit-ipod-scsi.rules; this module keeps
 * the content in sync). The embedded string avoids any runtime filesystem
 * dependency on the share/ directory.
 *
 * Linux-only: returns an immediate non-success on other platforms.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import type {
  DiagnosticCheck,
  CheckResult,
  DiagnosticContext,
  RepairContext,
  RepairRunOptions,
  RepairResult,
  DiagnosticRepair,
} from '../types.js';

// ── Rule content ─────────────────────────────────────────────────────────────

/**
 * Canonical udev rule content. This is the single source of truth —
 * kept in sync with packages/podkit-cli/share/91-podkit-ipod-scsi.rules.
 *
 * Embedded here as a string constant so the repair works in any runtime
 * environment (standalone binary, workspace, test) without requiring the
 * share/ directory to be on the filesystem.
 */
export const UDEV_RULE_CONTENT = `# podkit — udev rule for SCSI access to Apple iPod devices.
#
# Grants unprivileged access to the SCSI generic (/dev/sgN) nodes that
# correspond to Apple-vendor iPod USB devices, so podkit can issue SCSI VPD
# inquiries to read SysInfoExtended without sudo.
#
# Install:
#   sudo cp 91-podkit-ipod-scsi.rules /etc/udev/rules.d/
#   sudo udevadm control --reload && sudo udevadm trigger
#   (then unplug and replug your iPod)
#
# Uninstall:
#   sudo rm /etc/udev/rules.d/91-podkit-ipod-scsi.rules
#   sudo udevadm control --reload && sudo udevadm trigger
#
# Cross-distro coverage:
#   GROUP="plugdev"  — Debian / Ubuntu / Mint
#   TAG+="uaccess"  — Arch / Fedora / NixOS / openSUSE (modern systemd-udevd)

ACTION=="add|change", SUBSYSTEM=="scsi_generic", \\
  ATTRS{idVendor}=="05ac", \\
  MODE="0660", GROUP="plugdev", TAG+="uaccess"
`;

export const TARGET_PATH = '/etc/udev/rules.d/91-podkit-ipod-scsi.rules';

// ── Injectable executor type ──────────────────────────────────────────────────

/** Result type for a sudo command invocation. */
export interface SudoResult {
  code: number;
  stderr: string;
}

/** Injectable executor for sudo commands — allows unit testing without sudo. */
export type SudoExecutor = (args: string[]) => SudoResult;

/** Injectable file-system writer — allows unit testing without writing to /tmp. */
export interface FsOps {
  writeFile(path: string, content: string): void;
  unlink(path: string): void;
}

// ── Pure install logic (injectable for tests) ─────────────────────────────────

/**
 * Install the udev rule. Accepts injectable executors so the function is
 * fully unit-testable without real sudo or filesystem access.
 *
 * @param opts.platform    - Override process.platform (for tests).
 * @param opts.dryRun      - If true, return what would happen without acting.
 * @param opts.executor    - Injectable sudo runner.
 * @param opts.fsOps       - Injectable filesystem writer.
 */
export async function runUdevRuleInstall(opts: {
  platform: NodeJS.Platform;
  dryRun: boolean;
  executor: SudoExecutor;
  fsOps: FsOps;
}): Promise<RepairResult> {
  const { platform, dryRun, executor, fsOps } = opts;

  if (platform !== 'linux') {
    return {
      success: false,
      summary: 'udev rules are Linux-only — no action needed on this platform.',
    };
  }

  if (dryRun) {
    return {
      success: true,
      summary: [
        `Would write rule to ${TARGET_PATH} (sudo required).`,
        `Would run: sudo udevadm control --reload && sudo udevadm trigger`,
        `Rule uses GROUP="plugdev" + TAG+="uaccess" for cross-distro coverage.`,
      ].join('\n'),
      details: { targetPath: TARGET_PATH, dryRun: true },
    };
  }

  // Write rule to a temp file (no sudo needed for /tmp), then sudo cp to target.
  const tmpPath = `/tmp/91-podkit-ipod-scsi.rules.${process.pid}`;

  try {
    fsOps.writeFile(tmpPath, UDEV_RULE_CONTENT);
  } catch (err) {
    return {
      success: false,
      summary: `Failed to write temporary rule file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // sudo cp temp file to target
  const cpResult = executor(['cp', tmpPath, TARGET_PATH]);
  if (cpResult.code !== 0) {
    try {
      fsOps.unlink(tmpPath);
    } catch {
      /* ignore */
    }
    return {
      success: false,
      summary: `Failed to copy rule to ${TARGET_PATH} (sudo cp exited ${cpResult.code}).`,
      details: { stderr: cpResult.stderr, exitCode: cpResult.code },
    };
  }

  try {
    fsOps.unlink(tmpPath);
  } catch {
    /* ignore */
  }

  // Reload udev rules
  const reloadResult = executor(['udevadm', 'control', '--reload']);
  if (reloadResult.code !== 0) {
    return {
      success: false,
      summary: `Rule installed but udevadm control --reload failed (exit ${reloadResult.code}).`,
      details: { stderr: reloadResult.stderr, exitCode: reloadResult.code },
    };
  }

  // Trigger udev events
  const triggerResult = executor(['udevadm', 'trigger']);
  if (triggerResult.code !== 0) {
    return {
      success: false,
      summary: `Rule installed and reload succeeded, but udevadm trigger failed (exit ${triggerResult.code}).`,
      details: { stderr: triggerResult.stderr, exitCode: triggerResult.code },
    };
  }

  return {
    success: true,
    summary: `Rule installed at ${TARGET_PATH}. Unplug and replug your iPod for the rule to take effect.`,
    details: { targetPath: TARGET_PATH },
  };
}

// ── Production implementations ────────────────────────────────────────────────

/** Production sudo executor using spawnSync. */
function makeProductionExecutor(): SudoExecutor {
  return (args: string[]): SudoResult => {
    const result = spawnSync('sudo', args, {
      encoding: 'utf8',
      stdio: ['inherit', 'inherit', 'pipe'],
    });
    return {
      code: result.status ?? 1,
      stderr: result.stderr ?? '',
    };
  };
}

/** Production filesystem operations. */
const productionFsOps: FsOps = {
  writeFile: (path: string, content: string) => writeFileSync(path, content, 'utf8'),
  unlink: (path: string) => unlinkSync(path),
};

// ── Exported repair object ─────────────────────────────────────────────────────

export const udevRuleRepair: DiagnosticRepair = {
  description: 'Install the podkit udev rule to grant SCSI access without sudo',
  requirements: [], // no source-collection or writable-device needed

  async run(_ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult> {
    return runUdevRuleInstall({
      platform: process.platform,
      dryRun: options?.dryRun ?? false,
      executor: makeProductionExecutor(),
      fsOps: productionFsOps,
    });
  },
};

// ── Exported check object ─────────────────────────────────────────────────────

/**
 * Repair-only check that exposes the udev rule install action.
 * Detection is not needed: the repair is idempotent and safe to run at any time.
 */
export const udevRuleCheck: DiagnosticCheck = {
  id: 'udev-rule',
  name: 'udev Rule (Linux SCSI Access)',
  scope: 'system',
  applicableTo: ['ipod', 'mass-storage'],
  repairOnly: true,

  async check(_ctx: DiagnosticContext): Promise<CheckResult> {
    return {
      status: 'skip',
      summary: 'udev-rule is a repair-only action (run with --repair udev-rule)',
      repairable: false,
    };
  },

  repair: udevRuleRepair,
};

/**
 * Unit tests for the udev-rule repair diagnostic check.
 *
 * Tests use the pure `runUdevRuleInstall` function with injected executors
 * and fs ops, so no real sudo or filesystem access is needed.
 */

import { describe, it, expect } from 'bun:test';
import {
  udevRuleCheck,
  udevRuleRepair,
  runUdevRuleInstall,
  TARGET_PATH,
  UDEV_RULE_CONTENT,
  type SudoExecutor,
  type FsOps,
} from './udev-rule.js';
import type { RepairContext } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal stub context — system repair ignores ctx fields. */
const stubCtx: RepairContext = {
  mountPoint: '',
  deviceType: 'ipod',
  adapters: [],
};

/** Executor that always succeeds. */
const succeedingExecutor: SudoExecutor = () => ({ code: 0, stderr: '' });

/** Executor that fails on 'cp' and succeeds otherwise. */
const cpFailExecutor: SudoExecutor = (args) =>
  args.includes('cp')
    ? { code: 1, stderr: 'sudo: authentication failure' }
    : { code: 0, stderr: '' };

/** Executor that fails on 'udevadm control --reload'. */
const reloadFailExecutor: SudoExecutor = (args) =>
  args.includes('control')
    ? { code: 1, stderr: 'udevadm: reload failed' }
    : { code: 0, stderr: '' };

/** Executor that fails on 'udevadm trigger'. */
const triggerFailExecutor: SudoExecutor = (args) =>
  args.includes('trigger') && !args.includes('--reload')
    ? { code: 1, stderr: 'udevadm: trigger failed' }
    : { code: 0, stderr: '' };

/** No-op filesystem ops. */
const noopFsOps: FsOps = {
  writeFile: () => {},
  unlink: () => {},
};

/** FsOps that fails writeFile. */
const writingFailFsOps: FsOps = {
  writeFile: () => {
    throw new Error('disk full');
  },
  unlink: () => {},
};

// ── Check metadata ────────────────────────────────────────────────────────────

describe('udevRuleCheck metadata', () => {
  it('has correct id', () => {
    expect(udevRuleCheck.id).toBe('udev-rule');
  });

  it('is repairOnly', () => {
    expect(udevRuleCheck.repairOnly).toBe(true);
  });

  it('has system scope', () => {
    expect(udevRuleCheck.scope).toBe('system');
  });

  it('applies to ipod and mass-storage', () => {
    expect(udevRuleCheck.applicableTo).toContain('ipod');
    expect(udevRuleCheck.applicableTo).toContain('mass-storage');
  });

  it('has a repair object', () => {
    expect(udevRuleCheck.repair).toBeDefined();
  });

  it('repair has no requirements', () => {
    expect(udevRuleCheck.repair?.requirements).toEqual([]);
  });

  it('check() returns skip', async () => {
    const result = await udevRuleCheck.check(stubCtx);
    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
  });

  it('repair description mentions udev rule', () => {
    expect(udevRuleRepair.description.toLowerCase()).toContain('udev');
  });
});

// ── Rule content ─────────────────────────────────────────────────────────────

describe('UDEV_RULE_CONTENT', () => {
  it('contains GROUP=plugdev', () => {
    expect(UDEV_RULE_CONTENT).toContain('GROUP="plugdev"');
  });

  it('contains TAG+=uaccess', () => {
    expect(UDEV_RULE_CONTENT).toContain('TAG+="uaccess"');
  });

  it('matches Apple vendor ID 05ac', () => {
    expect(UDEV_RULE_CONTENT).toContain('ATTRS{idVendor}=="05ac"');
  });

  it('targets scsi_generic subsystem', () => {
    expect(UDEV_RULE_CONTENT).toContain('SUBSYSTEM=="scsi_generic"');
  });
});

// ── Non-Linux platform guard ──────────────────────────────────────────────────

describe('runUdevRuleInstall on non-Linux', () => {
  it('returns success=false with platform message on darwin', async () => {
    const result = await runUdevRuleInstall({
      platform: 'darwin',
      dryRun: false,
      executor: succeedingExecutor,
      fsOps: noopFsOps,
    });
    expect(result.success).toBe(false);
    expect(result.summary).toContain('Linux-only');
  });

  it('returns success=false on win32', async () => {
    const result = await runUdevRuleInstall({
      platform: 'win32',
      dryRun: false,
      executor: succeedingExecutor,
      fsOps: noopFsOps,
    });
    expect(result.success).toBe(false);
  });
});

// ── Dry-run path ──────────────────────────────────────────────────────────────

describe('runUdevRuleInstall dry-run', () => {
  it('returns success=true with target path in summary', async () => {
    const result = await runUdevRuleInstall({
      platform: 'linux',
      dryRun: true,
      executor: succeedingExecutor,
      fsOps: noopFsOps,
    });
    expect(result.success).toBe(true);
    expect(result.summary).toContain(TARGET_PATH);
    expect(result.summary).toContain('sudo');
    expect(result.details?.dryRun).toBe(true);
  });

  it('does not call executor in dry-run', async () => {
    const calls: string[][] = [];
    const trackingExecutor: SudoExecutor = (args) => {
      calls.push(args);
      return { code: 0, stderr: '' };
    };
    await runUdevRuleInstall({
      platform: 'linux',
      dryRun: true,
      executor: trackingExecutor,
      fsOps: noopFsOps,
    });
    expect(calls).toHaveLength(0);
  });
});

// ── Success path ─────────────────────────────────────────────────────────────

describe('runUdevRuleInstall success', () => {
  it('returns success=true when all commands succeed', async () => {
    const result = await runUdevRuleInstall({
      platform: 'linux',
      dryRun: false,
      executor: succeedingExecutor,
      fsOps: noopFsOps,
    });
    expect(result.success).toBe(true);
    expect(result.summary).toContain(TARGET_PATH);
    expect(result.summary).toContain('Unplug and replug');
  });

  it('calls executor with cp, udevadm control --reload, and udevadm trigger', async () => {
    const calls: string[][] = [];
    const trackingExecutor: SudoExecutor = (args) => {
      calls.push(args);
      return { code: 0, stderr: '' };
    };
    await runUdevRuleInstall({
      platform: 'linux',
      dryRun: false,
      executor: trackingExecutor,
      fsOps: noopFsOps,
    });
    expect(calls.some((a) => a.includes('cp'))).toBe(true);
    expect(calls.some((a) => a.includes('udevadm') && a.includes('--reload'))).toBe(true);
    expect(calls.some((a) => a.includes('trigger'))).toBe(true);
  });

  it('writes UDEV_RULE_CONTENT to a temp file', async () => {
    let writtenContent = '';
    const trackingFsOps: FsOps = {
      writeFile: (_path, content) => {
        writtenContent = content;
      },
      unlink: () => {},
    };
    await runUdevRuleInstall({
      platform: 'linux',
      dryRun: false,
      executor: succeedingExecutor,
      fsOps: trackingFsOps,
    });
    expect(writtenContent).toBe(UDEV_RULE_CONTENT);
  });
});

// ── Failure paths ─────────────────────────────────────────────────────────────

describe('runUdevRuleInstall failure paths', () => {
  it('returns success=false when writeFile fails', async () => {
    const result = await runUdevRuleInstall({
      platform: 'linux',
      dryRun: false,
      executor: succeedingExecutor,
      fsOps: writingFailFsOps,
    });
    expect(result.success).toBe(false);
    expect(result.summary).toContain('Failed to write temporary rule file');
  });

  it('returns success=false when sudo cp fails', async () => {
    const result = await runUdevRuleInstall({
      platform: 'linux',
      dryRun: false,
      executor: cpFailExecutor,
      fsOps: noopFsOps,
    });
    expect(result.success).toBe(false);
    expect(result.summary).toContain('Failed to copy rule');
    expect(result.details?.stderr).toContain('authentication failure');
  });

  it('returns success=false when udevadm reload fails', async () => {
    const result = await runUdevRuleInstall({
      platform: 'linux',
      dryRun: false,
      executor: reloadFailExecutor,
      fsOps: noopFsOps,
    });
    expect(result.success).toBe(false);
    expect(result.summary).toContain('--reload failed');
  });

  it('returns success=false when udevadm trigger fails', async () => {
    const result = await runUdevRuleInstall({
      platform: 'linux',
      dryRun: false,
      executor: triggerFailExecutor,
      fsOps: noopFsOps,
    });
    expect(result.success).toBe(false);
    expect(result.summary).toContain('trigger failed');
  });
});

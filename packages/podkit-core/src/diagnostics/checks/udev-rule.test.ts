/**
 * Unit tests for the udev-rule repair diagnostic check.
 *
 * Tests use the pure `runUdevRuleInstall` function with injected executors
 * and fs ops, so no real sudo or filesystem access is needed.
 */

import { describe, it, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  checkUdevRule,
  udevRuleCheck,
  udevRuleRepair,
  runUdevRuleInstall,
  TARGET_PATH,
  LEGACY_TARGET_PATHS,
  UDEV_RULE_CONTENT,
  type SudoExecutor,
  type FsOps,
  type ReadFileFn,
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

  it('is no longer repairOnly (detection logic now exists)', () => {
    expect(udevRuleCheck.repairOnly).toBeUndefined();
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

  it('repair description mentions udev rule', () => {
    expect(udevRuleRepair.description.toLowerCase()).toContain('udev');
  });
});

// ── Detection (check() — TASK-336) ───────────────────────────────────────────

/**
 * Build an in-memory readFile fake. If `content` is undefined the fake
 * rejects with ENOENT (mirrors `fs.promises.readFile` for a missing path).
 * If `errno` is set, the fake rejects with a fabricated errno error.
 */
function makeReadFile(opts: { content?: string; errno?: string }): ReadFileFn {
  return async (_path: string) => {
    if (opts.errno !== undefined) {
      const err = new Error(`simulated ${opts.errno}`) as NodeJS.ErrnoException;
      err.code = opts.errno;
      throw err;
    }
    if (opts.content === undefined) {
      const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return opts.content;
  };
}

describe('checkUdevRule — detection (TASK-336)', () => {
  it('returns skip on darwin without reading the file', async () => {
    let readCalls = 0;
    const result = await checkUdevRule({
      platform: 'darwin',
      readFile: async (_p) => {
        readCalls += 1;
        return UDEV_RULE_CONTENT;
      },
    });
    expect(result.status).toBe('skip');
    expect(result.summary).toBe('not applicable to platform');
    expect(result.repairable).toBe(false);
    expect(readCalls).toBe(0);
  });

  it('returns skip on win32 without reading the file', async () => {
    const result = await checkUdevRule({
      platform: 'win32',
      readFile: makeReadFile({ content: UDEV_RULE_CONTENT }),
    });
    expect(result.status).toBe('skip');
  });

  it('returns pass on Linux when content matches UDEV_RULE_CONTENT exactly', async () => {
    const result = await checkUdevRule({
      platform: 'linux',
      readFile: makeReadFile({ content: UDEV_RULE_CONTENT }),
    });
    expect(result.status).toBe('pass');
    expect(result.summary).toBe('iPod udev rule installed');
    expect(result.repairable).toBe(false);
    expect(result.details?.['path']).toBe(TARGET_PATH);
  });

  it('returns fail+repairable on Linux when the rule file is absent (ENOENT)', async () => {
    const result = await checkUdevRule({
      platform: 'linux',
      readFile: makeReadFile({ content: undefined }),
    });
    expect(result.status).toBe('fail');
    expect(result.summary).toBe('iPod udev rule not installed');
    expect(result.repairable).toBe(true);
    expect(result.details?.['path']).toBe(TARGET_PATH);
  });

  it('returns warn+repairable on Linux when the rule file is stale', async () => {
    const staleContent = `# old podkit udev rule (vendor only)
ACTION=="add", SUBSYSTEM=="scsi_generic", ATTRS{idVendor}=="05ac", MODE="0660"
`;
    const result = await checkUdevRule({
      platform: 'linux',
      readFile: makeReadFile({ content: staleContent }),
    });
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('stale');
    expect(result.repairable).toBe(true);
    expect(result.details?.['path']).toBe(TARGET_PATH);
    expect(typeof result.details?.['diff']).toBe('string');
    expect(result.details?.['diff']).toContain('bytes');
  });

  it('returns fail (not repairable) on Linux when the rule file cannot be read (EACCES)', async () => {
    const result = await checkUdevRule({
      platform: 'linux',
      readFile: makeReadFile({ errno: 'EACCES' }),
    });
    expect(result.status).toBe('fail');
    expect(result.summary).toBe('cannot read iPod udev rule');
    expect(result.repairable).toBe(false);
    expect(result.details?.['path']).toBe(TARGET_PATH);
    expect(result.details?.['errno']).toBe('EACCES');
  });

  it('treats stale single-byte difference as stale', async () => {
    // Mutate one character to confirm the comparison is exact, not approximate.
    const almostMatching = UDEV_RULE_CONTENT.replace('05ac', '05AC');
    const result = await checkUdevRule({
      platform: 'linux',
      readFile: makeReadFile({ content: almostMatching }),
    });
    expect(result.status).toBe('warn');
  });

  it('honours a custom path option', async () => {
    let observedPath = '';
    const result = await checkUdevRule({
      platform: 'linux',
      path: '/tmp/some-other-path.rules',
      readFile: async (p) => {
        observedPath = p;
        return UDEV_RULE_CONTENT;
      },
    });
    expect(observedPath).toBe('/tmp/some-other-path.rules');
    expect(result.details?.['path']).toBe('/tmp/some-other-path.rules');
  });
});

describe('udevRuleCheck.check() production binding', () => {
  it('delegates to checkUdevRule (skip on non-Linux without touching fs)', async () => {
    // Sanity check on the production binding: on non-Linux the registered
    // check() must return skip even though it uses the real fs reader —
    // skip path runs before any fs access.
    if (process.platform === 'linux') {
      // Skip on Linux to avoid touching the host filesystem from a unit test.
      return;
    }
    const result = await udevRuleCheck.check(stubCtx);
    expect(result.status).toBe('skip');
    expect(result.summary).toBe('not applicable to platform');
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

  // ── SCSI generic clause (TASK-292.12) ─────────────────────────────────────

  it('targets scsi_generic subsystem (SCSI VPD inquiry path)', () => {
    expect(UDEV_RULE_CONTENT).toContain('SUBSYSTEM=="scsi_generic"');
  });

  it('SCSI clause uses ATTRS{idVendor} (plural — walks parent USB chain)', () => {
    // scsi_generic itself has no idVendor attribute; the parent USB device
    // does. ATTRS{} traverses; ATTR{} (singular) does not.
    expect(UDEV_RULE_CONTENT).toContain('ATTRS{idVendor}=="05ac"');
  });

  it('SCSI clause grants MODE=0660 plugdev + uaccess', () => {
    // Find the SCSI block (multi-line continuation in the canonical content).
    const scsiClause = UDEV_RULE_CONTENT.split('\n\n').find((block) =>
      block.includes('SUBSYSTEM=="scsi_generic"')
    );
    expect(scsiClause).toBeDefined();
    expect(scsiClause).toContain('ATTRS{idVendor}=="05ac"');
    expect(scsiClause).toContain('MODE="0660"');
    expect(scsiClause).toContain('GROUP="plugdev"');
    expect(scsiClause).toContain('TAG+="uaccess"');
  });

  // ── USB clause (TASK-317.13) ──────────────────────────────────────────────

  it('targets usb subsystem (libusb firmware-inquiry path)', () => {
    // The USB clause must be present so /dev/bus/usb/<bus>/<dev> for
    // Apple-vendor devices is operator-accessible without sudo.
    expect(UDEV_RULE_CONTENT).toContain('SUBSYSTEM=="usb"');
  });

  it('USB clause uses ATTR{idVendor} (singular — USB device exposes it directly)', () => {
    // The case distinction matters for udev matching: ATTRS{} (plural)
    // walks the parent chain, ATTR{} (singular) reads the device's own
    // attribute. The USB device itself has idVendor so we use the
    // singular form. Asserting both clauses' attribute form here.
    const usbClause = UDEV_RULE_CONTENT.split('\n\n').find((block) =>
      block.includes('SUBSYSTEM=="usb"')
    );
    expect(usbClause).toBeDefined();
    expect(usbClause).toContain('ATTR{idVendor}=="05ac"');
    // Important: must NOT use ATTRS{} for the USB device clause — that
    // would silently match parent USB hubs/buses too.
    expect(usbClause).not.toContain('ATTRS{idVendor}');
  });

  it('USB clause grants MODE=0660 plugdev + uaccess', () => {
    const usbClause = UDEV_RULE_CONTENT.split('\n\n').find((block) =>
      block.includes('SUBSYSTEM=="usb"')
    );
    expect(usbClause).toBeDefined();
    expect(usbClause).toContain('ATTR{idVendor}=="05ac"');
    expect(usbClause).toContain('MODE="0660"');
    expect(usbClause).toContain('GROUP="plugdev"');
    expect(usbClause).toContain('TAG+="uaccess"');
  });

  it('contains exactly two ATTR/ATTRS idVendor clauses (one SCSI, one USB)', () => {
    // Defensive: catch accidental duplication or accidental deletion of a
    // clause by counting idVendor matches across the whole content.
    const matches = UDEV_RULE_CONTENT.match(/ATTRS?\{idVendor\}=="05ac"/g) ?? [];
    expect(matches).toHaveLength(2);
  });
});

// ── In-source content matches the shipped share file (byte-for-byte) ──────

describe('UDEV_RULE_CONTENT matches the canonical shipped rule file', () => {
  it('byte-for-byte matches packages/podkit-cli/share/91-podkit-ipod.rules', async () => {
    // The shipped rule file at packages/podkit-cli/share/91-podkit-ipod.rules
    // is the canonical reference for users who install manually; the
    // in-source UDEV_RULE_CONTENT is the canonical reference for the
    // doctor repair. They must be identical so manual installs and repair
    // installs match exactly (idempotence + staleness detection).
    const here = dirname(fileURLToPath(import.meta.url));
    const shipped = resolve(here, '../../../../podkit-cli/share/91-podkit-ipod.rules');
    const fileContent = await readFile(shipped, 'utf8');
    expect(fileContent).toBe(UDEV_RULE_CONTENT);
  });
});

// ── Legacy filename cleanup (TASK-317.13) ─────────────────────────────────

describe('LEGACY_TARGET_PATHS', () => {
  it('includes the pre-rename SCSI-only filename so upgrades clean it up', () => {
    expect(LEGACY_TARGET_PATHS).toContain('/etc/udev/rules.d/91-podkit-ipod-scsi.rules');
  });

  it('does not include the current TARGET_PATH (would self-delete)', () => {
    expect(LEGACY_TARGET_PATHS).not.toContain(TARGET_PATH);
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

// ── Legacy filename cleanup on install (TASK-317.13) ──────────────────────

describe('runUdevRuleInstall legacy filename cleanup', () => {
  it('issues an rm -f for each legacy path during install', async () => {
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
    // Expect one `rm -f <legacy>` call per LEGACY_TARGET_PATHS entry.
    for (const legacy of LEGACY_TARGET_PATHS) {
      const matched = calls.find((a) => a[0] === 'rm' && a.includes('-f') && a.includes(legacy));
      expect(matched).toBeDefined();
    }
  });

  it('uses rm -f (not rm) so a missing legacy file is not an error', async () => {
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
    const rmCalls = calls.filter((a) => a[0] === 'rm');
    for (const args of rmCalls) {
      expect(args).toContain('-f');
    }
  });

  it('cleanup runs AFTER the new rule is in place (sudo cp first, then rm)', async () => {
    // Order matters: if rm runs first and cp fails, the user loses the old
    // rule and gets nothing. So cp the new file first, only then clean up.
    const ordered: string[] = [];
    const trackingExecutor: SudoExecutor = (args) => {
      if (args[0] === 'cp') ordered.push('cp');
      else if (args[0] === 'rm') ordered.push('rm');
      else if (args[0] === 'udevadm') ordered.push(`udevadm:${args[1]}`);
      return { code: 0, stderr: '' };
    };
    await runUdevRuleInstall({
      platform: 'linux',
      dryRun: false,
      executor: trackingExecutor,
      fsOps: noopFsOps,
    });
    const firstCp = ordered.indexOf('cp');
    const firstRm = ordered.indexOf('rm');
    expect(firstCp).toBeGreaterThanOrEqual(0);
    expect(firstRm).toBeGreaterThan(firstCp);
  });

  it('does NOT run legacy cleanup when sudo cp fails (atomicity)', async () => {
    // If the new rule install fails, do not touch the legacy file.
    const calls: string[][] = [];
    const failingCpExecutor: SudoExecutor = (args) => {
      calls.push(args);
      if (args[0] === 'cp') return { code: 1, stderr: 'permission denied' };
      return { code: 0, stderr: '' };
    };
    await runUdevRuleInstall({
      platform: 'linux',
      dryRun: false,
      executor: failingCpExecutor,
      fsOps: noopFsOps,
    });
    const rmCalls = calls.filter((a) => a[0] === 'rm');
    expect(rmCalls).toHaveLength(0);
  });

  it('mentions legacy filename(s) in the dry-run summary', async () => {
    const result = await runUdevRuleInstall({
      platform: 'linux',
      dryRun: true,
      executor: succeedingExecutor,
      fsOps: noopFsOps,
    });
    expect(result.success).toBe(true);
    for (const legacy of LEGACY_TARGET_PATHS) {
      expect(result.summary).toContain(legacy);
    }
  });
});

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

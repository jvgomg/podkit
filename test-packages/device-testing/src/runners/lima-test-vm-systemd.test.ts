/**
 * Unit tests for the host→Lima-VM systemd unit installer.
 *
 * Strategy mirrors `lima-test-vm-binary.test.ts`: inject a scripted
 * `SubprocessRunner` that records `limactl` invocations and returns canned
 * results. No real `limactl`, no real VM.
 *
 * Covers TASK-322.04.01 ACs #2–#4:
 *   - happy path: probe → copy → install → daemon-reload → cleanup
 *   - idempotency: sha256 match → skip everything; `reloaded: false`
 *   - error propagation for each failure mode (probe / copy / install /
 *     daemon-reload), with cleanup of the temp file when install or reload
 *     fail
 *   - host unit file missing → clear "expected at <path>" error
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  transferSystemdUnit,
  DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH,
} from './lima-test-vm-systemd.js';
import type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult } from '../subprocess.js';

// ---------------------------------------------------------------------------
// Scripted SubprocessRunner
// ---------------------------------------------------------------------------

interface ScriptedCall {
  command: string;
  args: string[];
  opts?: SubprocessRunOpts;
}

type Responder =
  | SubprocessRunResult
  | Error
  | ((call: ScriptedCall) => SubprocessRunResult | Promise<SubprocessRunResult>);

function makeScriptedRunner(script: Responder[]): {
  runner: SubprocessRunner;
  calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  let i = 0;
  return {
    calls,
    runner: {
      async run(command, args, opts) {
        const call: ScriptedCall = { command, args, opts };
        calls.push(call);
        const responder = script[i++];
        if (responder === undefined) {
          throw new Error(`scripted runner exhausted at call ${i}: ${command} ${args.join(' ')}`);
        }
        if (responder instanceof Error) throw responder;
        if (typeof responder === 'function') return responder(call);
        return responder;
      },
    },
  };
}

const ok = (stdout = ''): SubprocessRunResult => ({
  stdout,
  stderr: '',
  exitCode: 0,
});

const fail = (exitCode: number, stderr: string): SubprocessRunResult => ({
  stdout: '',
  stderr,
  exitCode,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpRoot: string;
let hostUnit: string;
let hostSha: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-systemd-'));
  hostUnit = path.join(tmpRoot, 'dummy-hcd-daemon@.service');
  const bytes = Buffer.from(
    '[Unit]\nDescription=podkit dummy-hcd daemon test fixture\n' +
      '[Service]\nExecStart=/usr/local/bin/dummy-hcd-daemon\n'
  );
  fs.writeFileSync(hostUnit, bytes);
  hostSha = createHash('sha256').update(bytes).digest('hex');
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('transferSystemdUnit (happy path)', () => {
  it('runs probe → copy → install → daemon-reload → cleanup when the VM is bare', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok(''), // sha256sum: file absent
      ok(), // limactl copy
      ok(), // sudo install
      ok(), // sudo systemctl daemon-reload
      ok(), // rm -f tmp
    ]);

    const result = await transferSystemdUnit({
      vmName: 'podkit-device-harness',
      hostUnitPath: hostUnit,
      subprocess: runner,
    });

    expect(result.skipped).toBe(false);
    expect(result.reloaded).toBe(true);
    expect(result.hostSha256).toBe(hostSha);
    expect(result.vmName).toBe('podkit-device-harness');
    expect(result.vmUnitPath).toBe(DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH);

    expect(calls).toHaveLength(5);

    // 1. probe: `limactl shell <vm> -- sh -c 'sha256sum <unit> | awk …'`
    expect(calls[0]!.command).toBe('limactl');
    expect(calls[0]!.args[0]).toBe('shell');
    expect(calls[0]!.args[1]).toBe('podkit-device-harness');
    expect(calls[0]!.args[2]).toBe('--');
    expect(calls[0]!.args[3]).toBe('sh');
    expect(calls[0]!.args[4]).toBe('-c');
    expect(calls[0]!.args[5]).toContain('sha256sum');
    expect(calls[0]!.args[5]).toContain(DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH);

    // 2. copy: `limactl copy <host> podkit-device-harness:/tmp/dummy-hcd-daemon-<uuid>.service`
    expect(calls[1]!.args[0]).toBe('copy');
    expect(calls[1]!.args[1]).toBe(hostUnit);
    expect(calls[1]!.args[2]).toMatch(
      /^podkit-device-harness:\/tmp\/dummy-hcd-daemon-[0-9a-f-]+\.service$/
    );

    // 3. install: `limactl shell <vm> -- sudo install -m 0644 <tmp> <vmUnitPath>`
    // -- must come before sudo (separates limactl args from in-VM args).
    expect(calls[2]!.args[0]).toBe('shell');
    expect(calls[2]!.args[1]).toBe('podkit-device-harness');
    expect(calls[2]!.args[2]).toBe('--');
    expect(calls[2]!.args[3]).toBe('sudo');
    expect(calls[2]!.args[4]).toBe('install');
    expect(calls[2]!.args[5]).toBe('-m');
    expect(calls[2]!.args[6]).toBe('0644');
    const tmpVmPath = calls[1]!.args[2]!.split(':')[1];
    expect(calls[2]!.args[7]).toBe(tmpVmPath);
    expect(calls[2]!.args[8]).toBe(DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH);

    // 4. daemon-reload
    expect(calls[3]!.args).toEqual([
      'shell',
      'podkit-device-harness',
      '--',
      'sudo',
      'systemctl',
      'daemon-reload',
    ]);

    // 5. cleanup
    expect(calls[4]!.args[0]).toBe('shell');
    expect(calls[4]!.args).toContain('rm');
    expect(calls[4]!.args).toContain('-f');
    expect(tmpVmPath).toBeDefined();
    expect(calls[4]!.args).toContain(tmpVmPath!);
  });

  it('respects a custom vmUnitPath', async () => {
    const { runner, calls } = makeScriptedRunner([ok(''), ok(), ok(), ok(), ok()]);

    const result = await transferSystemdUnit({
      vmName: 'podkit-device-harness',
      hostUnitPath: hostUnit,
      vmUnitPath: '/etc/systemd/system/custom@.service',
      subprocess: runner,
    });

    expect(result.vmUnitPath).toBe('/etc/systemd/system/custom@.service');
    expect(calls[2]!.args).toContain('/etc/systemd/system/custom@.service');
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('transferSystemdUnit (idempotent on sha256 match)', () => {
  it('skips copy + install + daemon-reload when the VM already has the same sha256', async () => {
    const { runner, calls } = makeScriptedRunner([ok(hostSha + '\n')]);

    const result = await transferSystemdUnit({
      vmName: 'podkit-device-harness',
      hostUnitPath: hostUnit,
      subprocess: runner,
    });

    expect(result.skipped).toBe(true);
    expect(result.reloaded).toBe(false);
    expect(result.hostSha256).toBe(hostSha);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.join(' ')).toContain('sha256sum');
  });

  it('does NOT skip when the VM has a different sha256', async () => {
    const wrongSha = 'deadbeef'.repeat(8);
    const { runner, calls } = makeScriptedRunner([
      ok(wrongSha + '\n'),
      ok(), // copy
      ok(), // install
      ok(), // daemon-reload
      ok(), // cleanup
    ]);

    const result = await transferSystemdUnit({
      vmName: 'podkit-device-harness',
      hostUnitPath: hostUnit,
      subprocess: runner,
    });

    expect(result.skipped).toBe(false);
    expect(result.reloaded).toBe(true);
    expect(calls).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Error propagation — each step has its own descriptive Error
// ---------------------------------------------------------------------------

describe('transferSystemdUnit (error propagation)', () => {
  it('surfaces a clear error when the host unit file is missing', async () => {
    const ghost = path.join(tmpRoot, 'no-such-unit.service');
    const { runner, calls } = makeScriptedRunner([]);
    let caught: Error | undefined;
    try {
      await transferSystemdUnit({
        vmName: 'podkit-device-harness',
        hostUnitPath: ghost,
        subprocess: runner,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('cannot read systemd unit file');
    expect(caught!.message).toContain(`expected at ${ghost}`);
    expect(calls).toHaveLength(0); // never reached limactl
  });

  it('throws when the probe step fails (limactl shell non-zero)', async () => {
    const { runner } = makeScriptedRunner([fail(1, 'instance "podkit-device-harness" not found')]);
    let caught: Error | undefined;
    try {
      await transferSystemdUnit({
        vmName: 'podkit-device-harness',
        hostUnitPath: hostUnit,
        subprocess: runner,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/failed to probe systemd unit/);
    expect(caught!.message).toContain('podkit-device-harness');
    expect(caught!.message).toContain('not found');
  });

  it('throws when the copy step fails (and never proceeds to install)', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok(''), // probe: absent
      fail(1, 'failed to copy: connection refused'),
    ]);
    let caught: Error | undefined;
    try {
      await transferSystemdUnit({
        vmName: 'podkit-device-harness',
        hostUnitPath: hostUnit,
        subprocess: runner,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/limactl copy failed sending systemd unit/);
    expect(caught!.message).toContain('connection refused');
    // Only probe + copy ran; never `install`, never `daemon-reload`.
    expect(calls).toHaveLength(2);
    expect(calls.some((c) => c.args.includes('install'))).toBe(false);
    expect(calls.some((c) => c.args.includes('daemon-reload'))).toBe(false);
  });

  it('throws when the install step fails and still cleans up the temp file', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok(''), // probe
      ok(), // copy
      fail(1, 'install: cannot create regular file: Permission denied'),
      ok(), // cleanup rm
    ]);

    let caught: Error | undefined;
    try {
      await transferSystemdUnit({
        vmName: 'podkit-device-harness',
        hostUnitPath: hostUnit,
        subprocess: runner,
      });
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/sudo install failed/);
    expect(caught!.message).toContain('Permission denied');

    // The last recorded call must have been the cleanup rm — i.e. we tried
    // to drop the temp file before propagating the error. daemon-reload
    // must NOT have run because the install never succeeded.
    expect(calls).toHaveLength(4);
    expect(calls.some((c) => c.args.includes('daemon-reload'))).toBe(false);
    const last = calls[calls.length - 1]!;
    expect(last.args).toContain('rm');
    expect(last.args).toContain('-f');
  });

  it('throws when daemon-reload fails and still cleans up the temp file', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok(''), // probe
      ok(), // copy
      ok(), // install
      fail(1, 'systemctl: Failed to reload daemon: Connection refused'),
      ok(), // cleanup rm
    ]);

    let caught: Error | undefined;
    try {
      await transferSystemdUnit({
        vmName: 'podkit-device-harness',
        hostUnitPath: hostUnit,
        subprocess: runner,
      });
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/systemctl daemon-reload failed/);
    expect(caught!.message).toContain('Connection refused');

    expect(calls).toHaveLength(5);
    const last = calls[calls.length - 1]!;
    expect(last.args).toContain('rm');
    expect(last.args).toContain('-f');
  });

  it('requires vmName', async () => {
    let caught: Error | undefined;
    try {
      await transferSystemdUnit({ vmName: '', hostUnitPath: hostUnit });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('vmName is required');
  });
});

// ---------------------------------------------------------------------------
// Atomicity: temp path is randomised; cleanup still runs on success
// ---------------------------------------------------------------------------

describe('transferSystemdUnit (atomicity)', () => {
  it('uses a unique /tmp/dummy-hcd-daemon-<uuid>.service per invocation', async () => {
    const a = makeScriptedRunner([ok(''), ok(), ok(), ok(), ok()]);
    const b = makeScriptedRunner([ok(''), ok(), ok(), ok(), ok()]);

    await transferSystemdUnit({
      vmName: 'podkit-device-harness',
      hostUnitPath: hostUnit,
      subprocess: a.runner,
    });
    await transferSystemdUnit({
      vmName: 'podkit-device-harness',
      hostUnitPath: hostUnit,
      subprocess: b.runner,
    });

    const tmpA = a.calls[1]!.args[2];
    const tmpB = b.calls[1]!.args[2];
    expect(tmpA).not.toBe(tmpB);
    expect(tmpA).toMatch(/^podkit-device-harness:\/tmp\/dummy-hcd-daemon-[0-9a-f-]+\.service$/);
  });
});

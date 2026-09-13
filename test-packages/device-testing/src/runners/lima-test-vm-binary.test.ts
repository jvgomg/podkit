/**
 * Unit tests for the host→Lima-VM binary transfer helper.
 *
 * Strategy: inject a fake `SubprocessRunner` that records every `limactl`
 * invocation and returns scripted results. No real `limactl`, no real VM.
 *
 * Coverage targets the six TASK-322.03 acceptance criteria:
 *   AC1 — helper exists and performs limactl copy + install atomically
 *   AC2 — idempotent (skip on sha256 match)
 *   AC3 — atomic (temp path then install; cleanup on failure)
 *   AC4 — host binary must exist
 *   AC5 — error path surfaces a descriptive Error
 *   AC6 — gpod-tool missing source path errors clearly
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  transferBinary,
  transferGpodTool,
  DEFAULT_PODKIT_VM_PATH,
  DEFAULT_GPOD_TOOL_VM_PATH,
} from './lima-test-vm-binary.js';
import type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult } from '../subprocess.js';
import { createLimactlLink } from '@podkit/lima';
import { isSubstrateLinkError } from '@podkit/substrate';

// ---------------------------------------------------------------------------
// Substrate link over a scripted runner
//
// The harness talks to a `SubstrateLink`, never to `limactl` directly — so the
// seam the assertions below record is the link's argv. Building a limactl link
// over the scripted runner keeps those assertions pinning exactly what a real
// Lima substrate receives, which is the point: they are what a second
// implementation has to reproduce.
// ---------------------------------------------------------------------------

/**
 * A runner that fails the test if anything reaches it. The default for cases
 * whose whole point is that a host-side guard fires BEFORE the substrate is
 * touched — "no runner in scope" would otherwise read as "no assertion".
 */
const neverReached: SubprocessRunner = {
  async run(command, args) {
    throw new Error(`unexpected substrate call: ${command} ${args.join(' ')}`);
  },
};

const linkTo = (instanceName: string, subprocess: SubprocessRunner = neverReached) =>
  createLimactlLink({ id: instanceName, instanceName }, { subprocess });

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

/**
 * limactl's refusal when the instance is not there, captured verbatim from
 * `limactl shell … 2>&1 | cat` (limactl 2.1.1) rather than written from
 * memory. The piped form is the only one the harness sees: limactl writes the
 * bracketed `FATA[…]` logrus prefix only to a TTY. See the fixture note in
 * `@podkit/lima`'s `link.test.ts`.
 */
const LIMACTL_MISSING_INSTANCE =
  'time="2026-09-13T23:00:43+01:00" level=fatal ' +
  'msg="instance \\"podkit-device\\" does not exist, run `limactl create podkit-device` ' +
  'to create a new instance"';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpRoot: string;
let hostBinary: string;
let hostSha: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-xfer-'));
  hostBinary = path.join(tmpRoot, 'podkit-linux-x64');
  const bytes = Buffer.from('fake-podkit-binary-contents-' + Math.random());
  fs.writeFileSync(hostBinary, bytes);
  hostSha = createHash('sha256').update(bytes).digest('hex');
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// transferBinary — happy path
// ---------------------------------------------------------------------------

describe('transferBinary (AC1: copy + install + cleanup atomically)', () => {
  it('runs probe → copy → install → cleanup when no existing VM binary', async () => {
    // probe finds nothing (empty stdout), then copy, install, cleanup all succeed.
    const { runner, calls } = makeScriptedRunner([
      ok(''), // sha256sum (file absent → exit 0 with `awk` printing nothing)
      ok(), // limactl copy
      ok(), // sudo install
      ok(), // cleanup rm
    ]);

    const result = await transferBinary({
      link: linkTo('podkit-device', runner),
      binaryPath: hostBinary,
    });

    expect(result.skipped).toBe(false);
    expect(result.hostSha256).toBe(hostSha);
    expect(result.substrate).toContain('podkit-device');
    expect(result.vmPath).toBe(DEFAULT_PODKIT_VM_PATH);

    expect(calls).toHaveLength(4);
    expect(calls[0]!.command).toBe('limactl');
    expect(calls[0]!.args[0]).toBe('shell');
    expect(calls[0]!.args).toContain('podkit-device');
    expect(calls[0]!.args.join(' ')).toContain('sha256sum');

    // copy: <host> <vm>:<tmp>
    expect(calls[1]!.args[0]).toBe('copy');
    expect(calls[1]!.args[1]).toBe(hostBinary);
    expect(calls[1]!.args[2]).toMatch(/^podkit-device:\/tmp\/podkit-transfer-/);

    // install: sudo install -m 0755 <tmp> <vmPath>
    // Assert tmp precedes vmPath so a swapped argument order (which would
    // clobber the live path with the empty temp file) is caught.
    expect(calls[2]!.args[0]).toBe('shell');
    expect(calls[2]!.args).toEqual(
      expect.arrayContaining(['sudo', 'install', '-m', '0755', DEFAULT_PODKIT_VM_PATH])
    );
    const tmpVmPath = calls[1]!.args[2]!.split(':')[1];
    const installArgs = calls[2]!.args;
    const tmpIdx = installArgs.indexOf(tmpVmPath!);
    const dstIdx = installArgs.indexOf(DEFAULT_PODKIT_VM_PATH);
    expect(tmpIdx).toBeGreaterThan(-1);
    expect(dstIdx).toBeGreaterThan(tmpIdx);

    // cleanup: rm -f <tmp>
    expect(calls[3]!.args).toContain('rm');
  });

  it('respects a custom vmPath', async () => {
    const { runner, calls } = makeScriptedRunner([ok(''), ok(), ok(), ok()]);
    const result = await transferBinary({
      link: linkTo('podkit-device', runner),
      binaryPath: hostBinary,
      vmPath: '/opt/podkit/podkit',
    });
    expect(result.vmPath).toBe('/opt/podkit/podkit');
    expect(calls[2]!.args).toContain('/opt/podkit/podkit');
  });
});

// ---------------------------------------------------------------------------
// AC2: idempotency (sha256 match → skip)
// ---------------------------------------------------------------------------

describe('transferBinary (AC2: idempotent on sha256 match)', () => {
  it('skips copy + install when the VM already has the same sha256', async () => {
    const { runner, calls } = makeScriptedRunner([ok(hostSha + '\n')]);

    const result = await transferBinary({
      link: linkTo('podkit-device', runner),
      binaryPath: hostBinary,
    });

    expect(result.skipped).toBe(true);
    expect(result.hostSha256).toBe(hostSha);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.join(' ')).toContain('sha256sum');
  });

  it('does NOT skip when VM has a different sha256', async () => {
    const wrongSha = 'deadbeef'.repeat(8);
    const { runner, calls } = makeScriptedRunner([ok(wrongSha + '\n'), ok(), ok(), ok()]);

    const result = await transferBinary({
      link: linkTo('podkit-device', runner),
      binaryPath: hostBinary,
    });

    expect(result.skipped).toBe(false);
    expect(calls.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// AC3: atomic — temp path then install; cleanup on failure
// ---------------------------------------------------------------------------

describe('transferBinary (AC3: atomicity)', () => {
  it('uses a unique /tmp/podkit-transfer-<uuid> path per invocation', async () => {
    const probe1 = makeScriptedRunner([ok(''), ok(), ok(), ok()]);
    const probe2 = makeScriptedRunner([ok(''), ok(), ok(), ok()]);

    await transferBinary({
      link: linkTo('podkit-device', probe1.runner),
      binaryPath: hostBinary,
    });
    await transferBinary({
      link: linkTo('podkit-device', probe2.runner),
      binaryPath: hostBinary,
    });

    const tmpA = probe1.calls[1]!.args[2];
    const tmpB = probe2.calls[1]!.args[2];
    expect(tmpA).not.toBe(tmpB);
    expect(tmpA).toMatch(/^podkit-device:\/tmp\/podkit-transfer-[0-9a-f-]+$/);
  });

  it('cleans up the temp file when install fails (no dangling state)', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok(''), // probe: absent
      ok(), // copy succeeds
      fail(1, 'install: cannot create regular file: Permission denied'), // install fails
      ok(), // cleanup rm
    ]);

    let caught: Error | undefined;
    try {
      await transferBinary({
        link: linkTo('podkit-device', runner),
        binaryPath: hostBinary,
      });
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/install failed/i);
    expect(caught!.message).toContain('Permission denied');

    // The last call must be the cleanup rm — i.e. the helper tried to
    // remove the temp file before propagating the error.
    expect(calls).toHaveLength(4);
    const last = calls[calls.length - 1]!;
    expect(last.args).toContain('rm');
    expect(last.args).toContain('-f');
  });

  it('never touches vmPath when the copy step fails', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok(''), // probe
      fail(1, 'failed to copy: connection refused'), // copy fails
    ]);

    let caught: Error | undefined;
    try {
      await transferBinary({
        link: linkTo('podkit-device', runner),
        binaryPath: hostBinary,
      });
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/failed to copy podkit binary/);
    // Only probe + copy ran. No `install`, no premature `rm`.
    expect(calls).toHaveLength(2);
    expect(calls.some((c) => c.args.includes('install'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC4 + AC5: error surfaces
// ---------------------------------------------------------------------------

describe('transferBinary (AC4/AC5: error paths)', () => {
  it('throws a descriptive error when the host binary does not exist', async () => {
    const ghost = path.join(tmpRoot, 'no-such-binary');
    const { runner, calls } = makeScriptedRunner([]);
    let caught: Error | undefined;
    try {
      await transferBinary({
        link: linkTo('podkit-device', runner),
        binaryPath: ghost,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('cannot read podkit binary');
    expect(caught!.message).toContain(ghost);
    expect(caught!.message).toContain('bun run harness:install');
    expect(calls).toHaveLength(0); // never reached limactl
  });

  it('throws when limactl itself is not installed (ENOENT on transport)', async () => {
    const enoent = new Error('spawn limactl ENOENT');
    const { runner } = makeScriptedRunner([enoent]);

    let caught: Error | undefined;
    try {
      await transferBinary({
        link: linkTo('podkit-device', runner),
        binaryPath: hostBinary,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('limactl');
    expect(caught!.message).toContain('brew install lima');
  });

  // An unreachable substrate and a failing guest command are different
  // outcomes: the first is a reason to skip, the second a reason to fail. The
  // exit code cannot tell them apart — it belongs to the guest either way — so
  // the link raises a typed error for the first and returns for the second.
  it('raises a typed link error when the substrate is not there to probe', async () => {
    const { runner } = makeScriptedRunner([fail(1, LIMACTL_MISSING_INSTANCE)]);
    let caught: unknown;
    try {
      await transferBinary({
        link: linkTo('podkit-device', runner),
        binaryPath: hostBinary,
      });
    } catch (err) {
      caught = err;
    }
    expect(isSubstrateLinkError(caught)).toBe(true);
    expect((caught as Error).message).toContain('podkit-device');
    expect((caught as Error).message).toContain('does not exist');
  });

  it('reports a probe that the substrate itself refused as a guest failure', async () => {
    const { runner } = makeScriptedRunner([fail(127, 'sh: awk: not found')]);
    let caught: unknown;
    try {
      await transferBinary({
        link: linkTo('podkit-device', runner),
        binaryPath: hostBinary,
      });
    } catch (err) {
      caught = err;
    }
    expect(isSubstrateLinkError(caught)).toBe(false);
    expect((caught as Error).message).toMatch(/failed to probe/);
    expect((caught as Error).message).toContain('awk: not found');
  });
});

// ---------------------------------------------------------------------------
// AC6: gpod-tool variant
// ---------------------------------------------------------------------------

describe('transferGpodTool', () => {
  it('defaults to /usr/local/bin/gpod-tool', async () => {
    const { runner, calls } = makeScriptedRunner([ok(''), ok(), ok(), ok()]);
    const result = await transferGpodTool({
      link: linkTo('podkit-device', runner),
      binaryPath: hostBinary,
    });
    expect(result.vmPath).toBe(DEFAULT_GPOD_TOOL_VM_PATH);
    expect(calls[2]!.args).toContain(DEFAULT_GPOD_TOOL_VM_PATH);
  });

  it('throws with a clear hint when the host gpod-tool is missing', async () => {
    const ghost = path.join(tmpRoot, 'no-gpod-tool');
    let caught: Error | undefined;
    try {
      await transferGpodTool({
        link: linkTo('podkit-device'),
        binaryPath: ghost,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('cannot read gpod-tool');
    expect(caught!.message).toContain(ghost);
    expect(caught!.message).toContain('bun run harness:install');
  });

  it('is idempotent on sha256 match (skips copy + install)', async () => {
    const { runner, calls } = makeScriptedRunner([ok(hostSha)]);
    const result = await transferGpodTool({
      link: linkTo('podkit-device', runner),
      binaryPath: hostBinary,
    });
    expect(result.skipped).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

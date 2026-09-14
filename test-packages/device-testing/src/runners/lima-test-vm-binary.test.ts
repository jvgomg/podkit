/**
 * Unit tests for the host→Lima-VM binary transfer helper.
 *
 * Strategy: inject a fake `SubprocessRunner` that records every `limactl`
 * invocation and returns scripted results. No real `limactl`, no real VM.
 *
 * The host-side fixture is a synthesised aarch64 ELF header rather than
 * arbitrary bytes, and the scripted probe answers `aarch64` — the transfer
 * refuses to install a binary that cannot start on the substrate it is going
 * to, so both halves of that comparison have to be real for the happy paths to
 * be happy. The mismatch itself gets its own section at the end.
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
import { ArtifactArchMismatchError, isSubstrateLinkError } from '@podkit/substrate';

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

/**
 * The substrate's answer to the combined probe: its machine type on the first
 * line, the digest of whatever sits at `vmPath` (empty when nothing does) on
 * the second. One call, because the transfer needs both facts and a second
 * round trip per artifact buys nothing.
 */
const probed = (machine: string, vmSha = ''): SubprocessRunResult => ok(`${machine}\n${vmSha}\n`);

/**
 * A minimal ELF64 header with the given `e_machine` (EM_AARCH64 / EM_X86_64),
 * padded out so the file looks like a binary rather than a 64-byte oddity.
 * Synthesised rather than checked in: the transfer reads two bytes of it.
 */
function fakeElf(eMachine: number, salt: string): Buffer {
  const bytes = Buffer.alloc(256);
  bytes.set([0x7f, 0x45, 0x4c, 0x46], 0); // \x7fELF
  bytes[4] = 2; // ELFCLASS64
  bytes[5] = 1; // ELFDATA2LSB
  bytes[6] = 1; // EV_CURRENT
  bytes[16] = 2; // ET_EXEC
  bytes[0x12] = eMachine & 0xff;
  bytes[0x13] = (eMachine >> 8) & 0xff;
  bytes.write(salt, 64, 'utf8');
  return bytes;
}

const EM_AARCH64 = 0xb7;
const EM_X86_64 = 0x3e;

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
  hostBinary = path.join(tmpRoot, 'podkit-linux-arm64');
  const bytes = fakeElf(EM_AARCH64, `fake-podkit-binary-contents-${Math.random()}`);
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
      probed('aarch64'), // uname -m + sha256sum (file absent → empty digest)
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
    // One probe carrying both facts the transfer decides on. Splitting it into
    // two would double the round trips on a four-artifact install for nothing.
    expect(calls[0]!.args.join(' ')).toContain('sha256sum');
    expect(calls[0]!.args.join(' ')).toContain('uname -m');

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
    const { runner, calls } = makeScriptedRunner([probed('aarch64'), ok(), ok(), ok()]);
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
    const { runner, calls } = makeScriptedRunner([probed('aarch64', hostSha)]);

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
    const { runner, calls } = makeScriptedRunner([probed('aarch64', wrongSha), ok(), ok(), ok()]);

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
    const probe1 = makeScriptedRunner([probed('aarch64'), ok(), ok(), ok()]);
    const probe2 = makeScriptedRunner([probed('aarch64'), ok(), ok(), ok()]);

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
      probed('aarch64'), // probe: matching machine, no existing file
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
      probed('aarch64'), // probe
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
    const { runner, calls } = makeScriptedRunner([probed('aarch64'), ok(), ok(), ok()]);
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
    const { runner, calls } = makeScriptedRunner([probed('aarch64', hostSha)]);
    const result = await transferGpodTool({
      link: linkTo('podkit-device', runner),
      binaryPath: hostBinary,
    });
    expect(result.skipped).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Architecture: the artifact has to be able to start on the substrate
//
// This is the backstop for a build-cache key that is wrong anyway. Without it
// the symptom is an `exec format error` partway through a test run, blamed on
// whichever test invoked the binary first — which sends the reader hunting
// through the test, the harness and the guest, everywhere except the build
// that produced the bytes.
//
// Neither case below is reachable on a single machine by accident, which is
// exactly why they are scripted: the substrate's machine type and the
// artifact's ELF header are both inputs here.
// ---------------------------------------------------------------------------

describe('transferBinary (artifact arch vs substrate arch)', () => {
  it('refuses a foreign-arch binary before anything is copied', async () => {
    const foreign = path.join(tmpRoot, 'podkit-linux-x64');
    fs.writeFileSync(foreign, fakeElf(EM_X86_64, 'built-for-the-other-machine'));
    const { runner, calls } = makeScriptedRunner([probed('aarch64')]);

    let caught: unknown;
    try {
      await transferBinary({ link: linkTo('podkit-device', runner), binaryPath: foreign });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ArtifactArchMismatchError);
    expect((caught as Error).message).toContain('linux-x64');
    expect((caught as Error).message).toContain('aarch64');
    // Probe only. No copy, no install — the substrate is left exactly as it
    // was, which is the difference between a caught mistake and a broken box.
    expect(calls).toHaveLength(1);
  });

  it('fires even when the substrate already holds bytes with the same digest', async () => {
    // Ordering matters: a substrate swapped for one of the other architecture
    // still has the previous host's binary at vmPath. Checking idempotency
    // first would sha-match it and skip, leaving a binary that cannot start.
    const foreign = path.join(tmpRoot, 'podkit-linux-x64');
    const bytes = fakeElf(EM_X86_64, 'same-bytes-both-sides');
    fs.writeFileSync(foreign, bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const { runner } = makeScriptedRunner([probed('aarch64', sha)]);

    await expect(
      transferBinary({ link: linkTo('podkit-device', runner), binaryPath: foreign })
    ).rejects.toBeInstanceOf(ArtifactArchMismatchError);
  });

  it('refuses a host-native artifact that is not a Linux ELF at all', async () => {
    // `bin/podkit` from a macOS `bun run compile` sitting where the linux
    // artifact was expected — a Mach-O, correctly named, entirely unrunnable.
    const machO = path.join(tmpRoot, 'podkit-linux-arm64-macho');
    fs.writeFileSync(machO, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]));
    const { runner } = makeScriptedRunner([probed('aarch64')]);

    await expect(
      transferBinary({ link: linkTo('podkit-device', runner), binaryPath: machO })
    ).rejects.toBeInstanceOf(ArtifactArchMismatchError);
  });

  it('accepts an x86_64 artifact on an x86_64 substrate', async () => {
    // The point of the slice: an arm64 macOS host naming, checking and
    // installing an amd64 artifact is an ordinary transfer, not a special case.
    const foreign = path.join(tmpRoot, 'podkit-linux-x64');
    fs.writeFileSync(foreign, fakeElf(EM_X86_64, 'amd64-substrate'));
    const { runner, calls } = makeScriptedRunner([probed('x86_64'), ok(), ok(), ok()]);

    const result = await transferBinary({
      link: linkTo('podkit-device', runner),
      binaryPath: foreign,
    });

    expect(result.skipped).toBe(false);
    expect(calls).toHaveLength(4);
  });
});

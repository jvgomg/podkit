/**
 * Unit tests for `podkit-vm`, the single command-line chokepoint every
 * create/start path is meant to funnel through. Feed scripted `limactl`
 * outputs through the injected `SubprocessRunner`, dispatch by calling
 * `main(argv, opts)` directly (no real process, no real VM), and assert on
 * exit codes plus the operator-facing messages. The advisory lock is real
 * (proper-lockfile) but keyed into a per-test temp dir so tests stay
 * hermetic and never contend with a real VM's lock file in the OS temp dir.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { main } from './cli.js';
import { getVm } from './registry.js';
import { acquireVmLock, isVmLocked } from './lock.js';
import { repoRoot } from './paths.js';
import { BASELINE_VM_HASH_PATH } from './baseline-hash.js';
import type {
  SubprocessRunner,
  SubprocessRunOpts,
  SubprocessRunResult,
} from '@podkit/device-types';

interface ScriptedCall {
  command: string;
  args: string[];
  opts?: SubprocessRunOpts;
}

const ok = (stdout = ''): SubprocessRunResult => ({ stdout, stderr: '', exitCode: 0 });
const fail = (stderr: string, exitCode = 1): SubprocessRunResult => ({
  stdout: '',
  stderr,
  exitCode,
});

const DEVICE = getVm('device');
const INSTANCE = DEVICE.instanceName;

/** A `limactl list --json` response conveying the given status for INSTANCE. */
function listStatus(state: 'running' | 'stopped' | 'missing'): SubprocessRunResult {
  if (state === 'missing') {
    return ok(JSON.stringify({ name: 'some-other-vm', status: 'Running' }));
  }
  const status = state === 'running' ? 'Running' : 'Stopped';
  return ok(JSON.stringify({ name: INSTANCE, status }));
}

function makeScriptedRunner(script: SubprocessRunResult[]): {
  runner: SubprocessRunner;
  calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  let i = 0;
  return {
    calls,
    runner: {
      async run(command, args, opts) {
        calls.push({ command, args, opts });
        const responder = script[i++];
        if (responder === undefined) {
          throw new Error(`unexpected subprocess call #${i}: ${command} ${args.join(' ')}`);
        }
        return responder;
      },
    },
  };
}

let stdoutWrite: ReturnType<typeof spyOn>;
let stderrWrite: ReturnType<typeof spyOn>;

function stdoutText(): string {
  return stdoutWrite.mock.calls.map((call: unknown[]) => String(call[0])).join('');
}
function stderrText(): string {
  return stderrWrite.mock.calls.map((call: unknown[]) => String(call[0])).join('');
}

beforeEach(() => {
  stdoutWrite = spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrWrite = spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  stdoutWrite.mockRestore();
  stderrWrite.mockRestore();
});

describe('verb and argument validation', () => {
  it('prints usage and fails when no verb is given', async () => {
    const code = await main([]);
    expect(code).toBe(1);
    expect(stderrText()).toContain('Usage: podkit-vm');
  });

  it('prints usage and fails on an unknown verb', async () => {
    const code = await main(['fly-to-the-moon', 'device']);
    expect(code).toBe(1);
    expect(stderrText()).toContain('Usage: podkit-vm');
  });

  it('requires an instance argument and does not silently pick one', async () => {
    const code = await main(['status']);
    expect(code).toBe(1);
    expect(stderrText()).toContain('requires an <instance> argument');
  });

  it('surfaces an unknown instance as a clean operator message, not a raw stack trace', async () => {
    const code = await main(['status', 'does-not-exist']);
    expect(code).toBe(1);
    const err = stderrText();
    expect(err).toContain("no VM registered for 'does-not-exist'");
    expect(err).toContain('Known VMs:');
    // A raw stack trace would include a "at <file>:<line>" frame; the CLI is
    // expected to print only the error's message, not its stack.
    expect(err).not.toMatch(/at .*\.(ts|js):\d+/);
  });
});

describe('status', () => {
  it('prints the probed status and exits 0', async () => {
    const { runner } = makeScriptedRunner([listStatus('running')]);
    const code = await main(['status', 'device'], { subprocess: runner });
    expect(code).toBe(0);
    expect(stdoutText()).toContain('running');
  });
});

describe('destroy', () => {
  it('is a no-op and never calls delete when the instance is already missing', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('missing')]);
    const code = await main(['destroy', 'device'], { subprocess: runner });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('deletes immediately when --yes is passed', async () => {
    // cmdDestroy probes status itself (for the confirm-prompt message), and
    // the lifecycle `destroy()` it delegates to probes status again before
    // deciding to delete — both scripted as "running" here.
    const { runner, calls } = makeScriptedRunner([
      listStatus('running'),
      listStatus('running'),
      ok(),
    ]);
    const code = await main(['destroy', 'device', '--yes'], { subprocess: runner });
    expect(code).toBe(0);
    expect(calls[2]!.args).toEqual(['delete', '--force', INSTANCE]);
  });

  it('refuses to delete non-interactively without --yes, and never calls delete', async () => {
    const originalIsTTY = process.stdin.isTTY;
    // Force the non-interactive branch regardless of how this test happens
    // to be invoked.
    process.stdin.isTTY = false;
    try {
      const { runner, calls } = makeScriptedRunner([listStatus('running')]);
      const code = await main(['destroy', 'device'], { subprocess: runner });
      expect(code).toBe(1);
      expect(calls).toHaveLength(1); // status probe only — no delete call
      expect(stderrText()).toContain('Pass --yes');
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }
  });
});

describe('doctor (baseline-hash reporting)', () => {
  it('is a no-op for a VM that is not baseline-tracked, and touches no subprocess', async () => {
    const { runner } = makeScriptedRunner([]);
    const code = await main(['doctor', 'builderGlibc'], { subprocess: runner });
    expect(code).toBe(0);
    expect(stdoutText()).toContain('not baseline-tracked');
  });

  it('fails without checking the baseline hash when the VM is not running', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('stopped')]);
    const code = await main(['doctor', 'device'], { subprocess: runner });
    expect(code).toBe(1);
    expect(calls).toHaveLength(1); // status probe only — never shells in
    expect(stderrText()).toContain('start it before doctor');
  });

  it('fails and tells the operator to re-seal when no baseline hash is sealed in the VM', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('running'), ok('')]);
    const code = await main(['doctor', 'device'], { subprocess: runner });
    expect(code).toBe(1);
    expect(calls[1]!.args).toEqual([
      'shell',
      INSTANCE,
      '--',
      'sh',
      '-c',
      `cat ${BASELINE_VM_HASH_PATH} 2>/dev/null || true`,
    ]);
    const err = stderrText();
    expect(err).toContain('no sealed baseline hash');
    expect(err).toContain('harness:setup');
  });

  it('succeeds and points the operator at the real drift check when a baseline hash is sealed', async () => {
    const { runner } = makeScriptedRunner([
      listStatus('running'),
      ok('deadbeef000011112222333344445555deadbeef'),
    ]);
    const code = await main(['doctor', 'device'], { subprocess: runner });
    expect(code).toBe(0);
    const out = stdoutText();
    expect(out).toContain('sealed baseline hash');
    // This pointer is the entire reason the degraded verb is acceptable: the
    // real drift comparison lives elsewhere, and the operator must be told
    // where to find it.
    expect(out).toContain('bun run vm:doctor');
  });
});

describe('the shared advisory lock around create/start', () => {
  let lockDir: string;
  beforeEach(() => {
    lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-cli-lock-'));
  });
  afterEach(() => {
    fs.rmSync(lockDir, { recursive: true, force: true });
  });

  it('ensure takes the lock before touching limactl, so a concurrent holder blocks it', async () => {
    const release = await acquireVmLock(INSTANCE, { lockDir, staleMs: 5000 });
    try {
      const { runner, calls } = makeScriptedRunner([]); // any call here would be a real bug
      const code = await main(['ensure', 'device'], {
        subprocess: runner,
        lock: { lockDir, staleMs: 5000, retries: 0 },
      });
      expect(code).toBe(1);
      expect(stderrText()).toContain('Lock file is already being held');
      expect(calls).toHaveLength(0);
    } finally {
      await release();
    }
  });

  it('releases the lock when ensure fails, so a subsequent start is not wedged', async () => {
    const { runner } = makeScriptedRunner([listStatus('missing'), fail('disk full')]);
    const code = await main(['ensure', 'device'], {
      subprocess: runner,
      lock: { lockDir, staleMs: 5000 },
    });
    expect(code).toBe(1);
    expect(stderrText()).toMatch(/failed to create\+start.*disk full/s);

    expect(await isVmLocked(INSTANCE, { lockDir, staleMs: 5000 })).toBe(false);

    // Concretely prove it is not wedged: a fresh contender can take the lock
    // immediately, with zero retries, right after the failure.
    const release = await acquireVmLock(INSTANCE, { lockDir, staleMs: 5000, retries: 0 });
    await release();
  });

  it('points a failed ensure at `recover` instead of deleting the VM itself', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('stopped'), fail('hostagent wedged')]);
    const code = await main(['ensure', 'device'], {
      subprocess: runner,
      lock: { lockDir, staleMs: 5000 },
    });
    expect(code).toBe(1);
    expect(stderrText()).toContain('podkit-vm recover device');
    // A destructive auto-recreate would show up as a `delete` call.
    expect(calls.some((c) => c.args[0] === 'delete')).toBe(false);
  });
});

describe('ensure', () => {
  it('CREATES a missing instance rather than demanding someone else made it first', async () => {
    // Two independently-scheduled build tasks share a builder VM with no
    // ordering edge between them, so on a host where that VM does not exist
    // yet either one can arrive first. A verb that refuses to create would
    // abort whichever task got there first.
    const builder = getVm('builderGlibc');
    const { runner, calls } = makeScriptedRunner([
      listStatus('missing'), // probe inside the lock: no such instance
      ok(), // limactl start --name=… <yaml>
      ok(JSON.stringify({ name: builder.instanceName, status: 'Running' })), // post-condition
    ]);
    const code = await main(['ensure', 'builderGlibc'], { subprocess: runner });
    expect(code).toBe(0);
    const create = calls[1]!.args;
    expect(create[0]).toBe('start');
    expect(create).toContain(`--name=${builder.instanceName}`);
    expect(create[create.length - 1]).toBe(builder.yamlPath);
  });

  it('starts a stopped instance without recreating it', async () => {
    const { runner, calls } = makeScriptedRunner([
      listStatus('stopped'),
      ok(),
      listStatus('running'),
    ]);
    const code = await main(['ensure', 'device'], { subprocess: runner });
    expect(code).toBe(0);
    expect(calls[1]!.args).toEqual(['start', INSTANCE]);
  });

  it('is a no-op when the instance is already running', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('running'), listStatus('running')]);
    const code = await main(['ensure', 'device'], { subprocess: runner });
    expect(code).toBe(0);
    expect(calls.every((c) => c.args[0] === 'list')).toBe(true);
  });
});

describe('stage', () => {
  it('stages the repo root into the VM with the shared exclude floor', async () => {
    const { runner, calls } = makeScriptedRunner([ok()]);
    const code = await main(['stage', 'device', '--dest', '/tmp/work'], { subprocess: runner });
    expect(code).toBe(0);
    const body = calls[0]!.args[5]!;
    expect(calls[0]!.args.slice(0, 5)).toEqual(['shell', INSTANCE, '--', 'sh', '-c']);
    expect(body).toContain("--exclude 'node_modules'");
    expect(body).toContain("'/tmp/work/'");
    // --src defaults to the repo this package lives in.
    expect(body).toContain(`'${repoRoot()}/'`);
  });

  it('honours an explicit --src, repeated --exclude, and --sudo', async () => {
    const { runner, calls } = makeScriptedRunner([ok()]);
    const code = await main(
      [
        'stage',
        'device',
        '--src',
        '/elsewhere',
        '--dest',
        '/opt/podkit',
        '--exclude',
        'first',
        '--exclude',
        'second',
        '--sudo',
      ],
      { subprocess: runner }
    );
    expect(code).toBe(0);
    const body = calls[0]!.args[5]!;
    expect(body).toContain("'/elsewhere/'");
    expect(body).toContain("--exclude 'first'");
    expect(body).toContain("--exclude 'second'");
    expect(body).toContain('sudo rsync');
  });

  it('refuses to guess a destination', async () => {
    const { runner, calls } = makeScriptedRunner([]);
    const code = await main(['stage', 'device'], { subprocess: runner });
    expect(code).toBe(1);
    expect(stderrText()).toContain('--dest');
    expect(calls).toHaveLength(0);
  });

  it('rejects an unrecognised argument rather than silently ignoring it', async () => {
    const { runner, calls } = makeScriptedRunner([]);
    const code = await main(['stage', 'device', '--dest', '/tmp/w', '--exclud', 'typo'], {
      subprocess: runner,
    });
    expect(code).toBe(1);
    expect(stderrText()).toContain("unrecognised argument '--exclud'");
    expect(calls).toHaveLength(0);
  });

  it('reports a failed rsync as an operator message, not a stack trace', async () => {
    const { runner } = makeScriptedRunner([fail('rsync: connection unexpectedly closed', 12)]);
    const code = await main(['stage', 'device', '--dest', '/tmp/work'], { subprocess: runner });
    expect(code).toBe(1);
    expect(stderrText()).toContain('failed to stage source tree');
  });
});

describe('stage-path', () => {
  it('prints the destination of a declared area and nothing else', async () => {
    const { runner, calls } = makeScriptedRunner([]);
    const code = await main(['stage-path', 'builderGlibc', '--area', 'glibcBinary'], {
      subprocess: runner,
    });
    expect(code).toBe(0);
    // Shell wrappers capture this into a variable, so it must be the bare path.
    expect(stdoutText()).toBe('/tmp/podkit-builder-src\n');
    // Resolving a path must not touch a VM.
    expect(calls).toHaveLength(0);
  });

  it('gives the gpod-tool build a different directory from the CLI binary build', async () => {
    const { runner } = makeScriptedRunner([]);
    await main(['stage-path', 'builderGlibc', '--area', 'glibcBinary'], { subprocess: runner });
    const binaryDest = stdoutText();
    stdoutWrite.mockClear();
    await main(['stage-path', 'builderGlibc', '--area', 'glibcGpodTool'], { subprocess: runner });
    expect(stdoutText()).not.toBe(binaryDest);
  });

  it('refuses an area that belongs to a different VM', async () => {
    const { runner } = makeScriptedRunner([]);
    const code = await main(['stage-path', 'builderMusl', '--area', 'glibcBinary'], {
      subprocess: runner,
    });
    expect(code).toBe(1);
    expect(stderrText()).toContain('belongs to podkit-builder-glibc');
    expect(stdoutText()).toBe('');
  });

  it('fails loudly on an unknown area rather than printing an empty path', async () => {
    const { runner } = makeScriptedRunner([]);
    const code = await main(['stage-path', 'builderGlibc', '--area', 'nope'], {
      subprocess: runner,
    });
    expect(code).toBe(1);
    expect(stderrText()).toContain("no staging area registered for 'nope'");
    expect(stdoutText()).toBe('');
  });

  it('requires --area', async () => {
    const { runner } = makeScriptedRunner([]);
    const code = await main(['stage-path', 'builderGlibc'], { subprocess: runner });
    expect(code).toBe(1);
    expect(stderrText()).toContain('--area');
    expect(stdoutText()).toBe('');
  });

  it('rejects an unrecognised argument rather than silently ignoring it', async () => {
    const { runner } = makeScriptedRunner([]);
    const code = await main(['stage-path', 'builderGlibc', '--are', 'glibcBinary'], {
      subprocess: runner,
    });
    expect(code).toBe(1);
    expect(stderrText()).toContain("unrecognised argument '--are'");
  });
});

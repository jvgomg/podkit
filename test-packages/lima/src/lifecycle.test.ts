/**
 * Unit tests for the idempotent VM lifecycle primitives. Feed scripted
 * `limactl` outputs through the injected runner and assert the DECISIONS and
 * argv (create when missing, start when stopped, no-op when running, never
 * stop on ensure, destroy+recreate on recover). The advisory lock is real
 * (proper-lockfile) but keyed into a per-test temp dir so tests stay hermetic.
 * No real `limactl`, network, or VM.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  status,
  ensureExists,
  ensureRunning,
  stop,
  destroy,
  recover,
  STOP_TIMEOUT_MS,
  DESTROY_TIMEOUT_MS,
  WARM_START_TIMEOUT_MS,
} from './lifecycle.js';
import { getVm } from './registry.js';
import { isVmLocked } from './lock.js';
import { PROVISIONING_IDLE_TIMEOUT_MS } from './streaming-runner.js';
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

const DEF = getVm('device');
const INSTANCE = DEF.instanceName;

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

let lockDir: string;
function opts(runner: SubprocessRunner) {
  return { subprocess: runner, lock: { lockDir, staleMs: 5000 } };
}

beforeEach(() => {
  lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-lifecycle-lock-'));
});
afterEach(() => {
  fs.rmSync(lockDir, { recursive: true, force: true });
});

describe('status', () => {
  it('maps the instance status probe', async () => {
    const { runner } = makeScriptedRunner([listStatus('running')]);
    expect(await status(DEF, opts(runner))).toBe('running');
  });
});

describe('ensureExists', () => {
  it('creates the instance from its YAML when missing', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('missing'), ok()]);
    await ensureExists(DEF, opts(runner));
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args).toEqual(['list', '--json']);
    expect(calls[1]!.args).toEqual(['create', '--tty=false', '--name', INSTANCE, DEF.yamlPath]);
  });

  it('is a no-op when the instance already exists', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('stopped')]);
    await ensureExists(DEF, opts(runner));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(['list', '--json']);
  });

  it('throws with the limactl detail when create fails', async () => {
    const { runner } = makeScriptedRunner([listStatus('missing'), fail('disk full')]);
    await expect(ensureExists(DEF, opts(runner))).rejects.toThrow(/failed to create.*disk full/s);
  });
});

describe('ensureRunning', () => {
  it('is a no-op when already running', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('running')]);
    await ensureRunning(DEF, opts(runner));
    expect(calls).toHaveLength(1);
  });

  it('starts a stopped instance', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('stopped'), ok()]);
    await ensureRunning(DEF, opts(runner));
    expect(calls[1]!.args).toEqual(['start', INSTANCE]);
  });

  it('creates+starts a missing instance from YAML', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('missing'), ok()]);
    await ensureRunning(DEF, opts(runner));
    expect(calls[1]!.args).toEqual(['start', '--tty=false', `--name=${INSTANCE}`, DEF.yamlPath]);
  });

  it('bounds a warm start — the instance exists, so its duration is a boot, not a build', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('stopped'), ok()]);
    await ensureRunning(DEF, opts(runner));
    expect(calls[1]!.opts).toEqual({ timeoutMs: WARM_START_TIMEOUT_MS });
  });

  // The single most important negative assertion in this file. A cold create
  // downloads an image and runs cloud-init; no wall-clock bound is at once
  // tight enough to catch a wedge and loose enough to spare a healthy
  // provision, and killing one mid-flight leaves a half-created instance. That
  // path is bounded by LIVENESS (no output for `PROVISIONING_IDLE_TIMEOUT_MS`)
  // in the streaming runner instead. If someone "fixes" the missing bound
  // here, this fails and says why.
  it('puts NO wall-clock bound on a cold create, in either create path', async () => {
    const created = makeScriptedRunner([listStatus('missing'), ok()]);
    await ensureRunning(DEF, opts(created.runner));
    expect(created.calls[1]!.args[0]).toBe('start');
    expect(created.calls[1]!.opts).toBeUndefined();

    const existed = makeScriptedRunner([listStatus('missing'), ok()]);
    await ensureExists(DEF, opts(existed.runner));
    expect(existed.calls[1]!.args[0]).toBe('create');
    expect(existed.calls[1]!.opts).toBeUndefined();
  });
});

describe('the two bounds a warm start is subject to', () => {
  it('lets the wall clock win, so the failure names the bound the operator was told about', () => {
    // A warm start is a `start` subcommand, so the provisioning runner streams
    // it and arms BOTH its wall-clock bound and its no-output watchdog. They
    // report different things — "timed out after Nms" versus "aborted as
    // wedged, recreate it" — and only the first is true of a warm start that
    // simply took too long. Keeping the wall clock strictly tighter is what
    // makes the message match the situation; if the constants ever cross, this
    // says so.
    expect(WARM_START_TIMEOUT_MS).toBeLessThan(PROVISIONING_IDLE_TIMEOUT_MS);
  });
});

describe('advisory lock on an aborted call', () => {
  // A bound that leaks the lock would be a far worse failure than the hang it
  // replaces: every later VM start on the machine would wait out the ~30-minute
  // retry budget behind a holder that no longer exists.
  it('releases the lock when the bounded start rejects', async () => {
    const listing = makeScriptedRunner([listStatus('stopped')]);
    const timingOut: SubprocessRunner = {
      async run(command, args, runOpts) {
        if (args[0] === 'list') return listing.runner.run(command, args, runOpts);
        throw Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' });
      },
    };
    await expect(ensureRunning(DEF, opts(timingOut))).rejects.toThrow(/timed out/);
    expect(await isVmLocked(INSTANCE, { lockDir })).toBe(false);
  });

  it('lets the very next caller acquire immediately after an aborted start', async () => {
    const listing = makeScriptedRunner([listStatus('stopped')]);
    const timingOut: SubprocessRunner = {
      async run(command, args, runOpts) {
        if (args[0] === 'list') return listing.runner.run(command, args, runOpts);
        throw Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' });
      },
    };
    await expect(ensureRunning(DEF, opts(timingOut))).rejects.toThrow(/timed out/);

    // `retries: 0` fails fast with ELOCKED if the lock is still held, so this
    // succeeding is positive evidence of release rather than of patience.
    const { runner, calls } = makeScriptedRunner([listStatus('running')]);
    const started = Date.now();
    await ensureRunning(DEF, {
      subprocess: runner,
      lock: { lockDir, staleMs: 5000, retries: 0 },
    });
    expect(calls).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('stop', () => {
  it('stops a running instance', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('running'), ok()]);
    await stop(DEF, opts(runner));
    expect(calls[1]!.args).toEqual(['stop', INSTANCE]);
  });

  it('is a no-op when already stopped', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('stopped')]);
    await stop(DEF, opts(runner));
    expect(calls).toHaveLength(1);
  });

  it('bounds the stop — an unbounded one hangs silently against an in-flight boot', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('running'), ok()]);
    await stop(DEF, opts(runner));
    expect(calls[1]!.opts).toEqual({ timeoutMs: STOP_TIMEOUT_MS });
  });

  it('surfaces the bound by name when the stop exceeds it', async () => {
    const { runner } = makeScriptedRunner([listStatus('running')]);
    const timingOut: SubprocessRunner = {
      async run(command, args, runOpts) {
        if (args[0] === 'list') return runner.run(command, args, runOpts);
        // The shape `execFile` produces when its `timeout` fires.
        throw Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' });
      },
    };
    await expect(stop(DEF, opts(timingOut))).rejects.toThrow(
      new RegExp(`limactl stop ${INSTANCE} timed out after ${STOP_TIMEOUT_MS}ms`)
    );
  });
});

describe('destroy', () => {
  it('deletes an existing instance with --force', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('running'), ok()]);
    await destroy(DEF, opts(runner));
    expect(calls[1]!.args).toEqual(['delete', '--force', INSTANCE]);
  });

  it('is a no-op when the instance is missing', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('missing')]);
    await destroy(DEF, opts(runner));
    expect(calls).toHaveLength(1);
  });

  it('bounds the delete below the stop bound — `--force` awaits no guest shutdown', async () => {
    const { runner, calls } = makeScriptedRunner([listStatus('running'), ok()]);
    await destroy(DEF, opts(runner));
    expect(calls[1]!.opts).toEqual({ timeoutMs: DESTROY_TIMEOUT_MS });
    expect(DESTROY_TIMEOUT_MS).toBeLessThan(STOP_TIMEOUT_MS);
  });
});

describe('recover', () => {
  it('destroys, recreates+starts, then runs the provision and reseal hooks', async () => {
    // destroy: list(running) + delete; ensureRunning: list(missing) + start(create).
    const { runner, calls } = makeScriptedRunner([
      listStatus('running'),
      ok(),
      listStatus('missing'),
      ok(),
    ]);
    const provisioned: string[] = [];
    const resealed: string[] = [];
    await recover(DEF, {
      ...opts(runner),
      provision: async (def) => {
        provisioned.push(def.instanceName);
      },
      reseal: async (def) => {
        resealed.push(def.instanceName);
      },
    });

    expect(calls[1]!.args).toEqual(['delete', '--force', INSTANCE]);
    expect(calls[3]!.args).toEqual(['start', '--tty=false', `--name=${INSTANCE}`, DEF.yamlPath]);
    expect(provisioned).toEqual([INSTANCE]);
    expect(resealed).toEqual([INSTANCE]);
  });
});

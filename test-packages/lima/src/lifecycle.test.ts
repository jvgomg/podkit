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

import { status, ensureExists, ensureRunning, stop, destroy, recover } from './lifecycle.js';
import { getVm } from './registry.js';
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

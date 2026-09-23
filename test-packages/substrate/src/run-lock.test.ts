import { describe, it, expect } from 'bun:test';

import { acquireRunLock } from './run-lock.js';
import { getVm } from './registry.js';
import type { SubstrateExecResult, SubstrateLink } from './link.js';

/** A link whose guest either answers or is unreachable. */
function fakeLink(opts: { reachable?: boolean; held?: string } = {}): SubstrateLink {
  const state = { holder: opts.held ?? (null as string | null) };
  return {
    substrateId: 'deviceRemote',
    description: 'ssh_config alias `podkit-substrate`',
    async exec(command): Promise<SubstrateExecResult> {
      if (opts.reachable === false)
        throw new Error('ssh: connect to host port 22: No route to host');
      const script = Array.isArray(command) ? command[command.length - 1]! : String(command);
      if (script.includes('mkdir')) {
        if (state.holder === null) {
          state.holder = 'host=kestrel\nuser=james\npid=7\nstartedAt=then\ntoken=t';
          return { stdout: 'ACQUIRED\n', stderr: '', exitCode: 0 };
        }
        return { stdout: `HELD\n${state.holder}\n`, stderr: '', exitCode: 0 };
      }
      if (script.startsWith('if grep')) {
        state.holder = null;
        return { stdout: 'RELEASED\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    copyIn: async () => {},
    copyOut: async () => {},
    stageTree: async () => {},
    spawn: () => {
      throw new Error('not used');
    },
  };
}

describe('acquireRunLock', () => {
  it('needs no lock for a Lima substrate — the host lock already covers it', async () => {
    expect((await acquireRunLock(getVm('device'))).kind).toBe('not-required');
  });

  it('needs no lock when nothing names a substrate', async () => {
    expect((await acquireRunLock(null)).kind).toBe('not-required');
  });

  it('holds an ssh substrate for the run and releases it afterwards', async () => {
    const link = fakeLink();
    const outcome = await acquireRunLock(getVm('deviceRemote'), { linkFor: () => link });
    expect(outcome.kind).toBe('held');
    if (outcome.kind !== 'held') throw new Error('unreachable');
    await outcome.release();

    // Released, so a second run can take it.
    expect((await acquireRunLock(getVm('deviceRemote'), { linkFor: () => link })).kind).toBe(
      'held'
    );
  });

  it('refuses the run when another holds the lock, naming the holder', async () => {
    const outcome = await acquireRunLock(getVm('deviceRemote'), {
      linkFor: () => fakeLink({ held: 'host=other\nuser=sam\npid=9\nstartedAt=then\ntoken=x' }),
      timeoutMs: 0,
    });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('unreachable');
    expect(outcome.reason).toContain('sam@other');
  });

  it('refuses the run rather than running unlocked when the substrate is unreachable', async () => {
    const outcome = await acquireRunLock(getVm('deviceRemote'), {
      linkFor: () => fakeLink({ reachable: false }),
      timeoutMs: 0,
    });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('unreachable');
    // The point of refusing: an unlocked run looks like a locked one until two
    // of them interleave.
    expect(outcome.reason).toContain('vm:up deviceRemote');
    expect(outcome.reason).toContain('unlocked');
  });
});

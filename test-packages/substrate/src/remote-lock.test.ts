import { describe, it, expect } from 'bun:test';

import {
  acquireRemoteLock,
  describeRemoteLockHolder,
  forceReleaseRemoteLock,
  parseRemoteLockHolder,
  readRemoteLockHolder,
  RemoteLockBusyError,
  REMOTE_LOCK_PATH,
  withRemoteLock,
} from './remote-lock.js';
import type { SubstrateExecResult, SubstrateLink } from './link.js';

/**
 * A link backed by an in-memory `/run/lock` so `mkdir` really is exclusive —
 * the whole claim being tested is that two callers cannot both take it.
 */
function fakeSubstrate(initialHolder?: string) {
  const state: { holder: string | null } = { holder: initialHolder ?? null };
  const commands: string[] = [];

  const link: SubstrateLink = {
    substrateId: 'deviceRemote',
    description: 'ssh_config alias `podkit-substrate`',
    async exec(command): Promise<SubstrateExecResult> {
      const script = Array.isArray(command) ? command[command.length - 1]! : String(command);
      commands.push(script);

      if (script.includes('mkdir')) {
        if (state.holder === null) {
          const match = /printf '%s\\n' '((?:[^']|'\\'')*)'/.exec(script);
          state.holder = (match?.[1] ?? '').replaceAll("'\\''", "'");
          return { stdout: 'ACQUIRED\n', stderr: '', exitCode: 0 };
        }
        return { stdout: `HELD\n${state.holder}\n`, stderr: '', exitCode: 0 };
      }
      if (script.startsWith('if grep')) {
        const match = /grep -qxF 'token=([^']+)'/.exec(script);
        if (state.holder?.includes(`token=${match?.[1]}`)) {
          state.holder = null;
          return { stdout: 'RELEASED\n', stderr: '', exitCode: 0 };
        }
        return { stdout: 'NOTOURS\n', stderr: '', exitCode: 0 };
      }
      if (script.startsWith('rm -rf')) {
        state.holder = null;
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return { stdout: state.holder ?? '', stderr: '', exitCode: 0 };
    },
    copyIn: async () => {},
    copyOut: async () => {},
    stageTree: async () => {},
    spawn: () => {
      throw new Error('not used');
    },
  };
  return { link, state, commands };
}

const HOLDER = { host: 'kestrel', user: 'james', pid: 4242, startedAt: '2026-09-23T10:00:00.000Z' };

describe('parseRemoteLockHolder', () => {
  it('round-trips a record and survives a truncated one', () => {
    const parsed = parseRemoteLockHolder(
      'host=kestrel\nuser=james\npid=4242\nstartedAt=2026-09-23T10:00:00.000Z\ntoken=abc'
    );
    expect(parsed).toEqual({ ...HOLDER, token: 'abc' });
    // A write cut short mid-record still identifies the machine.
    expect(parseRemoteLockHolder('host=kestrel\nuser=ja')?.host).toBe('kestrel');
    expect(parseRemoteLockHolder('')).toBeNull();
  });
});

describe('acquireRemoteLock', () => {
  it('takes the lock in the substrate and records who holds it', async () => {
    const { link, state, commands } = fakeSubstrate();
    const release = await acquireRemoteLock(link, { holder: HOLDER, makeToken: () => 'tok' });

    expect(commands[0]).toContain(REMOTE_LOCK_PATH);
    expect(parseRemoteLockHolder(state.holder!)).toEqual({ ...HOLDER, token: 'tok' });

    await release();
    expect(state.holder).toBeNull();
  });

  it('is exclusive: a second caller cannot take a held lock', async () => {
    const { link } = fakeSubstrate();
    await acquireRemoteLock(link, { holder: HOLDER, makeToken: () => 'first' });

    await expect(
      acquireRemoteLock(link, {
        holder: { ...HOLDER, host: 'other' },
        makeToken: () => 'second',
        timeoutMs: 0,
      })
    ).rejects.toThrow(RemoteLockBusyError);
  });

  it('names the holder host, user, pid and start time when it gives up', async () => {
    const { link } = fakeSubstrate();
    await acquireRemoteLock(link, { holder: HOLDER, makeToken: () => 'first' });

    const err = await acquireRemoteLock(link, { timeoutMs: 0 }).then(
      () => null,
      (e: unknown) => e as RemoteLockBusyError
    );
    expect(err).toBeInstanceOf(RemoteLockBusyError);
    expect(err!.message).toContain('james@kestrel');
    expect(err!.message).toContain('pid 4242');
    expect(err!.message).toContain('2026-09-23T10:00:00.000Z');
    // Waiting forever would be indistinguishable from a hang, so the way out
    // has to be in the message.
    expect(err!.message).toContain('--force');
    expect(err!.holder?.host).toBe('kestrel');
  });

  it('waits and succeeds when the holder releases inside the window', async () => {
    const { link, state } = fakeSubstrate();
    const first = await acquireRemoteLock(link, { holder: HOLDER, makeToken: () => 'first' });

    let clock = 0;
    const second = acquireRemoteLock(link, {
      holder: { ...HOLDER, host: 'other' },
      makeToken: () => 'second',
      timeoutMs: 10_000,
      now: () => clock,
      sleep: async () => {
        clock += 1_000;
        if (clock === 2_000) await first();
      },
    });
    await second;
    expect(parseRemoteLockHolder(state.holder!)?.token).toBe('second');
  });

  it('gives up after the bounded wait rather than blocking', async () => {
    const { link } = fakeSubstrate();
    await acquireRemoteLock(link, { holder: HOLDER, makeToken: () => 'first' });

    let clock = 0;
    let polls = 0;
    await expect(
      acquireRemoteLock(link, {
        timeoutMs: 10_000,
        now: () => clock,
        sleep: async () => {
          polls++;
          clock += 2_000;
        },
      })
    ).rejects.toThrow(RemoteLockBusyError);
    expect(polls).toBe(5);
  });

  it('will not release a lock that has since been taken by someone else', async () => {
    const { link, state } = fakeSubstrate();
    const release = await acquireRemoteLock(link, { holder: HOLDER, makeToken: () => 'mine' });

    await forceReleaseRemoteLock(link);
    await acquireRemoteLock(link, {
      holder: { ...HOLDER, host: 'other' },
      makeToken: () => 'theirs',
    });

    await release();
    expect(parseRemoteLockHolder(state.holder!)?.token).toBe('theirs');
  });
});

describe('forceReleaseRemoteLock', () => {
  it('breaks the lock and reports whom it displaced', async () => {
    const { link, state } = fakeSubstrate();
    await acquireRemoteLock(link, { holder: HOLDER, makeToken: () => 'stale' });

    const displaced = await forceReleaseRemoteLock(link);
    expect(displaced?.host).toBe('kestrel');
    expect(state.holder).toBeNull();
  });

  it('is a no-op on a free lock', async () => {
    const { link } = fakeSubstrate();
    expect(await forceReleaseRemoteLock(link)).toBeNull();
    expect(await readRemoteLockHolder(link)).toBeNull();
  });
});

describe('withRemoteLock', () => {
  it('releases even when the body throws', async () => {
    const { link, state } = fakeSubstrate();
    await expect(
      withRemoteLock(
        link,
        async () => {
          throw new Error('boom');
        },
        { holder: HOLDER, makeToken: () => 'tok' }
      )
    ).rejects.toThrow('boom');
    expect(state.holder).toBeNull();
  });
});

describe('describeRemoteLockHolder', () => {
  it('says so rather than printing blanks when the record is gone', () => {
    expect(describeRemoteLockHolder(null)).toContain('unidentified');
  });
});

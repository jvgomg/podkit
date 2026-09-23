/**
 * The ssh-substrate branch of `podkit-vm`: what each verb does with a token,
 * what it does without one, and which of them still work over the link alone.
 */

import { describe, it, expect } from 'bun:test';

import { runSshSubstrateVerb, templateHashVerdict } from './cli-ssh.js';
import {
  getVm,
  POST_PROVISION_SNAPSHOT,
  type SshVmDefinition,
  type SubstrateLink,
} from '@podkit/substrate';

const REMOTE = getVm('deviceRemote') as SshVmDefinition;

const TOKEN_ENV = {
  PODKIT_PVE_API_URL: 'https://pve.example:8006',
  PODKIT_PVE_TOKEN_ID: 'podkit@pve!automation',
  PODKIT_PVE_TOKEN_SECRET: 's3cr3t',
  PODKIT_PVE_VMID_DEVICE_REMOTE: '9000',
} as const;

function captureIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: () => out.join('\n'),
    stderr: () => err.join('\n'),
    io: {
      log: (m: string) => void out.push(m),
      errorLog: (m: string) => void err.push(m),
      confirm: async () => true,
      interactive: false,
    },
  };
}

/** A link whose guest answers scripted output per command substring. */
function fakeLink(responses: Record<string, string> = {}, reachable = true): SubstrateLink {
  return {
    substrateId: REMOTE.id,
    description: 'ssh_config alias `podkit-substrate`',
    async exec(command) {
      if (!reachable) throw new Error('link down');
      const script = Array.isArray(command) ? command.join(' ') : String(command);
      for (const [needle, stdout] of Object.entries(responses)) {
        if (script.includes(needle)) return { stdout, stderr: '', exitCode: 0 };
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

const POOL = {
  members: [{ vmid: 9000, name: 'podkit-substrate', node: 'rae', status: 'stopped', type: 'qemu' }],
};

/** A `fetch` answering a route table, as in the client's own tests. */
function scriptedFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace('/api2/json', '');
    calls.push(`${method} ${path}`);
    const key = `${method} ${path}`;
    if (!(key in routes)) return new Response('{"data":null}', { status: 501, statusText: key });
    return new Response(JSON.stringify({ data: routes[key] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const TASK_OK = {
  'GET /nodes/rae/tasks/UPID%3Arae%3A1/status': { status: 'stopped', exitstatus: 'OK' },
};

describe('with no token configured', () => {
  it('answers status from the link, because a reply is evidence of running', async () => {
    const cap = captureIo();
    const code = await runSshSubstrateVerb('status', REMOTE, [], {
      io: cap.io,
      env: {},
      linkFor: () => fakeLink(),
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('running');
  });

  it('says unreachable rather than guessing when the link is down', async () => {
    const cap = captureIo();
    await runSshSubstrateVerb('status', REMOTE, [], {
      io: cap.io,
      env: {},
      linkFor: () => fakeLink({}, false),
    });
    expect(cap.stdout()).toBe('unreachable');
  });

  it('lets install proceed over the link with no hypervisor involved', async () => {
    const cap = captureIo();
    const code = await runSshSubstrateVerb('install', REMOTE, [], {
      io: cap.io,
      env: {},
      linkFor: () => fakeLink(),
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('reachable');
  });

  it('prints the qm equivalent for a verb that needs the hypervisor', async () => {
    for (const [verb, expected] of [
      ['ensure', 'qm start <vmid>'],
      ['stop', 'qm shutdown <vmid>'],
      ['destroy', 'qm destroy <vmid>'],
    ] as const) {
      const cap = captureIo();
      const code = await runSshSubstrateVerb(verb, REMOTE, [], {
        io: cap.io,
        env: {},
        linkFor: () => fakeLink(),
      });
      // Non-zero because the state was not reached — a wrapper must not carry
      // on and test a stopped guest.
      expect(code).toBe(1);
      expect(cap.stderr()).toContain(expected);
    }
  });

  it('substitutes a known VMID into the printed command', async () => {
    const cap = captureIo();
    await runSshSubstrateVerb('ensure', REMOTE, [], {
      io: cap.io,
      env: { PODKIT_PVE_VMID_DEVICE_REMOTE: '9000' },
      linkFor: () => fakeLink(),
    });
    expect(cap.stderr()).toContain('qm start 9000');
  });
});

describe('with a malformed token configuration', () => {
  it('reports the bad value rather than throwing out of a config reader', async () => {
    const cap = captureIo();
    const code = await runSshSubstrateVerb('ensure', REMOTE, [], {
      io: cap.io,
      env: { ...TOKEN_ENV, PODKIT_PVE_API_URL: 'pve.example' },
      linkFor: () => fakeLink(),
    });
    expect(code).toBe(1);
    expect(cap.stderr()).toContain('is not a URL');
  });
});

describe('with a token configured', () => {
  it('starts a stopped guest', async () => {
    const cap = captureIo();
    const { fetchFn, calls } = scriptedFetch({
      'GET /pools/podkit': POOL,
      'POST /nodes/rae/qemu/9000/status/start': 'UPID:rae:1',
      ...TASK_OK,
    });
    const code = await runSshSubstrateVerb('ensure', REMOTE, [], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink(),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(0);
    expect(calls).toContain('POST /nodes/rae/qemu/9000/status/start');
  });

  it('refuses a non-interactive destroy without --yes', async () => {
    const cap = captureIo();
    const { fetchFn, calls } = scriptedFetch({ 'GET /pools/podkit': POOL });
    const code = await runSshSubstrateVerb('destroy', REMOTE, [], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink(),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(1);
    expect(cap.stderr()).toContain('Pass --yes');
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false);
  });

  it('seals the provisioning snapshot under one fixed name', async () => {
    const cap = captureIo();
    const { fetchFn, calls } = scriptedFetch({
      'GET /pools/podkit': POOL,
      'GET /nodes/rae/qemu/9000/snapshot': [],
      'POST /nodes/rae/qemu/9000/snapshot': 'UPID:rae:1',
      ...TASK_OK,
    });
    const code = await runSshSubstrateVerb('snapshot', REMOTE, [], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink(),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(0);
    expect(calls).toContain('POST /nodes/rae/qemu/9000/snapshot');
    expect(cap.stdout()).toContain(POST_PROVISION_SNAPSHOT);
  });

  it('rolls back when the sealed hash matches what the caller expects', async () => {
    const cap = captureIo();
    const { fetchFn, calls } = scriptedFetch({
      'GET /pools/podkit': POOL,
      'GET /nodes/rae/qemu/9000/snapshot': [
        { name: POST_PROVISION_SNAPSHOT, description: '', snaptime: 1 },
      ],
      [`POST /nodes/rae/qemu/9000/snapshot/${POST_PROVISION_SNAPSHOT}/rollback`]: 'UPID:rae:1',
      'POST /nodes/rae/qemu/9000/status/start': 'UPID:rae:1',
      'GET /nodes/rae/qemu/9000/agent/network-get-interfaces': { result: [] },
      ...TASK_OK,
    });
    const code = await runSshSubstrateVerb('recover', REMOTE, ['--expect-hash', 'abc123'], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink({ 'baseline-hash': 'abc123\n' }),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(0);
    expect(calls).toContain(
      `POST /nodes/rae/qemu/9000/snapshot/${POST_PROVISION_SNAPSHOT}/rollback`
    );
    expect(cap.stdout()).toContain('rollback');
  });

  it('recreates instead when the sealed hash no longer matches', async () => {
    const cap = captureIo();
    const { fetchFn, calls } = scriptedFetch({
      'GET /pools/podkit': POOL,
      'GET /nodes/rae/qemu/9000/snapshot': [
        { name: POST_PROVISION_SNAPSHOT, description: '', snaptime: 1 },
      ],
      'DELETE /nodes/rae/qemu/9000': 'UPID:rae:1',
      'GET /nodes': [{ node: 'rae' }],
      'POST /nodes/rae/qemu': 'UPID:rae:1',
      'PUT /nodes/rae/qemu/9000/config': 'UPID:rae:1',
      'PUT /nodes/rae/qemu/9000/resize': 'UPID:rae:1',
      'POST /nodes/rae/qemu/9000/status/start': 'UPID:rae:1',
      'GET /nodes/rae/qemu/9000/agent/network-get-interfaces': {
        result: [{ 'ip-addresses': [{ 'ip-address': '192.168.10.213' }] }],
      },
      ...TASK_OK,
    });
    const code = await runSshSubstrateVerb('recover', REMOTE, ['--expect-hash', 'newhash'], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink({ 'baseline-hash': 'oldhash\n' }),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(0);
    expect(calls).toContain('DELETE /nodes/rae/qemu/9000');
    expect(calls.some((c) => c.startsWith('POST /nodes/rae/qemu/9000/snapshot/'))).toBe(false);
    // Recreate regenerates host keys, and the token cannot read the new one.
    expect(cap.stdout()).toContain('NEW ssh host keys');
    expect(cap.stdout()).toContain('192.168.10.213');
  });
});

describe('unlock', () => {
  const HOLDER = 'host=kestrel\nuser=james\npid=4242\nstartedAt=2026-09-23T10:00:00.000Z\ntoken=t';

  it('reports a free lock and does nothing', async () => {
    const cap = captureIo();
    const code = await runSshSubstrateVerb('unlock', REMOTE, [], {
      io: cap.io,
      env: {},
      linkFor: () => fakeLink(),
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('not locked');
  });

  it('names the holder and refuses to break it without --force', async () => {
    const cap = captureIo();
    const code = await runSshSubstrateVerb('unlock', REMOTE, [], {
      io: cap.io,
      env: {},
      linkFor: () => fakeLink({ 'podkit-substrate.lock': HOLDER }),
    });
    expect(code).toBe(1);
    expect(cap.stderr()).toContain('james@kestrel');
    expect(cap.stderr()).toContain('pid 4242');
  });

  it('breaks the lock with --force, saying whom it displaced', async () => {
    const cap = captureIo();
    const code = await runSshSubstrateVerb('unlock', REMOTE, ['--force'], {
      io: cap.io,
      env: {},
      linkFor: () => fakeLink({ 'podkit-substrate.lock': HOLDER }),
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('james@kestrel');
  });
});

describe('templateHashVerdict', () => {
  it('is unknown unless both sides are present', () => {
    expect(templateHashVerdict('', 'abc')).toBe('unknown');
    expect(templateHashVerdict('abc', undefined)).toBe('unknown');
    expect(templateHashVerdict('abc', 'abc')).toBe('match');
    expect(templateHashVerdict('abc', 'def')).toBe('drifted');
  });
});

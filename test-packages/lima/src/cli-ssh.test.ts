/**
 * The ssh-substrate branch of `podkit-vm`: what each verb does with a token,
 * what it does without one, and which of them still work over the link alone.
 */

import { describe, it, expect } from 'bun:test';

import { runSshSubstrateVerb, templateHashVerdict } from './cli-ssh.js';
import {
  getVm,
  POST_PROVISION_SNAPSHOT,
  SubstrateLinkError,
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
function fakeLink(
  responses: Record<string, string> = {},
  reachable = true,
  onExec?: (script: string) => void
): SubstrateLink {
  return {
    substrateId: REMOTE.id,
    description: 'ssh_config alias `podkit-substrate`',
    async exec(command) {
      const script = Array.isArray(command) ? command.join(' ') : String(command);
      onExec?.(script);
      if (!reachable) throw staleHostKey();
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

/** What a recreated guest looks like over a link whose known_hosts is stale. */
function staleHostKey(): SubstrateLinkError {
  return new SubstrateLinkError({
    substrateId: REMOTE.id,
    operation: 'exec',
    message: 'link down',
    detail: 'Host key verification failed.',
  });
}

/** Reachable enough to read the sealed hash, dead by the time it is probed. */
function linkThatRefusesTheProbe(sealed: string): SubstrateLink {
  const base = fakeLink({ 'baseline-hash': `${sealed}\n` });
  return {
    ...base,
    async exec(command, execOpts) {
      const script = Array.isArray(command) ? command.join(' ') : String(command);
      if (script === 'true') throw staleHostKey();
      return base.exec(command, execOpts);
    },
  };
}

/**
 * The pool listing, which is where guest status comes from.
 *
 * Parameterised because `recover` now branches on it: a stopped guest cannot be
 * asked for its sealed hash, and a fixture frozen at one status would hide the
 * difference this file exists to pin.
 */
function poolAt(status: 'running' | 'stopped') {
  return {
    members: [{ vmid: 9000, name: 'podkit-substrate', node: 'rae', status, type: 'qemu' }],
  };
}

const POOL = poolAt('stopped');

/** The API routes a recovery touches, whichever branch it takes. */
function recoverRoutes(status: 'running' | 'stopped', snapshots: unknown[]) {
  return {
    'GET /pools/podkit': poolAt(status),
    'GET /nodes/rae/qemu/9000/snapshot': snapshots,
    [`POST /nodes/rae/qemu/9000/snapshot/${POST_PROVISION_SNAPSHOT}/rollback`]: 'UPID:rae:1',
    'POST /nodes/rae/qemu/9000/status/stop': 'UPID:rae:1',
    'POST /nodes/rae/qemu/9000/status/start': 'UPID:rae:1',
    'GET /nodes/rae/qemu/9000/agent/network-get-interfaces': { result: [] },
    ...TASK_OK,
  };
}

const SEALED_SNAPSHOT = [{ name: POST_PROVISION_SNAPSHOT, description: '', snaptime: 1 }];

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
  it('starts a stopped guest and reports it running', async () => {
    const cap = captureIo();
    // The pool listing is the status source, so it has to move when the guest
    // does: `ensure` returns only once the guest reports `running`, and a
    // fixture frozen at `stopped` would describe a box that never came up.
    const pool = {
      members: [
        { vmid: 9000, name: 'podkit-substrate', node: 'rae', status: 'stopped', type: 'qemu' },
      ],
    };
    const { fetchFn, calls } = scriptedFetch({
      'GET /pools/podkit': pool,
      'POST /nodes/rae/qemu/9000/status/start': 'UPID:rae:1',
      ...TASK_OK,
    });
    const startingFetch = (async (input: unknown, init?: RequestInit) => {
      const response = await (fetchFn as (i: unknown, x?: RequestInit) => Promise<Response>)(
        input,
        init
      );
      if (String(input).includes('/status/start')) pool.members[0]!.status = 'running';
      return response;
    }) as unknown as typeof fetch;

    const code = await runSshSubstrateVerb('ensure', REMOTE, [], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink(),
      client: { fetchFn: startingFetch, sleep: async () => {} },
    });
    expect(code).toBe(0);
    expect(calls).toContain('POST /nodes/rae/qemu/9000/status/start');
    expect(cap.stdout()).toContain('is running');
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
    const { fetchFn, calls } = scriptedFetch(recoverRoutes('running', SEALED_SNAPSHOT));
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
    expect(cap.stdout()).toContain('matches the committed provisioning inputs');
  });

  it('waits for the restarted guest to answer before calling the recovery done', async () => {
    const cap = captureIo();
    const probes: string[] = [];
    const { fetchFn } = scriptedFetch(recoverRoutes('running', SEALED_SNAPSHOT));
    const code = await runSshSubstrateVerb('recover', REMOTE, ['--expect-hash', 'abc123'], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink({ 'baseline-hash': 'abc123\n' }, true, (s) => void probes.push(s)),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(0);
    // The sealed-hash read, then a second reach for the link after the
    // restart. What that probe says is `link-ready.ts`'s business, not this
    // file's; that it happened at all is the contract here.
    expect(probes).toHaveLength(2);
    expect(probes[0]).toContain('baseline-hash');
    expect(probes[1]).not.toContain('baseline-hash');
  });

  it('will not report a rollback that never came back as a success', async () => {
    // A rollback preserves the guest's host keys, so a box that does not
    // answer afterwards is genuinely broken — no manual step finishes this.
    const cap = captureIo();
    const { fetchFn } = scriptedFetch(recoverRoutes('running', SEALED_SNAPSHOT));
    const code = await runSshSubstrateVerb('recover', REMOTE, ['--expect-hash', 'abc123'], {
      io: cap.io,
      env: TOKEN_ENV,
      // Answers the sealed-hash read, then refuses the readiness probe with a
      // diagnostic waiting cannot fix — so the wait ends on the first probe
      // rather than at its bound.
      linkFor: () => linkThatRefusesTheProbe('abc123'),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(1);
    expect(cap.stderr()).toContain('Host key verification failed');
    expect(cap.stderr()).toContain('ssh_config alias `podkit-substrate`');
    expect(cap.stdout()).not.toContain('NEW ssh host keys');
  });

  it('recreates instead when the sealed hash no longer matches', async () => {
    const cap = captureIo();
    const { fetchFn, calls } = scriptedFetch({
      'GET /pools/podkit': poolAt('running'),
      'GET /nodes/rae/qemu/9000/snapshot': SEALED_SNAPSHOT,
      'POST /nodes/rae/qemu/9000/status/stop': 'UPID:rae:1',
      'DELETE /nodes/rae/qemu/9000': 'UPID:rae:1',
      'GET /nodes': [{ node: 'rae' }],
      'POST /nodes/rae/qemu': 'UPID:rae:1',
      'PUT /nodes/rae/qemu/9000/config': 'UPID:rae:1',
      'PUT /nodes/rae/qemu/9000/resize': 'UPID:rae:1',
      'POST /nodes/rae/qemu/9000/status/start': 'UPID:rae:1',
      'GET /nodes/rae/qemu/9000/agent/network-get-interfaces': {
        result: [{ 'ip-addresses': [{ 'ip-address': '192.0.2.10' }] }],
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
    expect(cap.stdout()).toContain('192.0.2.10');
  });

  it('treats a recreate refused on its new host keys as the documented outcome', async () => {
    // The recreate worked. `known_hosts` going stale is what a recreate DOES,
    // and the guidance below is the manual step that finishes it — so this
    // stays a zero exit, as it was before there was a wait at all, and the
    // guidance must survive the failed wait rather than being swallowed by it.
    const cap = captureIo();
    const { fetchFn } = scriptedFetch({
      'GET /pools/podkit': POOL,
      'GET /nodes/rae/qemu/9000/snapshot': [],
      'DELETE /nodes/rae/qemu/9000': 'UPID:rae:1',
      'GET /nodes': [{ node: 'rae' }],
      'POST /nodes/rae/qemu': 'UPID:rae:1',
      'PUT /nodes/rae/qemu/9000/config': 'UPID:rae:1',
      'PUT /nodes/rae/qemu/9000/resize': 'UPID:rae:1',
      'POST /nodes/rae/qemu/9000/status/start': 'UPID:rae:1',
      'GET /nodes/rae/qemu/9000/agent/network-get-interfaces': {
        result: [{ 'ip-addresses': [{ 'ip-address': '192.0.2.10' }] }],
      },
      ...TASK_OK,
    });
    const code = await runSshSubstrateVerb('recover', REMOTE, [], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink({}, false),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('NEW ssh host keys');
    expect(cap.stdout()).toContain('192.0.2.10');
    expect(cap.stderr()).toContain('Host key verification failed');
  });
});

describe('recover, when the guest cannot be asked what it was sealed with', () => {
  // The destructive branch answers to evidence. Every case here has none, so
  // none of them may delete a guest that still has a snapshot to roll back to.

  it('rolls a STOPPED guest back rather than destroying it', async () => {
    const cap = captureIo();
    const probes: string[] = [];
    const { fetchFn, calls } = scriptedFetch(recoverRoutes('stopped', SEALED_SNAPSHOT));
    const code = await runSshSubstrateVerb('recover', REMOTE, ['--expect-hash', 'abc123'], {
      io: cap.io,
      env: TOKEN_ENV,
      // Deliberately a link that WOULD answer with a matching hash: the guest
      // being stopped is what has to settle the verdict, so nothing may consult
      // this.
      linkFor: () => fakeLink({ 'baseline-hash': 'abc123\n' }, true, (x) => void probes.push(x)),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(0);
    expect(calls).toContain(
      `POST /nodes/rae/qemu/9000/snapshot/${POST_PROVISION_SNAPSHOT}/rollback`
    );
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false);
    expect(probes.some((x) => x.includes('baseline-hash'))).toBe(false);
  });

  it('says the guest was stopped rather than reporting a bare unknown verdict', async () => {
    const cap = captureIo();
    const { fetchFn } = scriptedFetch(recoverRoutes('stopped', SEALED_SNAPSHOT));
    await runSshSubstrateVerb('recover', REMOTE, ['--expect-hash', 'abc123'], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink({ 'baseline-hash': 'abc123\n' }),
      client: { fetchFn, sleep: async () => {} },
    });
    const said = `${cap.stdout()}\n${cap.stderr()}`;
    expect(said).toContain('is stopped');
    expect(said).toContain('sealed hash could not be read');
  });

  it('rolls back when the link is down, quoting what ssh said', async () => {
    // A running guest with a wedged sshd is what `vm:recover` is FOR, and it
    // reads as unreadable too. Rolling back is the cheap repair.
    const cap = captureIo();
    const { fetchFn, calls } = scriptedFetch(recoverRoutes('running', SEALED_SNAPSHOT));
    const code = await runSshSubstrateVerb('recover', REMOTE, ['--expect-hash', 'abc123'], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink({}, false),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(1); // the readiness wait fails on the same dead link
    expect(calls).toContain(
      `POST /nodes/rae/qemu/9000/snapshot/${POST_PROVISION_SNAPSHOT}/rollback`
    );
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false);
    expect(cap.stderr()).toContain('Host key verification failed');
  });

  it('rolls back when no expected hash was supplied, and names that as the gap', async () => {
    const cap = captureIo();
    const { fetchFn, calls } = scriptedFetch(recoverRoutes('running', SEALED_SNAPSHOT));
    const code = await runSshSubstrateVerb('recover', REMOTE, [], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink({ 'baseline-hash': 'abc123\n' }),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(0);
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false);
    expect(cap.stderr()).toContain('--expect-hash');
  });

  it('still recreates when the guest was asked and carries no seal at all', async () => {
    // Read, and empty: that is a fact about the disk, and the one thing that
    // distinguishes a guest with nothing to roll back to from one nobody asked.
    const cap = captureIo();
    const { fetchFn, calls } = scriptedFetch({
      ...recoverRoutes('running', SEALED_SNAPSHOT),
      'DELETE /nodes/rae/qemu/9000': 'UPID:rae:1',
      'GET /nodes': [{ node: 'rae' }],
      'POST /nodes/rae/qemu': 'UPID:rae:1',
      'PUT /nodes/rae/qemu/9000/config': 'UPID:rae:1',
      'PUT /nodes/rae/qemu/9000/resize': 'UPID:rae:1',
    });
    const code = await runSshSubstrateVerb('recover', REMOTE, ['--expect-hash', 'abc123'], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink({ 'baseline-hash': '\n' }),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(0);
    expect(calls).toContain('DELETE /nodes/rae/qemu/9000');
    expect(cap.stderr()).toContain('nothing is sealed');
  });

  it('recreates a stopped guest that has no snapshot, on that evidence', async () => {
    const cap = captureIo();
    const { fetchFn, calls } = scriptedFetch({
      ...recoverRoutes('stopped', []),
      'DELETE /nodes/rae/qemu/9000': 'UPID:rae:1',
      'GET /nodes': [{ node: 'rae' }],
      'POST /nodes/rae/qemu': 'UPID:rae:1',
      'PUT /nodes/rae/qemu/9000/config': 'UPID:rae:1',
      'PUT /nodes/rae/qemu/9000/resize': 'UPID:rae:1',
    });
    await runSshSubstrateVerb('recover', REMOTE, ['--expect-hash', 'abc123'], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink({}, false),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(calls).toContain('DELETE /nodes/rae/qemu/9000');
    expect(cap.stderr()).toContain(`no '${POST_PROVISION_SNAPSHOT}' snapshot`);
    // Still the destructive branch, so it still owes the reader the half of
    // the picture it could not establish.
    expect(cap.stderr()).toContain('is stopped');
  });

  it('recreates on --recreate without asking the guest anything', async () => {
    const cap = captureIo();
    const probes: string[] = [];
    const { fetchFn, calls } = scriptedFetch({
      ...recoverRoutes('running', SEALED_SNAPSHOT),
      'DELETE /nodes/rae/qemu/9000': 'UPID:rae:1',
      'GET /nodes': [{ node: 'rae' }],
      'POST /nodes/rae/qemu': 'UPID:rae:1',
      'PUT /nodes/rae/qemu/9000/config': 'UPID:rae:1',
      'PUT /nodes/rae/qemu/9000/resize': 'UPID:rae:1',
    });
    const code = await runSshSubstrateVerb('recover', REMOTE, ['--recreate'], {
      io: cap.io,
      env: TOKEN_ENV,
      linkFor: () => fakeLink({ 'baseline-hash': 'abc123\n' }, true, (x) => void probes.push(x)),
      client: { fetchFn, sleep: async () => {} },
    });
    expect(code).toBe(0);
    expect(calls).toContain('DELETE /nodes/rae/qemu/9000');
    expect(cap.stderr()).toContain('--recreate');
    // Only the post-restart readiness probe. Nothing asks a guest that is
    // about to be deleted what it was sealed with.
    expect(probes.some((x) => x.includes('baseline-hash'))).toBe(false);
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
  const read = (hash: string) => ({ read: true, hash }) as const;

  it('compares only what both sides actually supplied', () => {
    expect(templateHashVerdict(read('abc'), 'abc')).toEqual({ verdict: 'match' });
    expect(templateHashVerdict(read('abc'), 'def')).toEqual({ verdict: 'drifted' });
  });

  it('calls an empty seal absent — the guest answered, and carries no claim', () => {
    expect(templateHashVerdict(read(''), 'abc')).toEqual({ verdict: 'absent' });
  });

  it('keeps a seal that could not be read distinct from one that is not there', () => {
    const verdict = templateHashVerdict({ read: false, detail: 'Connection refused' }, 'abc');
    expect(verdict.verdict).toBe('unknown');
    expect(verdict).toHaveProperty('because', expect.stringContaining('Connection refused'));
  });

  it("reports a missing expected hash as its own gap, not as the guest's", () => {
    const verdict = templateHashVerdict(read('abc'), undefined);
    expect(verdict.verdict).toBe('unknown');
    expect(verdict).toHaveProperty('because', expect.stringContaining('--expect-hash'));
  });
});

/**
 * Everything the client does is asserted against a scripted `fetch`: request
 * path, auth header, body, task polling, and the mapping of a PVE error onto
 * an actionable one. No hypervisor is involved.
 */

import { describe, it, expect } from 'bun:test';

import {
  createPveClient,
  PveApiMissingGuest,
  PveTaskError,
  PveUnreachableError,
} from './client.js';
import { resolvePveConfig, type PveConfig } from './config.js';
import { isPveApiError } from './errors.js';

const FP = 'a'.repeat(64);

function config(overrides: Partial<Record<string, string>> = {}): PveConfig {
  const resolved = resolvePveConfig({
    PODKIT_PVE_API_URL: 'https://pve.example:8006',
    PODKIT_PVE_TOKEN_ID: 'podkit@pve!automation',
    PODKIT_PVE_TOKEN_SECRET: 's3cr3t',
    ...overrides,
  });
  if (!resolved.available) throw new Error('expected a complete config');
  return resolved.config;
}

interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A `fetch` that answers from a route table and records what it was asked. */
function scriptedFetch(routes: Record<string, unknown | (() => unknown)>) {
  const calls: Recorded[] = [];
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace('/api2/json', '');
    calls.push({
      method,
      path,
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: (init?.body as string | undefined) ?? null,
    });
    const key = `${method} ${path}`;
    if (!(key in routes)) {
      return new Response('{"data":null}', { status: 501, statusText: `unrouted ${key}` });
    }
    const entry = routes[key];
    const value = typeof entry === 'function' ? (entry as () => unknown)() : entry;
    if (value instanceof Response) return value;
    return new Response(JSON.stringify({ data: value }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const POOL_WITH_9000 = {
  members: [
    { vmid: 9000, name: 'podkit-substrate', node: 'rae', status: 'stopped', type: 'qemu' },
    { vmid: 9001, name: 'podkit-builder', node: 'rae', status: 'running', type: 'qemu' },
    { vmid: 120, name: 'a-container', node: 'rae', status: 'running', type: 'lxc' },
  ],
};

/** Route table entries every task-driven verb needs. */
const TASK_OK = {
  'GET /nodes/rae/tasks/UPID%3Arae%3A0001/status': { status: 'stopped', exitstatus: 'OK' },
};
const UPID = 'UPID:rae:0001';

function client(routes: Record<string, unknown | (() => unknown)>, cfg: PveConfig = config()) {
  const { fetchFn, calls } = scriptedFetch(routes);
  return {
    calls,
    pve: createPveClient({ config: cfg, fetchFn, sleep: async () => {} }),
  };
}

describe('authentication and transport', () => {
  it('sends the token as a PVEAPIToken header', async () => {
    const { pve, calls } = client({ 'GET /version': { version: '9.1.4' } });
    expect(await pve.version()).toBe('9.1.4');
    expect(calls[0]?.headers['Authorization']).toBe('PVEAPIToken=podkit@pve!automation=s3cr3t');
  });

  it('routes through an injected transport rather than opening a socket', async () => {
    // Pinning is a transport, not a request option — so an injected transport
    // replaces it wholesale and no probe is attempted. That is what keeps
    // every other test in this file hermetic.
    let probed = 0;
    const { fetchFn, calls } = scriptedFetch({ 'GET /version': { version: '9.1.4' } });
    const pve = createPveClient({
      config: config({ PODKIT_PVE_TLS_FINGERPRINT: FP }),
      fetchFn,
      probeCertificate: async () => {
        probed++;
        return { pem: 'PEM', fingerprint256: FP, subject: 'rae' };
      },
    });
    await pve.version();

    expect(calls).toHaveLength(1);
    expect(probed).toBe(0);
  });

  it('keeps a base path, so an API behind a reverse proxy still resolves', async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: unknown) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ data: { version: '9.1.4' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const pve = createPveClient({
      config: config({ PODKIT_PVE_API_URL: 'https://gateway.example/pve' }),
      fetchFn,
    });
    await pve.version();
    expect(calls[0]).toBe('https://gateway.example/pve/api2/json/version');
  });

  it('reports a refused connection as unreachable, not as an API error', async () => {
    const fetchFn = (async () => {
      throw new TypeError('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const pve = createPveClient({ config: config(), fetchFn });
    await expect(pve.version()).rejects.toThrow(PveUnreachableError);
  });

  it('says so when something that is not the API answers 200', async () => {
    const pve = createPveClient({
      config: config(),
      fetchFn: (async () =>
        new Response('<html>login</html>', { status: 200 })) as unknown as typeof fetch,
    });
    await expect(pve.version()).rejects.toThrow(/not JSON/);
  });
});

describe('status', () => {
  it('reads every guest, node and state from the single pool call', async () => {
    const { pve, calls } = client({ 'GET /pools/podkit': POOL_WITH_9000 });
    const members = await pve.poolMembers();

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /pools/podkit']);
    // Containers are not guests this lifecycle drives.
    expect(members.map((m) => m.vmid)).toEqual([9000, 9001]);
    expect(members[0]).toEqual({
      vmid: 9000,
      name: 'podkit-substrate',
      node: 'rae',
      status: 'stopped',
      type: 'qemu',
    });
  });

  it('reports a guest outside the pool as missing rather than erroring', async () => {
    const { pve } = client({ 'GET /pools/podkit': POOL_WITH_9000 });
    expect(await pve.guestStatus(9000)).toBe('stopped');
    expect(await pve.guestStatus(9999)).toBe('missing');
  });

  it('names the pool when a verb is aimed at a guest outside it', async () => {
    const { pve } = client({ 'GET /pools/podkit': POOL_WITH_9000 });
    await expect(pve.start(9999)).rejects.toThrow(PveApiMissingGuest);
    await expect(pve.start(9999)).rejects.toThrow(/pool 'podkit'/);
  });
});

describe('power verbs', () => {
  it('starts a guest on the node the pool reported, and waits for the task', async () => {
    const { pve, calls } = client({
      'GET /pools/podkit': POOL_WITH_9000,
      'POST /nodes/rae/qemu/9000/status/start': UPID,
      ...TASK_OK,
    });
    await pve.start(9000);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /pools/podkit',
      'POST /nodes/rae/qemu/9000/status/start',
      'GET /nodes/rae/tasks/UPID%3Arae%3A0001/status',
    ]);
  });

  it('shuts down gracefully by default and pulls power only when forced', async () => {
    const routes = {
      'GET /pools/podkit': POOL_WITH_9000,
      'POST /nodes/rae/qemu/9000/status/shutdown': UPID,
      'POST /nodes/rae/qemu/9000/status/stop': UPID,
      ...TASK_OK,
    };
    const graceful = client(routes);
    await graceful.pve.stop(9000);
    expect(graceful.calls.map((c) => c.path)).toContain('/nodes/rae/qemu/9000/status/shutdown');

    const forced = client(routes);
    await forced.pve.stop(9000, { force: true });
    expect(forced.calls.map((c) => c.path)).toContain('/nodes/rae/qemu/9000/status/stop');
  });

  it('destroys with DELETE on the guest itself', async () => {
    const { pve, calls } = client({
      'GET /pools/podkit': POOL_WITH_9000,
      'DELETE /nodes/rae/qemu/9000': UPID,
      ...TASK_OK,
    });
    await pve.destroy(9000);
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/nodes/rae/qemu/9000')).toBe(
      true
    );
  });

  it('surfaces a task that finished badly, naming the UPID', async () => {
    const { pve } = client({
      'GET /pools/podkit': POOL_WITH_9000,
      'POST /nodes/rae/qemu/9000/status/start': UPID,
      'GET /nodes/rae/tasks/UPID%3Arae%3A0001/status': {
        status: 'stopped',
        exitstatus: 'start failed: no such volume',
      },
    });
    const err = await pve.start(9000).then(
      () => null,
      (e: unknown) => e as PveTaskError
    );
    expect(err).toBeInstanceOf(PveTaskError);
    expect(err?.exitStatus).toContain('no such volume');
  });
});

describe('create', () => {
  it('issues the playbook sequence: create, config, resize', async () => {
    const { pve, calls } = client({
      'GET /nodes': [{ node: 'rae' }],
      'POST /nodes/rae/qemu': UPID,
      'PUT /nodes/rae/qemu/9000/config': UPID,
      'PUT /nodes/rae/qemu/9000/resize': UPID,
      ...TASK_OK,
    });
    await pve.createGuest({
      vmid: 9000,
      name: 'podkit-substrate',
      memoryMiB: 2048,
      cores: 2,
      diskGiB: 20,
      imagePath: '/var/lib/vz/template/iso/debian-12.qcow2',
      snippetRef: 'local:snippets/podkit-substrate.yaml',
    });

    const mutating = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
    expect(mutating).toEqual([
      'POST /nodes/rae/qemu',
      'PUT /nodes/rae/qemu/9000/config',
      'PUT /nodes/rae/qemu/9000/resize',
    ]);

    const create = new URLSearchParams(calls.find((c) => c.path === '/nodes/rae/qemu')!.body!);
    expect(create.get('pool')).toBe('podkit');
    expect(create.get('net0')).toBe('virtio,bridge=vmbr0');
    // A bun --compile binary hangs on a CPU without AVX, so the model is not
    // left at PVE's kvm64 default.
    expect(create.get('cpu')).toBe('host');
    expect(create.get('agent')).toBe('enabled=1');
    expect(create.get('serial0')).toBe('socket');

    const set = new URLSearchParams(calls.find((c) => c.path.endsWith('/config'))!.body!);
    expect(set.get('scsi0')).toBe(
      'local-lvm:0,import-from=/var/lib/vz/template/iso/debian-12.qcow2'
    );
    expect(set.get('cicustom')).toBe('user=local:snippets/podkit-substrate.yaml');
    // cicustom replaces user-data only; network-config still comes from here.
    expect(set.get('ipconfig0')).toBe('ip=dhcp');
  });

  it('refuses to guess a node when the token can see several', async () => {
    const { pve } = client({ 'GET /nodes': [{ node: 'rae' }, { node: 'corvid' }] });
    await expect(
      pve.createGuest({
        vmid: 9000,
        name: 'x',
        memoryMiB: 2048,
        cores: 2,
        diskGiB: 20,
        imagePath: '/img.qcow2',
        snippetRef: 'local:snippets/x.yaml',
      })
    ).rejects.toThrow(/cannot choose a node automatically/);
  });
});

describe('snapshots', () => {
  it('lists real snapshots and drops the synthetic current entry', async () => {
    const { pve } = client({
      'GET /pools/podkit': POOL_WITH_9000,
      'GET /nodes/rae/qemu/9000/snapshot': [
        { name: 'provisioned', description: 'post-provision', snaptime: 1700000000 },
        { name: 'current', description: 'You are here!' },
      ],
    });
    const snaps = await pve.listSnapshots(9000);
    expect(snaps.map((s) => s.name)).toEqual(['provisioned']);
    expect(snaps[0]?.snaptime).toBe(1700000000);
  });

  it('takes a disk-only snapshot', async () => {
    const { pve, calls } = client({
      'GET /pools/podkit': POOL_WITH_9000,
      'POST /nodes/rae/qemu/9000/snapshot': UPID,
      ...TASK_OK,
    });
    await pve.snapshot(9000, 'provisioned', 'contract applied');
    const body = new URLSearchParams(calls.find((c) => c.method === 'POST')!.body!);
    expect(body.get('snapname')).toBe('provisioned');
    expect(body.get('description')).toBe('contract applied');
    // vmstate would make it a suspended machine rather than a clean boot.
    expect(body.get('vmstate')).toBe('0');
  });

  it('rolls back and deletes by name', async () => {
    const { pve, calls } = client({
      'GET /pools/podkit': POOL_WITH_9000,
      'POST /nodes/rae/qemu/9000/snapshot/provisioned/rollback': UPID,
      'DELETE /nodes/rae/qemu/9000/snapshot/provisioned': UPID,
      ...TASK_OK,
    });
    await pve.rollback(9000, 'provisioned');
    await pve.deleteSnapshot(9000, 'provisioned');
    const paths = calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toContain('POST /nodes/rae/qemu/9000/snapshot/provisioned/rollback');
    expect(paths).toContain('DELETE /nodes/rae/qemu/9000/snapshot/provisioned');
  });
});

describe('guest addresses', () => {
  it('reads the agent interfaces and drops loopback', async () => {
    const { pve } = client({
      'GET /pools/podkit': POOL_WITH_9000,
      'GET /nodes/rae/qemu/9000/agent/network-get-interfaces': {
        result: [
          { name: 'lo', 'ip-addresses': [{ 'ip-address': '127.0.0.1' }, { 'ip-address': '::1' }] },
          { name: 'ens18', 'ip-addresses': [{ 'ip-address': '192.0.2.10' }] },
        ],
      },
    });
    expect(await pve.guestAddresses(9000)).toEqual(['192.0.2.10']);
  });

  it('turns an agent ACL denial into the privilege and path', async () => {
    const { pve } = client({
      'GET /pools/podkit': POOL_WITH_9000,
      'GET /nodes/rae/qemu/9000/agent/network-get-interfaces': () =>
        new Response('{"data":null}', {
          status: 403,
          statusText: 'Permission check failed (/vms/9000, VM.GuestAgent.Audit)',
        }),
    });
    const err = await pve.guestAddresses(9000).then(
      () => null,
      (e: unknown) => e
    );
    expect(isPveApiError(err)).toBe(true);
    expect((err as Error).message).toContain("lacks 'VM.GuestAgent.Audit' on '/vms/9000'");
  });
});

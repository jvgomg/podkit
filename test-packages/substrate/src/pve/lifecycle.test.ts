import { describe, it, expect } from 'bun:test';

import {
  chooseRecoveryStrategy,
  guestSpecFor,
  POST_PROVISION_SNAPSHOT,
  pveDestroy,
  pveEnsureRunning,
  pveRecover,
  pveSealSnapshot,
  pveStop,
  qmContextFor,
  resolvePveLifecycle,
  type PveBinding,
} from './lifecycle.js';
import { manualLifecycleNotice, manualQmEquivalent } from './qm.js';
import { resolvePveConfig, type PveConfig } from './config.js';
import { getVm, type SshVmDefinition } from '../registry.js';
import type { PveClient, PveGuestStatus, PveSnapshot } from './client.js';

const ENV = {
  PODKIT_PVE_API_URL: 'https://pve.example:8006',
  PODKIT_PVE_TOKEN_ID: 'podkit@pve!automation',
  PODKIT_PVE_TOKEN_SECRET: 's3cr3t',
  PODKIT_PVE_VMID_DEVICE_REMOTE: '9000',
} as const;

function config(): PveConfig {
  const resolved = resolvePveConfig(ENV);
  if (!resolved.available) throw new Error('expected a complete config');
  return resolved.config;
}

/** A client that records calls and answers from a mutable guest state. */
function fakeClient(initial: { status: PveGuestStatus; snapshots?: PveSnapshot[] }) {
  const state = { status: initial.status, snapshots: initial.snapshots ?? [] };
  const calls: string[] = [];
  const client: PveClient = {
    version: async () => '9.1.4',
    listNodes: async () => ['rae'],
    poolMembers: async () => [],
    findGuest: async () => null,
    guestStatus: async () => state.status,
    createGuest: async () => {
      calls.push('createGuest');
      state.status = 'stopped';
    },
    start: async () => {
      calls.push('start');
      state.status = 'running';
    },
    stop: async (_vmid, opts) => {
      calls.push(opts?.force ? 'stop(force)' : 'stop');
      state.status = 'stopped';
    },
    destroy: async () => {
      calls.push('destroy');
      state.status = 'missing';
    },
    listSnapshots: async () => state.snapshots,
    snapshot: async (_vmid, name) => {
      calls.push(`snapshot(${name})`);
      state.snapshots = [...state.snapshots, { name, description: '', snaptime: 1, parent: null }];
    },
    rollback: async (_vmid, name) => {
      calls.push(`rollback(${name})`);
    },
    deleteSnapshot: async (_vmid, name) => {
      calls.push(`deleteSnapshot(${name})`);
      state.snapshots = state.snapshots.filter((s) => s.name !== name);
    },
    guestAddresses: async () => {
      calls.push('guestAddresses');
      return ['192.168.10.213'];
    },
  };
  return { client, calls, state };
}

function binding(client: PveClient): PveBinding {
  const substrate = getVm('deviceRemote') as SshVmDefinition;
  const cfg = config();
  return {
    substrate,
    vmid: 9000,
    config: cfg,
    client,
    guestSpec: { ...guestSpecFor(substrate, cfg), vmid: 9000 },
  };
}

describe('guestSpecFor', () => {
  it('derives the guest name and snippet from the ssh alias', () => {
    const spec = guestSpecFor(getVm('deviceRemote') as SshVmDefinition, config());
    expect(spec.name).toBe('podkit-substrate');
    expect(spec.snippetRef).toBe('local:snippets/podkit-substrate.yaml');
    expect(spec.imagePath).toContain('/var/lib/vz/template/iso/debian-12-generic-amd64-');
  });

  it('sizes a builder larger than a device substrate', () => {
    const device = guestSpecFor(getVm('deviceRemote') as SshVmDefinition, config());
    const builder = guestSpecFor(getVm('builderRemote') as SshVmDefinition, config());
    expect(device.memoryMiB).toBe(2048);
    expect(builder.memoryMiB).toBe(4096);
    expect(builder.diskGiB).toBeGreaterThan(device.diskGiB);
  });
});

describe('resolvePveLifecycle', () => {
  it('binds a guest when the token and the VMID are both present', () => {
    const resolved = resolvePveLifecycle(getVm('deviceRemote'), ENV);
    expect(resolved.available).toBe(true);
    if (!resolved.available) throw new Error('unreachable');
    expect(resolved.binding.vmid).toBe(9000);
  });

  it('is unconfigured, not broken, on a machine with no token', () => {
    const resolved = resolvePveLifecycle(getVm('deviceRemote'), {});
    if (resolved.available) throw new Error('expected unavailable');
    expect(resolved.reason).toBe('unconfigured');
  });

  it('separates a half-typed setup from no setup', () => {
    const resolved = resolvePveLifecycle(getVm('deviceRemote'), {
      PODKIT_PVE_TOKEN_ID: 'podkit@pve!automation',
    });
    if (resolved.available) throw new Error('expected unavailable');
    expect(resolved.reason).toBe('partial');
  });

  it('says the role has no guest here when only the VMID is missing', () => {
    const { PODKIT_PVE_VMID_DEVICE_REMOTE: _omitted, ...withoutVmid } = ENV;
    const resolved = resolvePveLifecycle(getVm('deviceRemote'), withoutVmid);
    if (resolved.available) throw new Error('expected unavailable');
    expect(resolved.reason).toBe('no-vmid');
  });

  it('refuses a Lima substrate outright — that is not this lifecycle', () => {
    const resolved = resolvePveLifecycle(getVm('device'), ENV);
    if (resolved.available) throw new Error('expected unavailable');
    expect(resolved.reason).toBe('not-ssh');
  });
});

describe('power verbs', () => {
  it('creates then starts a guest that does not exist', async () => {
    const { client, calls } = fakeClient({ status: 'missing' });
    await pveEnsureRunning(binding(client));
    expect(calls).toEqual(['createGuest', 'start']);
  });

  it('only starts a guest that exists', async () => {
    const { client, calls } = fakeClient({ status: 'stopped' });
    await pveEnsureRunning(binding(client));
    expect(calls).toEqual(['start']);
  });

  it('is a no-op on a running guest', async () => {
    const { client, calls } = fakeClient({ status: 'running' });
    await pveEnsureRunning(binding(client));
    expect(calls).toEqual([]);
  });

  it('does not stop what is already stopped', async () => {
    const { client, calls } = fakeClient({ status: 'stopped' });
    expect(await pveStop(binding(client))).toBe('stopped');
    expect(calls).toEqual([]);
  });

  it('stops a running guest before destroying it', async () => {
    const { client, calls } = fakeClient({ status: 'running' });
    await pveDestroy(binding(client));
    expect(calls).toEqual(['stop(force)', 'destroy']);
  });

  it('replaces the provisioning snapshot rather than accumulating them', async () => {
    const { client, calls } = fakeClient({
      status: 'stopped',
      snapshots: [{ name: POST_PROVISION_SNAPSHOT, description: '', snaptime: 1, parent: null }],
    });
    await pveSealSnapshot(binding(client), 'contract applied');
    expect(calls).toEqual([
      `deleteSnapshot(${POST_PROVISION_SNAPSHOT})`,
      `snapshot(${POST_PROVISION_SNAPSHOT})`,
    ]);
  });
});

describe('chooseRecoveryStrategy', () => {
  const sealed: PveSnapshot[] = [
    { name: POST_PROVISION_SNAPSHOT, description: '', snaptime: 1, parent: null },
  ];

  it('rolls back when the snapshot matches the committed inputs', () => {
    expect(chooseRecoveryStrategy({ snapshots: sealed, templateHash: 'match' })).toEqual({
      action: 'rollback',
      snapshot: POST_PROVISION_SNAPSHOT,
      reason: expect.stringContaining('matches'),
    });
  });

  it('recreates when the template moved, even though a snapshot exists', () => {
    // The trap: rolling back here restores the stale box and reports success.
    const strategy = chooseRecoveryStrategy({ snapshots: sealed, templateHash: 'drifted' });
    expect(strategy.action).toBe('recreate');
    expect(strategy.reason).toContain('stale');
  });

  it('recreates when nothing is sealed', () => {
    expect(chooseRecoveryStrategy({ snapshots: sealed, templateHash: 'unknown' }).action).toBe(
      'recreate'
    );
  });

  it('recreates when there is no snapshot to roll back to', () => {
    expect(chooseRecoveryStrategy({ snapshots: [], templateHash: 'match' }).action).toBe(
      'recreate'
    );
  });
});

describe('pveRecover', () => {
  const sealed: PveSnapshot[] = [
    { name: POST_PROVISION_SNAPSHOT, description: '', snaptime: 1, parent: null },
  ];

  it('rolls back and restarts, without touching provisioning', async () => {
    const { client, calls } = fakeClient({ status: 'running', snapshots: sealed });
    let provisioned = false;
    const result = await pveRecover(binding(client), {
      templateHash: 'match',
      provision: async () => {
        provisioned = true;
      },
    });
    expect(result.strategy.action).toBe('rollback');
    expect(calls).toEqual([
      'stop(force)',
      `rollback(${POST_PROVISION_SNAPSHOT})`,
      'start',
      'guestAddresses',
    ]);
    expect(provisioned).toBe(false);
  });

  it('falls back to a full recreate when the template hash changed', async () => {
    const { client, calls } = fakeClient({ status: 'running', snapshots: sealed });
    const ran: string[] = [];
    const result = await pveRecover(binding(client), {
      templateHash: 'drifted',
      provision: async () => void ran.push('provision'),
      reseal: async () => void ran.push('reseal'),
    });
    expect(result.strategy.action).toBe('recreate');
    expect(calls).toEqual(['stop(force)', 'destroy', 'createGuest', 'start', 'guestAddresses']);
    expect(ran).toEqual(['provision', 'reseal']);
  });

  it('recreates a guest that is gone, without trying to stop it', async () => {
    const { client, calls } = fakeClient({ status: 'missing' });
    const result = await pveRecover(binding(client), { templateHash: 'match' });
    expect(result.strategy.reason).toContain('does not exist');
    expect(calls).toEqual(['createGuest', 'start', 'guestAddresses']);
  });

  it('returns the agent-reported address, since recreate regenerates host keys', async () => {
    const { client } = fakeClient({ status: 'missing' });
    const result = await pveRecover(binding(client), { templateHash: 'match' });
    expect(result.addresses).toEqual(['192.168.10.213']);
  });
});

describe('the unconfigured path', () => {
  it('prints the qm equivalent rather than failing', () => {
    const notice = manualLifecycleNotice({
      verb: 'start',
      context: qmContextFor(getVm('deviceRemote'), {}),
      substrateId: 'deviceRemote',
      missing: ['PODKIT_PVE_API_URL'],
      partial: false,
    });
    expect(notice).toContain('qm start <vmid>');
    expect(notice).toContain('.env.local');
  });

  it('uses the configured VMID when only the token is absent', () => {
    const notice = manualLifecycleNotice({
      verb: 'stop',
      context: qmContextFor(getVm('deviceRemote'), { PODKIT_PVE_VMID_DEVICE_REMOTE: '9000' }),
      substrateId: 'deviceRemote',
      missing: ['PODKIT_PVE_TOKEN_SECRET'],
      partial: true,
    });
    expect(notice).toContain('qm shutdown 9000');
    expect(notice).toContain('half-configured');
  });

  it('breaks the run lock over ssh, since the lock is in the guest', () => {
    expect(
      manualQmEquivalent('unlock', {
        vmid: 9000,
        guestName: 'podkit-substrate',
        pool: 'podkit',
        snapshotName: POST_PROVISION_SNAPSHOT,
      })
    ).toEqual(['ssh podkit-substrate rm -rf /run/lock/podkit-substrate.lock']);
  });

  it('spells destroy as stop-then-destroy', () => {
    expect(
      manualQmEquivalent('destroy', {
        vmid: 9000,
        guestName: 'podkit-substrate',
        pool: 'podkit',
        snapshotName: POST_PROVISION_SNAPSHOT,
      })
    ).toEqual(['qm stop 9000', 'qm destroy 9000']);
  });
});

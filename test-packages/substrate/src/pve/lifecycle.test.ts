import { describe, it, expect } from 'bun:test';

import {
  chooseRecoveryStrategy,
  guestSpecFor,
  POST_PROVISION_SNAPSHOT,
  pveDestroy,
  pveEnsureRunning,
  pveRecover,
  pveSealSnapshot,
  PveCreateFailedError,
  PveStartTimeoutError,
  pveStop,
  qmContextFor,
  resolvePveLifecycle,
  type PveBinding,
  type TemplateHashVerdict,
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
      return ['192.0.2.10'];
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

  it('attaches the precondition no token can satisfy when create fails', async () => {
    const { client } = fakeClient({ status: 'missing' });
    const failing: PveClient = {
      ...client,
      createGuest: async () => {
        throw new Error('unable to parse volume ID');
      },
    };
    const err = await pveEnsureRunning(binding(failing)).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err).toBeInstanceOf(PveCreateFailedError);
    // The original cause survives; the hint is added, not substituted.
    expect(err!.message).toContain('unable to parse volume ID');
    expect(err!.message).toContain('bootstrap-pve.sh');
    expect(err!.message).toContain('local:snippets/podkit-substrate.yaml');
  });

  it('is a no-op on a running guest', async () => {
    const { client, calls } = fakeClient({ status: 'running' });
    await pveEnsureRunning(binding(client));
    expect(calls).toEqual([]);
  });

  it('does not return while the guest still reports stopped', async () => {
    // The start task finishes when QEMU has been launched, which is not the
    // moment the guest flips to `running`.
    const { client, state } = fakeClient({ status: 'stopped' });
    const slow: PveClient = {
      ...client,
      start: async () => {
        state.status = 'stopped';
      },
    };
    let settled = false;
    const pending = pveEnsureRunning(binding(slow), { sleep: async () => {} }).then(() => {
      settled = true;
    });

    // Let the poll loop turn over while the guest is still down.
    await Promise.resolve();
    expect(settled).toBe(false);

    state.status = 'running';
    await pending;
    expect(settled).toBe(true);
  });

  it('gives up at once on a guest that vanished, rather than polling to the bound', async () => {
    const { client, state } = fakeClient({ status: 'stopped' });
    let polls = 0;
    const vanished: PveClient = {
      ...client,
      start: async () => {
        state.status = 'stopped';
      },
      guestStatus: async () => {
        polls += 1;
        return polls === 1 ? 'stopped' : 'missing';
      },
    };
    const err = await pveEnsureRunning(binding(vanished), { sleep: async () => {} }).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err).toBeInstanceOf(PveStartTimeoutError);
    expect(err!.message).toContain('missing');
    // Two reads: the pre-start status, then the one that found it gone.
    expect(polls).toBe(2);
  });

  it('gives up on a guest that never reports running, naming the bound', async () => {
    const { client, state } = fakeClient({ status: 'stopped' });
    const stuck: PveClient = {
      ...client,
      start: async () => {
        state.status = 'stopped';
      },
    };
    let clock = 0;
    const err = await pveEnsureRunning(binding(stuck), {
      timeoutMs: 5_000,
      now: () => (clock += 1_000),
      sleep: async () => {},
    }).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err).toBeInstanceOf(PveStartTimeoutError);
    expect(err!.message).toContain('9000');
    expect(err!.message).toContain('5000ms');
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

  const unknown = (because: string): TemplateHashVerdict => ({ verdict: 'unknown', because });

  it('rolls back when the snapshot matches the committed inputs', () => {
    expect(
      chooseRecoveryStrategy({ snapshots: sealed, templateHash: { verdict: 'match' } })
    ).toEqual({
      action: 'rollback',
      snapshot: POST_PROVISION_SNAPSHOT,
      reason: expect.stringContaining('matches'),
    });
  });

  it('recreates when the template moved, even though a snapshot exists', () => {
    // The trap: rolling back here restores the stale box and reports success.
    const strategy = chooseRecoveryStrategy({
      snapshots: sealed,
      templateHash: { verdict: 'drifted' },
    });
    expect(strategy.action).toBe('recreate');
    expect(strategy.reason).toContain('stale');
  });

  it('recreates when the guest was asked and carries no seal', () => {
    const strategy = chooseRecoveryStrategy({
      snapshots: sealed,
      templateHash: { verdict: 'absent' },
    });
    expect(strategy.action).toBe('recreate');
    expect(strategy.reason).toContain('nothing is sealed');
  });

  it('rolls back rather than recreating when the seal could not be established', () => {
    // The destructive branch answers to evidence. A guest nobody could ask has
    // produced none, and the snapshot is evidence the API supplied anyway.
    const strategy = chooseRecoveryStrategy({
      snapshots: sealed,
      templateHash: unknown('VMID 9000 is stopped'),
    });
    expect(strategy.action).toBe('rollback');
    expect(strategy.reason).toContain('VMID 9000 is stopped');
  });

  it('recreates an unestablished guest only on the evidence that it has no snapshot', () => {
    const strategy = chooseRecoveryStrategy({
      snapshots: [],
      templateHash: unknown('VMID 9000 is stopped'),
    });
    expect(strategy.action).toBe('recreate');
    expect(strategy.reason).toContain(`no '${POST_PROVISION_SNAPSHOT}' snapshot`);
    // The one remaining path that deletes a guest it could not question still
    // has to say it could not question it.
    expect(strategy.reason).toContain('VMID 9000 is stopped');
  });

  it('recreates when there is no snapshot to roll back to', () => {
    expect(
      chooseRecoveryStrategy({ snapshots: [], templateHash: { verdict: 'match' } }).action
    ).toBe('recreate');
  });

  it('recreates when the caller pre-empted the question, and says who asked', () => {
    const strategy = chooseRecoveryStrategy({
      snapshots: sealed,
      templateHash: { verdict: 'not-sought', because: 'the operator asked with --recreate' },
    });
    expect(strategy.action).toBe('recreate');
    expect(strategy.reason).toContain('--recreate');
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
      templateHash: { verdict: 'match' },
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
      templateHash: { verdict: 'drifted' },
      provision: async () => void ran.push('provision'),
      reseal: async () => void ran.push('reseal'),
    });
    expect(result.strategy.action).toBe('recreate');
    expect(calls).toEqual(['stop(force)', 'destroy', 'createGuest', 'start', 'guestAddresses']);
    expect(ran).toEqual(['provision', 'reseal']);
  });

  it('recreates a guest that is gone, without trying to stop it', async () => {
    const { client, calls } = fakeClient({ status: 'missing' });
    const result = await pveRecover(binding(client), { templateHash: { verdict: 'match' } });
    expect(result.strategy.reason).toContain('does not exist');
    expect(calls).toEqual(['createGuest', 'start', 'guestAddresses']);
  });

  it('waits for the guest to answer over ssh before provisioning it', async () => {
    // The start task finishes when QEMU launched. sshd is minutes away on a
    // freshly created guest, and provisioning goes over ssh.
    const { client } = fakeClient({ status: 'running', snapshots: sealed });
    const ran: string[] = [];
    await pveRecover(binding(client), {
      templateHash: { verdict: 'drifted' },
      awaitReady: async () => void ran.push('awaitReady'),
      provision: async () => void ran.push('provision'),
      reseal: async () => void ran.push('reseal'),
    });
    expect(ran).toEqual(['awaitReady', 'provision', 'reseal']);
  });

  it('waits for the guest to answer over ssh after a rollback too', async () => {
    const { client, calls } = fakeClient({ status: 'running', snapshots: sealed });
    let readyAfter: readonly string[] = [];
    let sawStrategy = '';
    const result = await pveRecover(binding(client), {
      templateHash: { verdict: 'match' },
      awaitReady: async (strategy) => {
        sawStrategy = strategy.action;
        readyAfter = [...calls];
      },
    });
    expect(sawStrategy).toBe('rollback');
    expect(result.strategy.action).toBe('rollback');
    // Waited after the restart, not before it.
    expect(readyAfter).toEqual(['stop(force)', `rollback(${POST_PROVISION_SNAPSHOT})`, 'start']);
  });

  it('does not provision a guest that never answered', async () => {
    const { client } = fakeClient({ status: 'missing' });
    let provisioned = false;
    const err = await pveRecover(binding(client), {
      templateHash: { verdict: 'match' },
      awaitReady: async () => {
        throw new Error('substrate never answered');
      },
      provision: async () => void (provisioned = true),
    }).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err!.message).toContain('never answered');
    expect(provisioned).toBe(false);
  });

  it('returns the agent-reported address, since recreate regenerates host keys', async () => {
    const { client } = fakeClient({ status: 'missing' });
    const result = await pveRecover(binding(client), { templateHash: { verdict: 'match' } });
    expect(result.addresses).toEqual(['192.0.2.10']);
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

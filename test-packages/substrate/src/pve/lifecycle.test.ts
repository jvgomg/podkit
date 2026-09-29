import { describe, it, expect } from 'bun:test';

import {
  chooseRecoveryStrategy,
  guestSpecFor,
  POST_PROVISION_SNAPSHOT,
  pveDestroy,
  pveEnsureRunning,
  pveRecover,
  pveSealSnapshot,
  PveBaselineHashFormatError,
  PveCreateFailedError,
  PveGuestStateError,
  PveStartTimeoutError,
  pveStop,
  qmContextFor,
  resolvePveLifecycle,
  baselineDisagreement,
  snapshotHashVerdict,
  type PveBinding,
  type TemplateHashVerdict,
} from './lifecycle.js';
import { manualLifecycleNotice, manualQmEquivalent } from './qm.js';
import { resolvePveConfig, type PveConfig } from './config.js';
import { getVm, type SshVmDefinition } from '../registry.js';
import type { PveClient, PveGuestStatus, PveSnapshot } from './client.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

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
    resume: async () => {
      calls.push('resume');
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
    snapshot: async (_vmid, name, description) => {
      calls.push(`snapshot(${name})`);
      state.snapshots = [
        ...state.snapshots,
        { name, description: description ?? '', snaptime: 1, parent: null },
      ];
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
    // It comes up during the second wait, so returning any earlier would be
    // returning while it still read `stopped`.
    let waits = 0;
    await pveEnsureRunning(binding(slow), {
      sleep: async () => {
        waits += 1;
        if (waits === 2) state.status = 'running';
      },
    });
    expect(waits).toBe(2);
    expect(state.status).toBe('running');
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

  it('resumes a paused guest rather than issuing a start PVE rejects', async () => {
    const { client, calls } = fakeClient({ status: 'paused' });
    await pveEnsureRunning(binding(client));
    expect(calls).toEqual(['resume']);
  });

  it('waits through a listing that still says paused after the resume', async () => {
    // The pool listing lags the power state by a status-daemon cycle.
    const { client, state } = fakeClient({ status: 'paused' });
    let polls = 0;
    const lagging: PveClient = {
      ...client,
      resume: async () => {},
      guestStatus: async () => {
        polls += 1;
        if (polls === 3) state.status = 'running';
        return state.status;
      },
    };
    await pveEnsureRunning(binding(lagging), { sleep: async () => {} });
    expect(polls).toBe(3);
  });

  it('does not stop what is already stopped', async () => {
    const { client, calls } = fakeClient({ status: 'stopped' });
    expect(await pveStop(binding(client))).toBe('stopped');
    expect(calls).toEqual([]);
  });

  it('hard-stops a paused guest, which cannot take an ACPI shutdown', async () => {
    const { client, calls } = fakeClient({ status: 'paused' });
    const said: string[] = [];
    expect(await pveStop(binding(client), { report: (m) => void said.push(m) })).toBe('stopped');
    expect(calls).toEqual(['stop(force)']);
    expect(said.join('\n')).toContain('paused');
  });

  it('still shuts a running guest down gracefully', async () => {
    const { client, calls } = fakeClient({ status: 'running' });
    await pveStop(binding(client));
    expect(calls).toEqual(['stop']);
  });

  it('refuses to act on a status it cannot interpret', async () => {
    for (const verb of [
      (b: PveBinding) => pveEnsureRunning(b),
      (b: PveBinding) => pveStop(b),
      (b: PveBinding) => pveDestroy(b),
    ]) {
      const { client, calls } = fakeClient({ status: 'unknown' });
      const err = await verb(binding(client)).then(
        () => null,
        (e: unknown) => e as Error
      );
      expect(err).toBeInstanceOf(PveGuestStateError);
      expect(err!.message).toContain('qm status 9000');
      expect(calls).toEqual([]);
    }
  });

  it('will not bounce a wedged guest on ensure, and points at recover', async () => {
    const { client, calls } = fakeClient({ status: 'internal-error' });
    const err = await pveEnsureRunning(binding(client)).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err).toBeInstanceOf(PveGuestStateError);
    expect(err!.message).toContain('vm:recover deviceRemote');
    expect(calls).toEqual([]);
  });

  it('stops a paused guest before destroying it', async () => {
    const { client, calls } = fakeClient({ status: 'paused' });
    await pveDestroy(binding(client));
    expect(calls).toEqual(['stop(force)', 'destroy']);
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
    await pveSealSnapshot(binding(client), { baselineHash: SHA_A });
    expect(calls).toEqual([
      `deleteSnapshot(${POST_PROVISION_SNAPSHOT})`,
      `snapshot(${POST_PROVISION_SNAPSHOT})`,
    ]);
  });
});

describe('the baseline claim on the provisioning snapshot', () => {
  const snapshotOf = (description: string): PveSnapshot[] => [
    { name: POST_PROVISION_SNAPSHOT, description, snaptime: 1, parent: null },
  ];

  it('seals the full hash in a field, and reads it back as a comparison', async () => {
    const { client, state } = fakeClient({ status: 'running' });
    await pveSealSnapshot(binding(client), { baselineHash: SHA_A });
    expect(state.snapshots[0]!.description).toContain(`podkit-baseline-hash=${SHA_A}`);
    expect(snapshotHashVerdict(state.snapshots, SHA_A)).toEqual({ verdict: 'match' });
    expect(snapshotHashVerdict(state.snapshots, SHA_B)).toEqual({ verdict: 'drifted' });
  });

  it('refuses to seal something that is not a full hash', async () => {
    const { client, calls } = fakeClient({ status: 'running' });
    await expect(
      pveSealSnapshot(binding(client), { baselineHash: SHA_A.slice(0, 12) })
    ).rejects.toBeInstanceOf(PveBaselineHashFormatError);
    expect(calls).toEqual([]);
  });

  it('reads a snapshot sealed without a hash as unknown, never as drift', async () => {
    const { client, state } = fakeClient({ status: 'running' });
    await pveSealSnapshot(binding(client), { baselineHash: null });
    const verdict = snapshotHashVerdict(state.snapshots, SHA_A);
    expect(verdict.verdict).toBe('unknown');
    expect(verdict).toHaveProperty('because', expect.stringContaining('without a baseline hash'));
  });

  it('reads the old prose description as unknown, and says how to replace it', () => {
    const verdict = snapshotHashVerdict(snapshotOf('podkit baseline 73a79d889b39'), SHA_A);
    expect(verdict.verdict).toBe('unknown');
    expect(verdict).toHaveProperty(
      'because',
      expect.stringContaining('podkit baseline 73a79d889b39')
    );
    expect(verdict).toHaveProperty('because', expect.stringContaining('harness:seal'));
  });

  it('is unknown when there is no snapshot, or nothing to compare against', () => {
    expect(snapshotHashVerdict([], SHA_A).verdict).toBe('unknown');
    expect(
      snapshotHashVerdict(snapshotOf(`podkit-baseline-hash=${SHA_A}`), undefined).verdict
    ).toBe('unknown');
  });

  it('names a disagreement between the claim and the guest, and only a disagreement', () => {
    const claiming = snapshotOf(`podkit provisioning snapshot; podkit-baseline-hash=${SHA_A}`);
    expect(baselineDisagreement(claiming, SHA_A)).toBeNull();
    expect(baselineDisagreement(claiming, SHA_B)).toContain(SHA_B.slice(0, 12));
    expect(baselineDisagreement(claiming, '')).toContain('holds nothing');
    // Nothing claimed is nothing to disagree with.
    expect(baselineDisagreement(snapshotOf('podkit-baseline-hash=none'), SHA_B)).toBeNull();
    expect(baselineDisagreement([], SHA_B)).toBeNull();
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

  it('hard-stops a paused guest before rolling it back', async () => {
    // PVE's own rollback also stops a paused guest; the stop is this verb's
    // contract, not a side effect it relies on.
    const { client, calls } = fakeClient({ status: 'paused', snapshots: sealed });
    const result = await pveRecover(binding(client), { templateHash: { verdict: 'match' } });
    expect(result.strategy.action).toBe('rollback');
    expect(calls).toEqual([
      'stop(force)',
      `rollback(${POST_PROVISION_SNAPSHOT})`,
      'start',
      'guestAddresses',
    ]);
  });

  it('hard-stops a paused guest before destroying it for a recreate', async () => {
    const { client, calls } = fakeClient({ status: 'paused', snapshots: sealed });
    await pveRecover(binding(client), { templateHash: { verdict: 'drifted' } });
    expect(calls).toEqual(['stop(force)', 'destroy', 'createGuest', 'start', 'guestAddresses']);
  });

  it('refuses to recover a guest whose status it cannot interpret', async () => {
    const { client, calls } = fakeClient({ status: 'unknown', snapshots: sealed });
    const err = await pveRecover(binding(client), { templateHash: { verdict: 'match' } }).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err).toBeInstanceOf(PveGuestStateError);
    expect(calls).toEqual([]);
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

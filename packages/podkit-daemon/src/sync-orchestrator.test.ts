import { describe, it, expect } from 'bun:test';
import { SyncOrchestrator } from './sync-orchestrator.js';
import type { DetectedDevice } from './device-poller.js';
import type { CliResult, AbortableCliResult, MountOutput, SyncOutput, EjectOutput } from './cli-runner.js';
import type { ChildProcess } from 'node:child_process';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDevice(overrides?: Partial<DetectedDevice>): DetectedDevice {
  return {
    name: 'sdb1',
    disk: '/dev/sdb1',
    uuid: 'ABCD-1234',
    label: 'IPOD',
    size: 160_000_000_000,
    ...overrides,
  };
}

function okResult<T>(json: T): CliResult<T> {
  return { exitCode: 0, stdout: '', stderr: '', json, duration: 100 };
}

function failResult<T>(json: T, exitCode = 1): CliResult<T> {
  return { exitCode, stdout: '', stderr: 'error output', json, duration: 50 };
}

type MockCli = {
  runMount: (disk: string, target: string) => Promise<CliResult<MountOutput>>;
  runSync: (device: string, options?: { dryRun?: boolean }) => Promise<CliResult<SyncOutput>>;
  runEject: (device: string) => Promise<CliResult<EjectOutput>>;
  calls: string[];
};

function createMockCli(overrides?: {
  mount?: CliResult<MountOutput>;
  syncDryRun?: CliResult<SyncOutput>;
  sync?: CliResult<SyncOutput>;
  eject?: CliResult<EjectOutput>;
}): MockCli {
  const calls: string[] = [];

  const defaultMount = okResult<MountOutput>({ success: true, mountPoint: '/ipod' });
  const defaultSyncDryRun = okResult<SyncOutput>({
    success: true,
    dryRun: true,
    plan: { tracksToAdd: 10, tracksToRemove: 2, tracksToUpdate: 1, tracksExisting: 50 },
  });
  const defaultSync = okResult<SyncOutput>({
    success: true,
    dryRun: false,
    result: { completed: 10, failed: 0, duration: 30.5 },
  });
  const defaultEject = okResult<EjectOutput>({ success: true });

  return {
    calls,
    runMount: async (disk: string, target: string) => {
      calls.push(`mount:${disk}:${target}`);
      return overrides?.mount ?? defaultMount;
    },
    runSync: async (_device: string, options?: { dryRun?: boolean }) => {
      const label = options?.dryRun ? 'sync:dry-run' : 'sync:execute';
      calls.push(label);
      if (options?.dryRun) {
        return overrides?.syncDryRun ?? defaultSyncDryRun;
      }
      return overrides?.sync ?? defaultSync;
    },
    runEject: async (_device: string) => {
      calls.push('eject');
      return overrides?.eject ?? defaultEject;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncOrchestrator', () => {
  it('runs full mount -> dry-run -> sync -> eject cycle', async () => {
    const cli = createMockCli();
    const orchestrator = new SyncOrchestrator({ ...cli, mountTarget: '/ipod' });

    expect(orchestrator.isSyncing).toBe(false);
    await orchestrator.handleDeviceAppeared(makeDevice());
    expect(orchestrator.isSyncing).toBe(false);

    expect(cli.calls).toEqual(['mount:/dev/sdb1:/ipod', 'sync:dry-run', 'sync:execute', 'eject']);
  });

  it('stops at mount failure without proceeding to sync', async () => {
    const cli = createMockCli({
      mount: failResult<MountOutput>({ success: false, error: 'device busy' }),
    });
    const orchestrator = new SyncOrchestrator({ ...cli });

    await orchestrator.handleDeviceAppeared(makeDevice());

    expect(cli.calls).toEqual(['mount:/dev/sdb1:/ipod']);
    expect(orchestrator.isSyncing).toBe(false);
  });

  it('still ejects after sync failure', async () => {
    const cli = createMockCli({
      sync: failResult<SyncOutput>({ success: false, dryRun: false, error: 'transcode failed' }),
    });
    const orchestrator = new SyncOrchestrator({ ...cli });

    await orchestrator.handleDeviceAppeared(makeDevice());

    expect(cli.calls).toEqual(['mount:/dev/sdb1:/ipod', 'sync:dry-run', 'sync:execute', 'eject']);
  });

  it('still ejects after dry-run failure', async () => {
    const cli = createMockCli({
      syncDryRun: failResult<SyncOutput>({ success: false, dryRun: true, error: 'scan error' }),
    });
    const orchestrator = new SyncOrchestrator({ ...cli });

    await orchestrator.handleDeviceAppeared(makeDevice());

    // dry-run failure is non-fatal — sync and eject should still run
    expect(cli.calls).toEqual(['mount:/dev/sdb1:/ipod', 'sync:dry-run', 'sync:execute', 'eject']);
  });

  it('ignores new devices while syncing (one-at-a-time)', async () => {
    let resolveSync: (() => void) | null = null;
    const syncPromise = new Promise<void>((resolve) => {
      resolveSync = resolve;
    });

    const calls: string[] = [];
    const orchestrator = new SyncOrchestrator({
      runMount: async () => {
        calls.push('mount');
        return okResult<MountOutput>({ success: true, mountPoint: '/ipod' });
      },
      runSync: async (_device, options) => {
        if (!options?.dryRun) {
          calls.push('sync:execute:start');
          // Block until we resolve
          await syncPromise;
          calls.push('sync:execute:end');
        } else {
          calls.push('sync:dry-run');
        }
        return okResult<SyncOutput>({
          success: true,
          dryRun: options?.dryRun ?? false,
          result: { completed: 1, failed: 0, duration: 1 },
        });
      },
      runEject: async () => {
        calls.push('eject');
        return okResult<EjectOutput>({ success: true });
      },
    });

    // Start first sync (will block on the actual sync step)
    const firstSync = orchestrator.handleDeviceAppeared(makeDevice({ name: 'sdb1' }));

    // Wait a tick for the mount + dry-run to complete before the sync blocks
    await new Promise((r) => setTimeout(r, 10));

    expect(orchestrator.isSyncing).toBe(true);

    // Try to start second device — should be ignored
    await orchestrator.handleDeviceAppeared(makeDevice({ name: 'sdc1' }));

    // The second call should not have added any calls beyond what the first already did
    const mountCount = calls.filter((c) => c === 'mount').length;
    expect(mountCount).toBe(1);

    // Release the sync
    resolveSync!();
    await firstSync;

    expect(orchestrator.isSyncing).toBe(false);
  });

  it('handles eject failure without crashing', async () => {
    const cli = createMockCli({
      eject: failResult<EjectOutput>({ success: false, error: 'already unplugged' }),
    });
    const orchestrator = new SyncOrchestrator({ ...cli });

    // Should not throw
    await orchestrator.handleDeviceAppeared(makeDevice());

    expect(cli.calls).toContain('eject');
    expect(orchestrator.isSyncing).toBe(false);
  });

  it('resets isSyncing after error in mount', async () => {
    const orchestrator = new SyncOrchestrator({
      runMount: async () => {
        throw new Error('spawn failed');
      },
      runSync: async () => okResult<SyncOutput>({ success: true, dryRun: false }),
      runEject: async () => okResult<EjectOutput>({ success: true }),
    });

    // Should not throw — errors are caught internally
    // But wait: our implementation catches at the step level.
    // Let's verify it handles thrown errors gracefully.
    // Actually, the mount step doesn't have a try-catch around the throw.
    // Let's check: the `finally` block ensures isSyncing is reset.
    await orchestrator.handleDeviceAppeared(makeDevice());
    expect(orchestrator.isSyncing).toBe(false);
  });

  it('handleDeviceDisappeared logs without error', () => {
    const cli = createMockCli();
    const orchestrator = new SyncOrchestrator({ ...cli });

    // Should not throw
    orchestrator.handleDeviceDisappeared(makeDevice());
    expect(cli.calls).toEqual([]);
  });

  it('tracks currentDevice during sync', async () => {
    let capturedDevice: DetectedDevice | null = null;

    const cli = createMockCli();
    const originalRunSync = cli.runSync;
    cli.runSync = async (device, options) => {
      if (!options?.dryRun) {
        // Capture currentDevice while sync is in progress
        capturedDevice = orchestrator.currentDevice;
      }
      return originalRunSync(device, options);
    };

    const orchestrator = new SyncOrchestrator({ ...cli });
    const device = makeDevice({ name: 'sdb1' });

    await orchestrator.handleDeviceAppeared(device);

    expect(capturedDevice).not.toBeNull();
    expect(capturedDevice!.name).toBe('sdb1');
    // After completion, currentDevice is cleared
    expect(orchestrator.currentDevice).toBeNull();
  });

  it('sets deviceDisconnected when current device disappears mid-sync', async () => {
    let resolveSync: (() => void) | null = null;
    const syncPromise = new Promise<void>((resolve) => {
      resolveSync = resolve;
    });

    const orchestrator = new SyncOrchestrator({
      runMount: async () => okResult<MountOutput>({ success: true, mountPoint: '/ipod' }),
      runSync: async (_device, options) => {
        if (!options?.dryRun) {
          // Block to simulate a long-running sync
          await syncPromise;
        }
        return okResult<SyncOutput>({
          success: true,
          dryRun: options?.dryRun ?? false,
          result: { completed: 1, failed: 0, duration: 1 },
        });
      },
      runEject: async () => okResult<EjectOutput>({ success: true }),
    });

    const device = makeDevice({ name: 'sdb1' });

    // Start sync (will block at the sync step)
    const syncDone = orchestrator.handleDeviceAppeared(device);
    await new Promise((r) => setTimeout(r, 10));

    expect(orchestrator.isSyncing).toBe(true);
    expect(orchestrator.deviceDisconnected).toBe(false);

    // Simulate device removal mid-sync
    orchestrator.handleDeviceDisappeared(device);
    expect(orchestrator.deviceDisconnected).toBe(true);

    // Release sync
    resolveSync!();
    await syncDone;

    // After completion, flags are cleared
    expect(orchestrator.deviceDisconnected).toBe(false);
    expect(orchestrator.currentDevice).toBeNull();
  });

  it('does not set deviceDisconnected for a different device', async () => {
    let resolveSync: (() => void) | null = null;
    const syncPromise = new Promise<void>((resolve) => {
      resolveSync = resolve;
    });

    const orchestrator = new SyncOrchestrator({
      runMount: async () => okResult<MountOutput>({ success: true, mountPoint: '/ipod' }),
      runSync: async (_device, options) => {
        if (!options?.dryRun) {
          await syncPromise;
        }
        return okResult<SyncOutput>({
          success: true,
          dryRun: options?.dryRun ?? false,
          result: { completed: 1, failed: 0, duration: 1 },
        });
      },
      runEject: async () => okResult<EjectOutput>({ success: true }),
    });

    const syncingDevice = makeDevice({ name: 'sdb1' });
    const otherDevice = makeDevice({ name: 'sdc1' });

    // Start sync on sdb1
    const syncDone = orchestrator.handleDeviceAppeared(syncingDevice);
    await new Promise((r) => setTimeout(r, 10));

    // Different device disappears — should NOT set disconnected flag
    orchestrator.handleDeviceDisappeared(otherDevice);
    expect(orchestrator.deviceDisconnected).toBe(false);

    resolveSync!();
    await syncDone;
  });

  it('abort() sends SIGINT to active sync child', async () => {
    let resolveResult: ((value: CliResult<SyncOutput>) => void) | null = null;
    const resultPromise = new Promise<CliResult<SyncOutput>>((resolve) => {
      resolveResult = resolve;
    });

    const killCalls: string[] = [];
    const mockChild = {
      kill: (signal: string) => {
        killCalls.push(signal);
        return true;
      },
    } as unknown as ChildProcess;

    const spawnSync = (_device: string): AbortableCliResult<SyncOutput> => ({
      result: resultPromise,
      child: mockChild,
    });

    const orchestrator = new SyncOrchestrator({
      runMount: async () => okResult<MountOutput>({ success: true, mountPoint: '/ipod' }),
      runSync: async (_device, options) =>
        okResult<SyncOutput>({
          success: true,
          dryRun: options?.dryRun ?? false,
          plan: { tracksToAdd: 1, tracksToRemove: 0, tracksToUpdate: 0, tracksExisting: 0 },
        }),
      runEject: async () => okResult<EjectOutput>({ success: true }),
      spawnSync,
    });

    // Start sync — will block on the spawnSync result promise
    const syncDone = orchestrator.handleDeviceAppeared(makeDevice());
    await new Promise((r) => setTimeout(r, 10));

    expect(orchestrator.isSyncing).toBe(true);

    // Abort while sync is in progress
    orchestrator.abort();
    expect(killCalls).toEqual(['SIGINT']);

    // Resolve the sync so the cycle completes
    resolveResult!(okResult<SyncOutput>({
      success: true,
      dryRun: false,
      result: { completed: 0, failed: 0, duration: 1 },
    }));
    await syncDone;

    expect(orchestrator.isSyncing).toBe(false);
  });

  it('abort() is a no-op when not syncing', () => {
    const cli = createMockCli();
    const orchestrator = new SyncOrchestrator({ ...cli });

    // Should not throw
    orchestrator.abort();
    expect(orchestrator.isSyncing).toBe(false);
  });

  it('exit code 130 is treated as graceful abort, not error', async () => {
    const notifications: { title: string; body: string }[] = [];
    const mockNotify = {
      notify: async (title: string, body: string) => {
        notifications.push({ title, body });
      },
    };

    const spawnSync = (_device: string): AbortableCliResult<SyncOutput> => ({
      result: Promise.resolve({
        exitCode: 130,
        stdout: '',
        stderr: '',
        json: undefined,
        duration: 50,
      }),
      child: { kill: () => true } as unknown as ChildProcess,
    });

    const cli = createMockCli();
    const orchestrator = new SyncOrchestrator({
      ...cli,
      spawnSync,
      notify: mockNotify,
    });

    await orchestrator.handleDeviceAppeared(makeDevice());

    // Should not have sent any error notifications
    const errorNotifications = notifications.filter((n) => n.title === 'Sync Error');
    expect(errorNotifications).toHaveLength(0);

    // Eject should still proceed
    expect(cli.calls).toContain('eject');
    expect(orchestrator.isSyncing).toBe(false);
  });
});

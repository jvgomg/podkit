/**
 * Sync orchestrator — state machine for one sync cycle.
 *
 * Flow: mount -> dry-run -> sync -> eject
 *
 * Enforces one-at-a-time: while a sync is running, new device-appeared
 * events are queued. Each device gets its own mount point to prevent
 * conflicts. Queued devices are synced sequentially after the current
 * sync completes.
 */

import type { ChildProcess } from 'node:child_process';
import type { DetectedDevice } from './device-poller.js';
import type {
  CliResult,
  AbortableCliResult,
  MountOutput,
  SyncOutput,
  EjectOutput,
} from './cli-runner.js';
import type { AppriseClient } from './apprise-client.js';
import {
  formatPreSyncNotification,
  formatPostSyncNotification,
  formatErrorNotification,
} from './notification-formatter.js';
import { log } from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncOrchestratorOptions {
  /** Functions to shell out to the CLI. Injected for testability. */
  runMount: (disk: string, target: string) => Promise<CliResult<MountOutput>>;
  runSync: (device: string, options?: { dryRun?: boolean }) => Promise<CliResult<SyncOutput>>;
  runEject: (device: string) => Promise<CliResult<EjectOutput>>;
  /**
   * Abortable sync spawner. When provided, the orchestrator uses this for
   * the actual sync (not dry-run) so it can forward SIGINT on abort.
   * Falls back to `runSync` if not provided.
   */
  spawnSync?: (device: string, options?: { dryRun?: boolean }) => AbortableCliResult<SyncOutput>;
  /** Base path for per-device mount points (default: "/tmp/podkit") */
  mountBase?: string;
  /** Optional notification client. When omitted, no notifications are sent. */
  notify?: AppriseClient;
}

// ---------------------------------------------------------------------------
// SyncOrchestrator
// ---------------------------------------------------------------------------

export class SyncOrchestrator {
  private _isSyncing = false;
  private _currentDevice: DetectedDevice | null = null;
  private _deviceDisconnected = false;
  private _activeSyncChild: ChildProcess | null = null;
  private readonly _queue: DetectedDevice[] = [];
  private readonly mountBase: string;
  private readonly notify: AppriseClient;
  private readonly cli: {
    runMount: SyncOrchestratorOptions['runMount'];
    runSync: SyncOrchestratorOptions['runSync'];
    runEject: SyncOrchestratorOptions['runEject'];
    spawnSync?: SyncOrchestratorOptions['spawnSync'];
  };

  constructor(options: SyncOrchestratorOptions) {
    this.mountBase = options.mountBase ?? '/tmp/podkit';
    this.notify = options.notify ?? { notify: async () => {} };
    this.cli = {
      runMount: options.runMount,
      runSync: options.runSync,
      runEject: options.runEject,
      spawnSync: options.spawnSync,
    };
  }

  get isSyncing(): boolean {
    return this._isSyncing;
  }

  /** The device currently being synced, or null if idle. */
  get currentDevice(): DetectedDevice | null {
    return this._currentDevice;
  }

  /** Whether the current device was disconnected mid-sync. */
  get deviceDisconnected(): boolean {
    return this._deviceDisconnected;
  }

  /** Devices waiting to be synced. */
  get queue(): readonly DetectedDevice[] {
    return this._queue;
  }

  /**
   * Wait for any in-progress sync to complete.
   * Used for graceful shutdown — ensures we don't kill a sync mid-transfer.
   */
  async waitForIdle(): Promise<void> {
    while (this._isSyncing) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  /**
   * Abort the in-progress sync and clear the queue.
   *
   * Sends SIGINT to the active sync child process, triggering the CLI's
   * graceful shutdown (drain + save). Also clears the queue so no new
   * syncs start after the current one completes — important for shutdown
   * where Docker's SIGKILL follows ~10s after SIGTERM.
   *
   * Safe to call multiple times or when no sync is in progress (no-op).
   */
  abort(): void {
    if (this._queue.length > 0) {
      log('info', `Clearing ${this._queue.length} queued device(s) for shutdown`);
      this._queue.length = 0;
    }
    if (this._activeSyncChild) {
      log('info', 'Sending SIGINT to active sync process');
      this._activeSyncChild.kill('SIGINT');
    }
  }

  /** Generate a unique mount point path for a device. */
  private mountPointFor(device: DetectedDevice): string {
    return `${this.mountBase}-${device.name}`;
  }

  /**
   * Handle a newly-detected iPod device.
   *
   * Runs the full mount -> dry-run -> sync -> eject cycle.
   * If a sync is already in progress, the device is queued and will be
   * synced after the current sync completes.
   */
  async handleDeviceAppeared(device: DetectedDevice): Promise<void> {
    if (this._isSyncing) {
      // Don't queue the same device twice
      if (this._queue.some((d) => d.name === device.name)) {
        log('info', `Device already queued: ${device.name}`, { disk: device.disk });
        return;
      }
      log('info', `Sync in progress, queuing device: ${device.name}`, {
        disk: device.disk,
        queueLength: this._queue.length + 1,
      });
      this._queue.push(device);
      return;
    }

    this._isSyncing = true;
    this._currentDevice = device;
    this._deviceDisconnected = false;
    const startTime = Date.now();

    try {
      log('info', `Starting sync cycle for ${device.name}`, {
        disk: device.disk,
        label: device.label,
        uuid: device.uuid,
      });

      // Step 1: Mount (each device gets its own mount point)
      const targetMount = this.mountPointFor(device);
      let mountResult;
      try {
        mountResult = await this.cli.runMount(device.disk, targetMount);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log('error', `Mount threw for ${device.name}: ${message}`);
        await this.notify.notify('Sync Error', formatErrorNotification(device, 'mount', message));
        return;
      }
      if (mountResult.exitCode !== 0 || !mountResult.json?.success) {
        const error = mountResult.json?.error ?? mountResult.stderr.trim() ?? 'Unknown mount error';
        log('error', `Mount failed for ${device.name}: ${error}`);
        await this.notify.notify('Sync Error', formatErrorNotification(device, 'mount', error));
        return;
      }

      const mountPoint = mountResult.json.mountPoint ?? targetMount;
      log('info', `Mounted ${device.name} at ${mountPoint}`);

      // Step 2: Dry-run preview (for logging + notification)
      try {
        const dryRunResult = await this.cli.runSync(mountPoint, { dryRun: true });
        if (dryRunResult.json?.plan) {
          const plan = dryRunResult.json.plan;
          log('info', 'Sync plan', {
            add: plan.tracksToAdd,
            remove: plan.tracksToRemove,
            update: plan.tracksToUpdate,
            existing: plan.tracksExisting,
          });
        }
        if (dryRunResult.json) {
          await this.notify.notify(
            'Sync Starting',
            formatPreSyncNotification(device, dryRunResult.json)
          );
        }
      } catch (err) {
        log('warn', `Dry-run failed: ${err instanceof Error ? err.message : String(err)}`);
        // Continue to actual sync — dry-run failure is not fatal
      }

      // Step 3: Sync
      let syncFailed = false;
      try {
        // Use spawnSync when available so abort() can forward SIGINT
        let syncResult: CliResult<SyncOutput>;
        if (this.cli.spawnSync) {
          const handle = this.cli.spawnSync(mountPoint);
          this._activeSyncChild = handle.child;
          try {
            syncResult = await handle.result;
          } finally {
            this._activeSyncChild = null;
          }
        } else {
          syncResult = await this.cli.runSync(mountPoint);
        }
        if (syncResult.exitCode === 130) {
          log('info', 'Sync aborted gracefully', { device: device.name });
          // Don't treat as failure — database was saved before exit
        } else if (syncResult.exitCode !== 0 || !syncResult.json?.success) {
          const reason = this._deviceDisconnected ? 'device disconnected' : 'sync';
          const error = syncResult.json?.error ?? syncResult.stderr.trim() ?? 'Unknown sync error';
          log('error', `Sync failed for ${device.name}: ${error}`, {
            deviceDisconnected: this._deviceDisconnected,
          });
          await this.notify.notify('Sync Error', formatErrorNotification(device, reason, error));
          syncFailed = true;
        } else {
          const result = syncResult.json.result;
          const duration = result ? `${result.duration.toFixed(1)}s` : 'unknown';
          log('info', `Sync completed for ${device.name}`, {
            completed: result?.completed ?? 0,
            failed: result?.failed ?? 0,
            duration,
          });
          await this.notify.notify(
            'Sync Complete',
            formatPostSyncNotification(device, syncResult.json)
          );
        }
      } catch (err) {
        const reason = this._deviceDisconnected ? 'device disconnected' : 'sync';
        const message = err instanceof Error ? err.message : String(err);
        log('error', `Sync threw: ${message}`, {
          deviceDisconnected: this._deviceDisconnected,
        });
        await this.notify.notify('Sync Error', formatErrorNotification(device, reason, message));
        syncFailed = true;
      }

      // Step 4: Eject (always attempt, even after sync failure)
      // If the device was disconnected mid-sync, eject will likely fail too —
      // that's expected and we log it at a lower severity.
      try {
        const ejectResult = await this.cli.runEject(mountPoint);
        if (ejectResult.exitCode !== 0 || !ejectResult.json?.success) {
          const error =
            ejectResult.json?.error ?? ejectResult.stderr.trim() ?? 'Unknown eject error';
          if (this._deviceDisconnected) {
            log('warn', `Eject failed for ${device.name} (device already disconnected): ${error}`);
          } else {
            log('error', `Eject failed for ${device.name}: ${error}`);
            await this.notify.notify('Sync Error', formatErrorNotification(device, 'eject', error));
          }
        } else {
          log('info', `Ejected ${device.name}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (this._deviceDisconnected) {
          log('warn', `Eject threw for ${device.name} (device already disconnected): ${message}`);
        } else {
          log('error', `Eject threw: ${message}`);
          await this.notify.notify('Sync Error', formatErrorNotification(device, 'eject', message));
        }
      }

      const totalSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
      const status = this._deviceDisconnected
        ? 'aborted (device disconnected)'
        : syncFailed
          ? 'completed with errors'
          : 'completed successfully';
      log('info', `Sync cycle ${status} for ${device.name} (${totalSeconds}s)`);
    } finally {
      this._isSyncing = false;
      this._currentDevice = null;
      this._deviceDisconnected = false;
      this._activeSyncChild = null;

      // Process the next queued device, if any
      this.processQueue();
    }
  }

  /**
   * Process the next device in the queue.
   *
   * Called after a sync cycle completes. Fires and forgets — the queued
   * sync will set `_isSyncing` and run through the same full cycle.
   */
  private processQueue(): void {
    if (this._queue.length === 0) return;

    const next = this._queue.shift()!;
    log('info', `Processing queued device: ${next.name}`, {
      disk: next.disk,
      remainingQueue: this._queue.length,
    });
    void this.handleDeviceAppeared(next);
  }

  /**
   * Handle a device disappearance.
   *
   * If the disappeared device is currently being synced, set the
   * disconnected flag so error messages say "device disconnected"
   * instead of a generic I/O error.
   */
  handleDeviceDisappeared(device: DetectedDevice): void {
    if (this._currentDevice && this._currentDevice.name === device.name) {
      log('warn', `Device disconnected mid-sync: ${device.name}`, { disk: device.disk });
      this._deviceDisconnected = true;
    } else {
      // Remove from queue if it was waiting
      const queueIndex = this._queue.findIndex((d) => d.name === device.name);
      if (queueIndex !== -1) {
        this._queue.splice(queueIndex, 1);
        log('info', `Removed queued device (disconnected): ${device.name}`, { disk: device.disk });
      } else {
        log('info', `Device removed: ${device.name}`, { disk: device.disk });
      }
    }
  }
}

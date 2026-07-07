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
import {
  classifyReadiness,
  formatReadinessNotification,
  type DaemonReadiness,
} from './readiness-classifier.js';
import { log } from './logger.js';

/** Notification title for a non-ready, non-error readiness status. */
const READINESS_TITLE: Record<Exclude<DaemonReadiness, 'ready' | 'error'>, string> = {
  'needs-setup': 'Device Needs Setup',
  'needs-init': 'Device Needs Init',
  unsupported: 'Device Not Supported',
};

/**
 * Exit code emitted by `podkit sync` when another podkit process holds the
 * per-device lock. The daemon mirrors the constant rather than importing
 * it from `@podkit/cli` to keep the daemon package's CLI-shell-out
 * decoupling intact.
 *
 * This exit-code detection works only because the daemon invokes the CLI as
 * a subprocess. If the daemon ever switches to an in-process `runSync` call,
 * replace this with a try/catch on `LockHeldError` (and `LockContestedError`).
 */
const SYNC_LOCK_HELD_EXIT_CODE = 4;

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
  /**
   * Resolve a detected device to its registered config name. When it
   * resolves to a name, the sync is invoked by name so the CLI applies
   * per-device settings; when it resolves to `null` (unregistered) or
   * throws, the sync falls back to the mount path with global/ENV
   * settings. When omitted (e.g. the mass-storage lane, which has no
   * identity to resolve), sync is always path-based.
   */
  resolveDeviceName?: (device: DetectedDevice) => Promise<string | null>;
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
  private readonly resolveDeviceName?: SyncOrchestratorOptions['resolveDeviceName'];

  constructor(options: SyncOrchestratorOptions) {
    this.mountBase = options.mountBase ?? '/tmp/podkit';
    this.notify = options.notify ?? { notify: async () => {} };
    this.resolveDeviceName = options.resolveDeviceName;
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

      // Resolve the detected device against the config registry. A match
      // means the CLI is invoked by name so per-device settings apply;
      // otherwise (unregistered, no resolver, or resolution failed) sync
      // stays path-based with global/ENV settings.
      let syncTarget = mountPoint;
      if (this.resolveDeviceName) {
        try {
          const registeredName = await this.resolveDeviceName(device);
          if (registeredName) {
            syncTarget = registeredName;
            log('info', `Device ${device.name} is registered as "${registeredName}"`, {
              uuid: device.uuid,
            });
          } else {
            // Null covers both "genuinely unregistered" and "registry lookup
            // failed" (the resolver warn-logs the latter itself) — so this
            // message stays neutral about which one happened.
            log('info', `No registered device name resolved for ${device.name}, syncing by path`, {
              uuid: device.uuid,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log('warn', `Device registry resolution threw, syncing by path: ${message}`);
        }
      }

      // Step 2: Dry-run preview (for logging + notification)
      try {
        const dryRunResult = await this.cli.runSync(syncTarget, { dryRun: true });
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
          const handle = this.cli.spawnSync(syncTarget);
          this._activeSyncChild = handle.child;
          try {
            syncResult = await handle.result;
          } finally {
            this._activeSyncChild = null;
          }
        } else {
          syncResult = await this.cli.runSync(syncTarget);
        }
        if (syncResult.exitCode === 130) {
          log('info', 'Sync aborted gracefully', { device: device.name });
          // Don't treat as failure — database was saved before exit
        } else if (syncResult.exitCode === SYNC_LOCK_HELD_EXIT_CODE) {
          // Another podkit process holds the per-device sync lock.
          // Skip the cycle cleanly — no retry-spin, no error
          // notification (this isn't a failure mode, just contention).
          const holderPid =
            (syncResult.json as { details?: { holderPid?: number } } | undefined)?.details
              ?.holderPid ?? 'unknown';
          log('info', `daemon: cycle skipped — lock held by pid ${holderPid}`, {
            device: device.name,
          });
        } else if (syncResult.exitCode === 0 || syncResult.exitCode === 2) {
          // 0 = clean success; 2 = ran with item failures (partial-failure).
          // Both produce a success-shape JSON; the daemon logs and notifies
          // either way and surfaces the failed count from the result.
          const result = syncResult.json?.result;
          const duration = result ? `${result.duration.toFixed(1)}s` : 'unknown';
          const completed = result?.completed ?? 0;
          const failed = result?.failed ?? 0;
          if (failed > 0) {
            log('warn', `Sync completed with failures for ${device.name}`, {
              completed,
              failed,
              duration,
            });
          } else {
            log('info', `Sync completed for ${device.name}`, { completed, failed, duration });
          }
          if (syncResult.json) {
            await this.notify.notify(
              'Sync Complete',
              formatPostSyncNotification(device, syncResult.json)
            );
          }
        } else {
          // Exit code 1 (or other non-zero, non-130, non-2): hard command error.
          // Classify the outcome: a device that the CLI refused because it
          // needs setup / init / is unsupported gets a clear, actionable
          // notify-and-skip rather than a generic "sync failed". The daemon
          // never mutates the device — it only reports.
          const readiness = classifyReadiness({
            exitCode: syncResult.exitCode,
            code: syncResult.json?.code,
          });

          if (readiness !== 'ready' && readiness !== 'error') {
            // Expected, non-failure outcome: the CLI refused a device that
            // needs setup/init or is unsupported. Notify-and-skip — NOT marked
            // as a sync failure, so the cycle log doesn't read "completed with
            // errors" for a clean skip.
            const guidance = formatReadinessNotification(device, readiness) ?? '';
            log('warn', `Device ${device.name} not ready (${readiness}); skipping`, {
              code: syncResult.json?.code,
            });
            await this.notify.notify(READINESS_TITLE[readiness], guidance);
          } else {
            const reason = this._deviceDisconnected ? 'device disconnected' : 'sync';
            const error =
              syncResult.json?.error ?? syncResult.stderr.trim() ?? 'Unknown sync error';
            log('error', `Sync failed for ${device.name}: ${error}`, {
              deviceDisconnected: this._deviceDisconnected,
            });
            await this.notify.notify('Sync Error', formatErrorNotification(device, reason, error));
            syncFailed = true;
          }
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

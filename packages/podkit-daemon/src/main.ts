/**
 * podkit-daemon entry point
 *
 * Polls for iPod devices and automatically syncs them by shelling out
 * to the podkit CLI. Designed to run inside a Docker container.
 *
 * Environment variables:
 *   PODKIT_POLL_INTERVAL        - Poll interval in seconds (default: 5)
 *   PODKIT_APPRISE_URL          - Apprise notification URL (reserved for future use)
 *   PODKIT_MASS_STORAGE_PATHS   - Colon or comma separated paths to mass-storage device mount points
 */

import { DevicePoller, scanMassStoragePaths } from './device-poller.js';
import { SyncOrchestrator } from './sync-orchestrator.js';
import { runMount, runSync, spawnSync, runEject, noopMount, noopEject } from './cli-runner.js';
import { createAppriseClient } from './apprise-client.js';
import { log } from './logger.js';

function main(): void {
  const pollInterval = Math.max(1, parseInt(process.env['PODKIT_POLL_INTERVAL'] ?? '5', 10) || 5);
  const appriseUrl = process.env['PODKIT_APPRISE_URL'];

  // Parse mass-storage paths from environment (colon or comma separated)
  const massStoragePaths = [
    ...new Set(
      (process.env['PODKIT_MASS_STORAGE_PATHS'] ?? '')
        .split(/[:,]/)
        .map((p) => p.trim())
        .filter(Boolean)
    ),
  ];

  log('info', 'podkit-daemon starting', {
    pollInterval,
    appriseUrl: appriseUrl ? '(configured)' : '(not configured)',
    massStoragePaths: massStoragePaths.length > 0 ? massStoragePaths : '(none)',
  });

  const notify = createAppriseClient(appriseUrl);

  // iPod poller + orchestrator (always active)
  const poller = new DevicePoller({ interval: pollInterval });
  const orchestrator = new SyncOrchestrator({
    runMount,
    runSync,
    spawnSync,
    runEject,
    notify,
  });

  poller.on('device-appeared', (device) => {
    void orchestrator.handleDeviceAppeared(device);
  });

  poller.on('device-disappeared', (device) => {
    orchestrator.handleDeviceDisappeared(device);
  });

  // Mass-storage poller + orchestrator (only if paths configured)
  let massStoragePoller: DevicePoller | undefined;
  let massStorageOrchestrator: SyncOrchestrator | undefined;

  if (massStoragePaths.length > 0) {
    log('info', 'Mass-storage device paths configured', { paths: massStoragePaths });

    massStoragePoller = new DevicePoller({
      interval: pollInterval,
      scan: async () => scanMassStoragePaths(massStoragePaths),
    });

    massStorageOrchestrator = new SyncOrchestrator({
      runMount: noopMount,
      runSync,
      spawnSync,
      runEject: noopEject,
      notify,
    });

    massStoragePoller.on('device-appeared', (device) => {
      void massStorageOrchestrator!.handleDeviceAppeared(device);
    });

    massStoragePoller.on('device-disappeared', (device) => {
      massStorageOrchestrator!.handleDeviceDisappeared(device);
    });
  }

  // Graceful shutdown — stop polling and abort any in-progress sync.
  // Docker sends SIGTERM with a 10s timeout before SIGKILL, so we forward
  // SIGINT to the sync child process to trigger its graceful drain+save,
  // ensuring the iPod database is saved within the timeout window.
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'Shutting down...');
    poller.stop();
    massStoragePoller?.stop();
    if (orchestrator.isSyncing) {
      log('info', 'Aborting in-progress iPod sync (sending SIGINT to child)...');
      orchestrator.abort();
    }
    if (massStorageOrchestrator?.isSyncing) {
      log('info', 'Aborting in-progress mass-storage sync (sending SIGINT to child)...');
      massStorageOrchestrator.abort();
    }
    const idlePromises = [orchestrator.waitForIdle()];
    if (massStorageOrchestrator) {
      idlePromises.push(massStorageOrchestrator.waitForIdle());
    }
    void Promise.all(idlePromises).then(() => {
      log('info', 'Shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  poller.start();
  massStoragePoller?.start();

  const waitingFor = massStoragePaths.length > 0 ? 'iPod and mass-storage devices' : 'iPod devices';
  log('info', `podkit-daemon running, waiting for ${waitingFor}...`);
}

main();

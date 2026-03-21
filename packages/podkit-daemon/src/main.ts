/**
 * podkit-daemon entry point
 *
 * Polls for iPod devices and automatically syncs them by shelling out
 * to the podkit CLI. Designed to run inside a Docker container.
 *
 * Environment variables:
 *   PODKIT_POLL_INTERVAL  - Poll interval in seconds (default: 5)
 *   PODKIT_APPRISE_URL    - Apprise notification URL (reserved for future use)
 */

import { DevicePoller } from './device-poller.js';
import { SyncOrchestrator } from './sync-orchestrator.js';
import { runMount, runSync, spawnSync, runEject } from './cli-runner.js';
import { createAppriseClient } from './apprise-client.js';
import { log } from './logger.js';

function main(): void {
  const pollInterval = Math.max(1, parseInt(process.env['PODKIT_POLL_INTERVAL'] ?? '5', 10) || 5);
  const appriseUrl = process.env['PODKIT_APPRISE_URL'];

  log('info', 'podkit-daemon starting', {
    pollInterval,
    appriseUrl: appriseUrl ? '(configured)' : '(not configured)',
  });

  const notify = createAppriseClient(appriseUrl);

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
    if (orchestrator.isSyncing) {
      log('info', 'Aborting in-progress sync (sending SIGINT to child)...');
      orchestrator.abort();
    }
    void orchestrator.waitForIdle().then(() => {
      log('info', 'Shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  poller.start();

  log('info', 'podkit-daemon running, waiting for iPod devices...');
}

main();

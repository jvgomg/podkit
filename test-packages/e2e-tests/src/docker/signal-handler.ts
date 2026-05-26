/**
 * Signal handler for graceful container cleanup.
 *
 * Intercepts SIGINT/SIGTERM to stop containers before process exits.
 * This is critical for handling Ctrl+C during test runs.
 */

import { containerRegistry } from './container-registry.js';

let isRegistered = false;
let isShuttingDown = false;

/**
 * Register signal handlers for graceful shutdown.
 *
 * Should be called once at test startup (via preload).
 * Multiple calls are safe (no-op after first).
 */
export function registerSignalHandlers(): void {
  if (isRegistered) return;
  isRegistered = true;

  const shutdown = async (signal: string) => {
    // Prevent double-shutdown
    if (isShuttingDown) return;
    isShuttingDown = true;

    if (!containerRegistry.isEmpty()) {
      console.log(`\n[docker-cleanup] Received ${signal}, cleaning up containers...`);
      await containerRegistry.stopAll();
    }

    // Exit with appropriate code
    // SIGINT = 130, SIGTERM = 143 (128 + signal number)
    const exitCode = signal === 'SIGINT' ? 130 : 143;
    process.exit(exitCode);
  };

  // Handle Ctrl+C
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle kill command
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught exceptions
  process.on('uncaughtException', async (err) => {
    console.error('[docker-cleanup] Uncaught exception:', err);
    if (!containerRegistry.isEmpty()) {
      console.log('[docker-cleanup] Cleaning up containers before exit...');
      await containerRegistry.stopAll();
    }
    process.exit(1);
  });

  // Cleanup on normal exit (belt and suspenders)
  process.on('beforeExit', async () => {
    if (!containerRegistry.isEmpty()) {
      console.log('[docker-cleanup] Process exiting, ensuring container cleanup...');
      await containerRegistry.stopAll();
    }
  });
}

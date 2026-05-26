/**
 * Global test setup preload file.
 *
 * This file is loaded before any test files via bunfig.toml:
 *   [test]
 *   preload = ["./src/setup/preload.ts"]
 *
 * It registers signal handlers for graceful container cleanup.
 */

import { registerSignalHandlers, checkForOrphans, containerRegistry } from '../docker/index.js';

// Register signal handlers immediately
registerSignalHandlers();

// Check for orphans at start (non-blocking warning)
checkForOrphans().catch(() => {
  // Ignore errors (Docker might not be available)
});

// Ensure cleanup on normal process exit
// This catches cases where tests complete but containers weren't cleaned up
process.on('exit', () => {
  // Note: We can't do async cleanup in 'exit' handler,
  // but the signal handlers and beforeExit should have already run.
  // This is just a safety check to log if containers are still registered.
  if (!containerRegistry.isEmpty()) {
    console.warn('[docker-cleanup] Warning: Process exiting with registered containers');
    console.warn('[docker-cleanup] Run "bun run cleanup:docker --force" to clean up');
  }
});

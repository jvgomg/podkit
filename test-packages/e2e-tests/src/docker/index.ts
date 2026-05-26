/**
 * Docker container management for E2E tests.
 *
 * Provides container lifecycle management with:
 * - Automatic labeling for identification
 * - Process-level registry for cleanup on interruption
 * - Signal handlers for graceful shutdown
 * - Orphan container detection and cleanup
 */

export { containerRegistry } from './container-registry.js';
export {
  startContainer,
  stopContainer,
  getContainerPort,
  runDockerCommand,
} from './container-manager.js';
export { registerSignalHandlers } from './signal-handler.js';
export { findTestContainers, cleanupOrphanContainers, checkForOrphans } from './orphan-cleaner.js';
export { LABELS, LABEL_FILTER, CONTAINER_NAME_PREFIX, generateContainerName } from './constants.js';

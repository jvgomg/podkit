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
  type StartContainerOptions,
} from './container-manager.js';
export { launchContainer, type ContainerHandle } from './container.js';
export {
  startNavidromeContainer,
  type NavidromeContainer,
  type NavidromeOptions,
} from './navidrome.js';
export { registerSignalHandlers } from './signal-handler.js';
export { findTestContainers, cleanupOrphanContainers, checkForOrphans } from './orphan-cleaner.js';
export {
  LABELS,
  LABEL_FILTER,
  CONTAINER_NAME_PREFIX,
  NAVIDROME_IMAGE,
  generateContainerName,
} from './constants.js';

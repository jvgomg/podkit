/**
 * Managed container handle — the clean lifecycle layer for tests.
 *
 * Bundles a started container's id, name, port resolution and teardown into a
 * single object so tests stop juggling loose `containerId` / `port` variables.
 * Built on the lower-level {@link startContainer} primitives (which the registry
 * and orphan-cleaner still use directly).
 */

import { execSync } from 'node:child_process';
import {
  startContainer,
  stopContainer,
  getContainerPort,
  type StartContainerOptions,
} from './container-manager.js';

export interface ContainerHandle {
  /** Docker container id. */
  readonly id: string;

  /** Generated (or overridden) container name. */
  readonly name: string;

  /**
   * Resolve the host port mapped to a container port. Works with `-p 0:<port>`
   * dynamic allocation; re-query after {@link restart} since the host port can
   * change.
   */
  hostPort(containerPort: number): Promise<number>;

  /** Restart the container (`docker restart`). The host port may change. */
  restart(): Promise<void>;

  /** Stop the container and unregister it from cleanup tracking. */
  stop(): Promise<void>;
}

/**
 * Start a container and return a managed handle.
 */
export async function launchContainer(options: StartContainerOptions): Promise<ContainerHandle> {
  const { containerId, containerName } = await startContainer(options);

  return {
    id: containerId,
    name: containerName,
    hostPort: (containerPort: number) => getContainerPort(containerId, containerPort),
    restart: async () => {
      execSync(`docker restart ${containerId}`, { stdio: 'ignore', timeout: 30000 });
    },
    stop: () => stopContainer(containerId),
  };
}

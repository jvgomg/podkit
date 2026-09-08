/**
 * Managed container handle — the clean lifecycle layer for tests.
 *
 * Bundles a started container's id, name, port resolution and teardown into a
 * single object so tests stop juggling loose `containerId` / `port` variables.
 * Built on the lower-level {@link startContainer} primitives (which the registry
 * and orphan-cleaner still use directly).
 */

import {
  startContainer,
  stopContainer,
  getContainerPort,
  type StartContainerOptions,
} from './container-manager.js';
import { runContainerCommand } from './runtime.js';

export interface ContainerHandle {
  /** Container id. */
  readonly id: string;

  /** Generated (or overridden) container name. */
  readonly name: string;

  /**
   * Resolve the host port mapped to a container port. Works with `-p <port>`
   * dynamic allocation; re-query after {@link restart}, which may or may not
   * preserve the host port depending on the runtime.
   */
  hostPort(containerPort: number): Promise<number>;

  /**
   * Restart the container. Docker reassigns the host port; rootless Podman on
   * slirp4netns preserves it. Callers must re-query {@link hostPort} rather
   * than assume either.
   */
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
      await runContainerCommand(['restart', containerId]);
    },
    stop: () => stopContainer(containerId),
  };
}

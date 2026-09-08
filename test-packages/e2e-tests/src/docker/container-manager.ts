/**
 * Container manager with automatic tracking and labeling.
 *
 * Wraps container operations to ensure containers are:
 * - Labeled for identification
 * - Registered in the process registry
 * - Cleanable via orphan detection
 */

import { containerRegistry } from './container-registry.js';
import { LABELS, generateContainerName } from './constants.js';
import { hostUserSpec, isRootlessRuntime, runContainerCommand } from './runtime.js';

export interface StartContainerOptions {
  image: string;
  source: string; // Source identifier (e.g., 'subsonic')
  ports?: string[]; // Port mappings: ['4533:4533'], or ['4533'] for a random host port
  volumes?: string[]; // Volume mounts: ['/host:/container:ro']
  env?: string[]; // Environment: ['KEY=value']
  name?: string; // Override generated name
  /**
   * Run the container as the host user when the runtime would otherwise run it
   * as real root. Set this whenever the container writes into a bind-mounted
   * host directory the test later has to delete — see the `--user` block in
   * {@link startContainer}. Leave it off for containers that genuinely need
   * root inside (the docker-loopback harness `mknod`s loop devices).
   */
  runAsHostUser?: boolean;
}

interface StartContainerResult {
  containerId: string;
  containerName: string;
}

/**
 * Run a container-runtime command and return stdout.
 *
 * @deprecated Prefer importing `runContainerCommand` from `./runtime.js`. Kept
 * as an alias because the name is used across the e2e suites.
 */
export const runDockerCommand = runContainerCommand;

/**
 * Start a Docker container with automatic labeling and registration.
 */
export async function startContainer(
  options: StartContainerOptions
): Promise<StartContainerResult> {
  const containerName = options.name ?? generateContainerName(options.source);
  const timestamp = Date.now();

  const args: string[] = [
    'run',
    '-d', // Detached
    '--rm', // Remove on stop
    '--name',
    containerName,

    // Labels for identification
    '--label',
    LABELS.MANAGED,
    '--label',
    LABELS.source(options.source),
    '--label',
    LABELS.startedAt(timestamp),
  ];

  // Under a rootful runtime the container's root is the host's root, so
  // anything it writes into a bind mount is root-owned and the test user cannot
  // remove it afterwards — `navidrome.ts`'s restart wipes its data dir and hit
  // exactly that on CI (EACCES). Rootless runtimes already map container root
  // to the invoking user, and passing --user there would map to a *subuid* and
  // reintroduce the problem, so this is conditional on the probe rather than on
  // the runtime's name.
  if (options.runAsHostUser && !isRootlessRuntime()) {
    const user = hostUserSpec();
    if (user) args.push('--user', user);
  }

  // Add port mappings
  for (const port of options.ports ?? []) {
    args.push('-p', port);
  }

  // Add volume mounts
  for (const volume of options.volumes ?? []) {
    args.push('-v', volume);
  }

  // Add environment variables
  for (const env of options.env ?? []) {
    args.push('-e', env);
  }

  // Image must be last
  args.push(options.image);

  const containerId = (await runContainerCommand(args)).trim();

  // Register for cleanup
  containerRegistry.register(containerId, options.source, containerName);

  return { containerId, containerName };
}

/**
 * Get the host port assigned to a container's exposed port.
 *
 * Useful when starting a container with `-p <containerPort>` to let the runtime
 * pick a free host port, then querying the actual assignment afterwards.
 */
export async function getContainerPort(
  containerId: string,
  containerPort: number
): Promise<number> {
  const output = await runContainerCommand(['port', containerId, String(containerPort)]);
  // Output format: "0.0.0.0:12345\n" or "[::]:12345\n" (or both lines)
  const match = output.match(/:(\d+)/);
  if (!match) {
    throw new Error(
      `Could not determine host port for container ${containerId} port ${containerPort}: ${output.trim()}`
    );
  }
  return parseInt(match[1]!, 10);
}

/**
 * Stop a Docker container and unregister it.
 */
export async function stopContainer(containerId: string): Promise<void> {
  try {
    await runContainerCommand(['stop', containerId]);
  } finally {
    containerRegistry.unregister(containerId);
  }
}

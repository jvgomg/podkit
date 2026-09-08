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
import { runContainerCommand } from './runtime.js';

export interface StartContainerOptions {
  image: string;
  source: string; // Source identifier (e.g., 'subsonic')
  ports?: string[]; // Port mappings: ['4533:4533'], or ['4533'] for a random host port
  volumes?: string[]; // Volume mounts: ['/host:/container:ro']
  env?: string[]; // Environment: ['KEY=value']
  name?: string; // Override generated name
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

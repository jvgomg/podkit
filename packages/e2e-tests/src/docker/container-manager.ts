/**
 * Container manager with automatic tracking and labeling.
 *
 * Wraps Docker operations to ensure containers are:
 * - Labeled for identification
 * - Registered in the process registry
 * - Cleanable via orphan detection
 */

import { spawn } from 'node:child_process';
import { containerRegistry } from './container-registry.js';
import { LABELS, generateContainerName } from './constants.js';

interface StartContainerOptions {
  image: string;
  source: string; // Source identifier (e.g., 'subsonic')
  ports?: string[]; // Port mappings: ['4533:4533']
  volumes?: string[]; // Volume mounts: ['/host:/container:ro']
  env?: string[]; // Environment: ['KEY=value']
  name?: string; // Override generated name
}

interface StartContainerResult {
  containerId: string;
  containerName: string;
}

/**
 * Run a docker command and return stdout
 */
export function runDockerCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Docker command failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

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

  const containerId = (await runDockerCommand(args)).trim();

  // Register for cleanup
  containerRegistry.register(containerId, options.source, containerName);

  return { containerId, containerName };
}

/**
 * Stop a Docker container and unregister it.
 */
export async function stopContainer(containerId: string): Promise<void> {
  try {
    await runDockerCommand(['stop', containerId]);
  } finally {
    containerRegistry.unregister(containerId);
  }
}

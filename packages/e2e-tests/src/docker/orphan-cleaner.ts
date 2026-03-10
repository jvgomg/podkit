/**
 * Orphan container cleaner.
 *
 * Finds and removes containers from previous failed test runs.
 * Uses Docker labels to identify test containers.
 */

import { runDockerCommand } from './container-manager.js';
import { LABEL_FILTER } from './constants.js';

interface OrphanContainer {
  id: string;
  name: string;
  source: string;
  startedAt: Date;
  running: boolean;
}

/**
 * Find all podkit E2E test containers (running or stopped).
 */
export async function findTestContainers(): Promise<OrphanContainer[]> {
  try {
    // List all containers with our label (including stopped)
    const output = await runDockerCommand([
      'ps',
      '-a',
      '--filter',
      LABEL_FILTER,
      '--format',
      '{{.ID}}\t{{.Names}}\t{{.Label "podkit.e2e.source"}}\t{{.Label "podkit.e2e.started"}}\t{{.State}}',
    ]);

    if (!output.trim()) return [];

    return output
      .trim()
      .split('\n')
      .map((line) => {
        const [id, name, source, startedStr, state] = line.split('\t');
        return {
          id: id ?? '',
          name: name ?? '',
          source: source || 'unknown',
          startedAt: new Date(parseInt(startedStr ?? '0', 10) || Date.now()),
          running: state === 'running',
        };
      });
  } catch {
    // Docker might not be running
    return [];
  }
}

/**
 * Clean up all orphaned test containers.
 *
 * @param options.force - Remove even running containers
 * @param options.olderThan - Only remove containers older than this duration (ms)
 * @returns Number of containers removed
 */
export async function cleanupOrphanContainers(
  options: {
    force?: boolean;
    olderThan?: number;
  } = {}
): Promise<number> {
  const containers = await findTestContainers();

  if (containers.length === 0) {
    return 0;
  }

  const now = Date.now();
  const toRemove = containers.filter((c) => {
    // Skip running containers unless force is set
    if (c.running && !options.force) return false;

    // Check age filter
    if (options.olderThan) {
      const age = now - c.startedAt.getTime();
      if (age < options.olderThan) return false;
    }

    return true;
  });

  if (toRemove.length === 0) {
    return 0;
  }

  console.log(`[cleanup] Removing ${toRemove.length} container(s)...`);

  let removed = 0;
  for (const container of toRemove) {
    try {
      // Use 'rm -f' to handle both running and stopped containers
      await runDockerCommand(['rm', '-f', container.id]);
      console.log(`[cleanup] Removed: ${container.name} (${container.source})`);
      removed++;
    } catch (err) {
      console.error(`[cleanup] Failed to remove ${container.name}:`, err);
    }
  }

  return removed;
}

/**
 * Check for and warn about orphaned containers.
 *
 * Useful to run at test start to alert about previous failures.
 */
export async function checkForOrphans(): Promise<void> {
  const containers = await findTestContainers();

  if (containers.length > 0) {
    const running = containers.filter((c) => c.running);
    const stopped = containers.filter((c) => !c.running);

    console.warn(`[docker-cleanup] Warning: Found ${containers.length} orphaned test container(s)`);
    if (running.length > 0) {
      console.warn(
        `[docker-cleanup]   ${running.length} running: ${running.map((c) => c.name).join(', ')}`
      );
    }
    if (stopped.length > 0) {
      console.warn(
        `[docker-cleanup]   ${stopped.length} stopped: ${stopped.map((c) => c.name).join(', ')}`
      );
    }
    console.warn(`[docker-cleanup]   Run 'bun run cleanup:docker' to remove them.`);
  }
}

#!/usr/bin/env bun
/**
 * Manual cleanup script for orphaned test containers.
 *
 * Usage:
 *   bun run cleanup:docker           # Remove stopped containers
 *   bun run cleanup:docker --force   # Remove all test containers (including running)
 *   bun run cleanup:docker --list    # Just list, don't remove
 */

import { cleanupOrphanContainers, findTestContainers } from '../docker/index.js';

const args = process.argv.slice(2);
const force = args.includes('--force') || args.includes('-f');
const listOnly = args.includes('--list') || args.includes('-l');

async function main() {
  if (listOnly) {
    const containers = await findTestContainers();
    if (containers.length === 0) {
      console.log('No test containers found.');
      return;
    }

    console.log(`Found ${containers.length} test container(s):`);
    for (const c of containers) {
      const age = Math.round((Date.now() - c.startedAt.getTime()) / 1000);
      const status = c.running ? 'RUNNING' : 'stopped';
      console.log(`  ${c.name} (${c.source}) - ${status}, age: ${age}s`);
    }
    return;
  }

  const removed = await cleanupOrphanContainers({ force });

  if (removed === 0) {
    console.log('Nothing to clean up.');
  } else {
    console.log(`Cleaned up ${removed} container(s).`);
  }
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});

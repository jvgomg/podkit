/**
 * File-based health check for Docker HEALTHCHECK.
 *
 * The daemon touches a file after each successful poll cycle.
 * Docker's HEALTHCHECK verifies the file's age to determine liveness.
 */

import { writeFileSync, statSync } from 'node:fs';

const DEFAULT_HEALTH_FILE = '/tmp/podkit-daemon-health';

/**
 * Touch the health file to signal a successful poll cycle.
 *
 * Called after each successful `poll()` in DevicePoller (not on error).
 */
export function touchHealthFile(path: string = DEFAULT_HEALTH_FILE): void {
  writeFileSync(path, String(Date.now()), 'utf-8');
}

/**
 * Check whether the health file is fresh enough.
 *
 * @param maxAgeSeconds - Maximum acceptable age of the health file
 * @param path - Path to the health file (default: /tmp/podkit-daemon-health)
 * @returns true if the file exists and was modified within maxAgeSeconds
 */
export function isHealthy(maxAgeSeconds: number, path: string = DEFAULT_HEALTH_FILE): boolean {
  try {
    const stat = statSync(path);
    // Clamp at 0: filesystem mtime resolution can round up so a just-touched
    // file's mtime is briefly in the future relative to Date.now().
    const ageMs = Math.max(0, Date.now() - stat.mtimeMs);
    return ageMs < maxAgeSeconds * 1000;
  } catch {
    // File doesn't exist or can't be read
    return false;
  }
}

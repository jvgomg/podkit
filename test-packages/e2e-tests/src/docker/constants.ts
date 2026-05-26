/**
 * Docker labels and constants for test containers.
 *
 * Labels allow identification of test containers for cleanup,
 * even from previous failed runs.
 */

/** Label prefix for all podkit E2E test containers */
export const LABEL_PREFIX = 'podkit.e2e';

/** Specific labels */
export const LABELS = {
  /** Marks container as a podkit E2E test container */
  MANAGED: `${LABEL_PREFIX}.managed=true`,

  /** Source type (subsonic, etc.) */
  source: (name: string) => `${LABEL_PREFIX}.source=${name}`,

  /** Start timestamp */
  startedAt: (timestamp: number) => `${LABEL_PREFIX}.started=${timestamp}`,
} as const;

/** Container name prefix for easy identification */
export const CONTAINER_NAME_PREFIX = 'podkit-e2e-';

/** Generate a unique container name */
export function generateContainerName(source: string): string {
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `${CONTAINER_NAME_PREFIX}${source}-${randomSuffix}`;
}

/** Label filter for docker ps --filter */
export const LABEL_FILTER = `label=${LABEL_PREFIX}.managed=true`;

/**
 * Test source abstraction for E2E tests
 *
 * Sources provide a uniform interface for different music sources
 * used in E2E testing (directory, Subsonic, etc.)
 */

/**
 * Interface for test music sources
 */
export interface TestSource {
  /** Display name for the source */
  readonly name: string;

  /** Source URL or path for CLI usage */
  readonly sourceUrl: string;

  /** Number of tracks in the source */
  readonly trackCount: number;

  /** Whether this source requires Docker */
  readonly requiresDocker: boolean;

  /**
   * Set up the source (start services, seed data)
   * @returns Promise that resolves when setup is complete
   */
  setup(): Promise<void>;

  /**
   * Tear down the source (stop services, cleanup)
   * @returns Promise that resolves when teardown is complete
   */
  teardown(): Promise<void>;

  /**
   * Check if the source is available
   * (Docker running, directory exists, etc.)
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get environment variables needed for CLI to access this source
   */
  getEnv(): Record<string, string>;
}

/**
 * Result of running a source availability check
 */
export interface SourceAvailabilityResult {
  available: boolean;
  reason?: string;
}

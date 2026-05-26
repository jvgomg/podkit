/**
 * Test source abstraction shared by the e2e-host-tests and e2e-docker-tests
 * packages. Sources provide a uniform interface for different music
 * back-ends used in e2e testing (filesystem directory, Subsonic server,
 * etc.) so workflow tests can be parameterised over them.
 *
 * @module
 */

export interface TestSource {
  /** Display name for the source. */
  readonly name: string;

  /** Source URL or path the CLI consumes. */
  readonly sourceUrl: string;

  /** Number of tracks the source provides. */
  readonly trackCount: number;

  /** True when the source needs a Docker container to be running. */
  readonly requiresDocker: boolean;

  /**
   * Set up the source (start services, seed data). Resolves when the source
   * is ready to serve requests.
   */
  setup(): Promise<void>;

  /**
   * Tear down the source (stop services, cleanup). Safe to call after
   * `setup()` failed mid-way.
   */
  teardown(): Promise<void>;

  /**
   * Check whether the source is available — e.g. Docker running, directory
   * mounted. Used by preflight scripts and by tests that want to short-circuit
   * before invoking the CLI.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Environment variables the CLI needs to access this source (credentials,
   * API endpoint, etc.).
   */
  getEnv(): Record<string, string>;
}

/**
 * Outcome of a source availability check.
 */
export interface SourceAvailabilityResult {
  available: boolean;
  reason?: string;
}

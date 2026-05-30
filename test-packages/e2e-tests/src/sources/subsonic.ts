/**
 * Subsonic test source backed by a Docker Navidrome container.
 *
 * A thin {@link TestSource} adapter over {@link startNavidromeContainer}: it
 * copies the static audio fixtures into a temp library, starts Navidrome, and
 * exposes the source URL / credentials the CLI needs. All container lifecycle
 * and readiness logic lives in the navidrome helper.
 */

import { mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getStaticFixturesRoot } from '@podkit/test-fixtures';
import type { TestSource } from '@podkit/e2e-shared';
import {
  runDockerCommand,
  startNavidromeContainer,
  type NavidromeContainer,
} from '../docker/index.js';

/**
 * Audio fixtures root — the directory containing `goldberg-selections/`,
 * `synthetic-tests/`, and `multi-format/`. Navidrome mounts this and indexes
 * the resulting library.
 */
function getFixturesDir(): string {
  return join(getStaticFixturesRoot(), 'audio');
}

/**
 * Default test credentials.
 *
 * ND_DEVAUTOCREATEADMINPASSWORD always creates a user named 'admin', so the
 * username is fixed regardless of what we'd prefer.
 */
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'testpass';

/**
 * Construction options for {@link SubsonicTestSource}.
 */
export interface SubsonicTestSourceOptions {
  /** Host port for the Navidrome container. Defaults to OS-assigned. */
  port?: number;
  /**
   * Allow callers to mutate files inside the library between syncs (artwork
   * swap, etc.). Required for change-detection tests. Defaults to false, which
   * mounts the music dir read-only.
   */
  writable?: boolean;
  /**
   * Auto-copy the full `@podkit/test-fixtures` audio tree into the library
   * during setup. Defaults to true. Change-detection tests pass false and
   * populate the library themselves via {@link SubsonicTestSource.mutateLibrary}
   * so they only carry the fixtures they actually mutate.
   */
  populate?: boolean;
}

/**
 * Test source using a Docker Navidrome server.
 */
export class SubsonicTestSource implements TestSource {
  readonly name = 'subsonic';
  readonly requiresDocker = true;

  private readonly username_ = DEFAULT_USERNAME;
  private readonly password = DEFAULT_PASSWORD;
  private readonly tempDir: string;
  private readonly musicDir_: string;
  private readonly dataDir: string;
  private readonly writable: boolean;
  private readonly populate: boolean;

  /** Host port — the constructor value is a placeholder until {@link setup}. */
  private port: number;
  private container: NavidromeContainer | null = null;

  constructor(arg?: number | SubsonicTestSourceOptions) {
    const opts: SubsonicTestSourceOptions = typeof arg === 'number' ? { port: arg } : (arg ?? {});
    this.tempDir = join(tmpdir(), `podkit-subsonic-test-${randomUUID()}`);
    this.musicDir_ = join(this.tempDir, 'music');
    this.dataDir = join(this.tempDir, 'data');
    this.port = opts.port ?? 0; // 0 = OS-assigned; replaced with the real port on setup
    this.writable = opts.writable ?? false;
    this.populate = opts.populate ?? true;
  }

  /** Absolute path to the music library on the host — writable iff opts.writable. */
  get musicDir(): string {
    return this.musicDir_;
  }

  get sourceUrl(): string {
    return `subsonic://${this.username_}@localhost:${this.port}`;
  }

  /** HTTP URL for the Subsonic server (for config files). */
  get serverUrl(): string {
    return `http://localhost:${this.port}`;
  }

  get username(): string {
    return this.username_;
  }

  async setup(): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('Docker is not available');
    }

    await mkdir(this.musicDir_, { recursive: true });
    await mkdir(this.dataDir, { recursive: true });

    // Optionally copy the full @podkit/test-fixtures audio tree into
    // Navidrome's library. The inventory grows over time (matrix variants, new
    // album fixtures) and Navidrome additionally filters by codec/metadata, so
    // there's no useful absolute track count to surface — tests assert
    // relationship invariants instead (e.g. iPod trackCount === completed).
    // Change-detection tests skip auto-populate and place their own fixtures
    // via {@link mutateLibrary}.
    if (this.populate) {
      const fixturesPath = getFixturesDir();
      if (existsSync(fixturesPath)) {
        await cp(fixturesPath, this.musicDir_, { recursive: true });
      }
    }

    this.container = await startNavidromeContainer({
      musicDir: this.musicDir_,
      dataDir: this.dataDir,
      password: this.password,
      writable: this.writable,
      // An empty library still needs to come up — don't block startup on a
      // never-arriving album.
      minAlbums: this.populate ? 1 : 0,
    });
    this.port = this.container.port;
  }

  /**
   * Mutate files inside the music library, then force Navidrome to re-index by
   * restarting the container with a fresh database. Requires `writable: true`
   * at construction.
   *
   * The restart is heavyweight (~10-30s) but is the only reliable way to bust
   * Navidrome's artwork cache when source bytes change without their path or
   * metadata fields changing — Subsonic's startScan endpoint can serve stale
   * artwork because the cache is keyed on coverArt ID, which is path-derived.
   */
  async mutateLibrary(
    fn: (musicDir: string) => Promise<void>,
    opts?: { minAlbums?: number }
  ): Promise<void> {
    if (!this.writable) {
      throw new Error('SubsonicTestSource.mutateLibrary requires writable=true at construction');
    }
    if (!this.container) {
      throw new Error('SubsonicTestSource.mutateLibrary called before setup()');
    }
    await fn(this.musicDir_);
    // After a real mutation the library is expected to be non-empty — default
    // to waiting for at least one album rather than inheriting the closure's
    // setup-time minAlbums (which is 0 when populate=false, and would skip
    // the scan-wait entirely, racing the next sync against an unindexed library).
    await this.container.restart({ minAlbums: opts?.minAlbums ?? 1 });
    this.port = this.container.port;
  }

  async teardown(): Promise<void> {
    if (this.container) {
      await this.container.stop();
      this.container = null;
    }

    try {
      await rm(this.tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }

  async isAvailable(): Promise<boolean> {
    return isDockerAvailable();
  }

  getEnv(): Record<string, string> {
    return {
      SUBSONIC_PASSWORD: this.password,
    };
  }
}

/**
 * Check if Docker is available.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await runDockerCommand(['version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a Subsonic test source.
 */
export function createSubsonicSource(arg?: number | SubsonicTestSourceOptions): SubsonicTestSource {
  return new SubsonicTestSource(arg);
}

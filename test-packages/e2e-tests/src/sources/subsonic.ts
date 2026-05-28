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
 * Test source using a Docker Navidrome server.
 */
export class SubsonicTestSource implements TestSource {
  readonly name = 'subsonic';
  readonly requiresDocker = true;

  private readonly username_ = DEFAULT_USERNAME;
  private readonly password = DEFAULT_PASSWORD;
  private readonly tempDir: string;
  private readonly musicDir: string;
  private readonly dataDir: string;

  /** Host port — the constructor value is a placeholder until {@link setup}. */
  private port: number;
  private container: NavidromeContainer | null = null;
  private tracksLoaded = 0;

  constructor(port?: number) {
    this.tempDir = join(tmpdir(), `podkit-subsonic-test-${randomUUID()}`);
    this.musicDir = join(this.tempDir, 'music');
    this.dataDir = join(this.tempDir, 'data');
    this.port = port ?? 0; // 0 = OS-assigned; replaced with the real port on setup
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

  get trackCount(): number {
    return this.tracksLoaded;
  }

  async setup(): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('Docker is not available');
    }

    await mkdir(this.musicDir, { recursive: true });
    await mkdir(this.dataDir, { recursive: true });

    // Copy test fixtures to the music directory:
    //   - goldberg-selections: 3 FLAC files
    //   - synthetic-tests: 3 FLAC files
    //   - multi-format: 8 files (WAV, AIFF, FLAC, ALAC, MP3, AAC, OGG, Opus)
    const fixturesPath = getFixturesDir();
    if (existsSync(fixturesPath)) {
      await cp(fixturesPath, this.musicDir, { recursive: true });
      this.tracksLoaded = 14; // 14 audio files across 3 albums
    }

    this.container = await startNavidromeContainer({
      musicDir: this.musicDir,
      dataDir: this.dataDir,
      password: this.password,
    });
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
export function createSubsonicSource(port?: number): SubsonicTestSource {
  return new SubsonicTestSource(port);
}

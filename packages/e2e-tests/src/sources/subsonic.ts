/**
 * Subsonic test source using Docker Navidrome
 *
 * Starts a Navidrome container with test fixtures for E2E testing.
 * Uses the shared container manager for automatic cleanup on interruption.
 */

import { mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getFixturesDir } from '../helpers/fixtures.js';
import { startContainer, stopContainer, runDockerCommand } from '../docker/index.js';
import type { TestSource } from './types.js';

/**
 * Configuration for the Navidrome Docker container
 */
interface NavidromeConfig {
  port: number;
  musicDir: string;
  dataDir: string;
  username: string;
  password: string;
}

/**
 * Default test credentials
 *
 * Note: ND_DEVAUTOCREATEADMINPASSWORD always creates a user named 'admin',
 * so DEFAULT_USERNAME must be 'admin' regardless of what we'd prefer.
 */
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'testpass';

/**
 * Test source using Docker Navidrome server
 */
export class SubsonicTestSource implements TestSource {
  readonly name = 'subsonic';
  readonly requiresDocker = true;

  private config: NavidromeConfig;
  private containerId: string | null = null;
  private tempDir: string;
  private tracksLoaded = 0;

  constructor(port?: number) {
    this.tempDir = join(tmpdir(), `podkit-subsonic-test-${randomUUID()}`);
    this.config = {
      port: port ?? 4533 + Math.floor(Math.random() * 100),
      musicDir: join(this.tempDir, 'music'),
      dataDir: join(this.tempDir, 'data'),
      username: DEFAULT_USERNAME,
      password: DEFAULT_PASSWORD,
    };
  }

  get sourceUrl(): string {
    return `subsonic://${this.config.username}@localhost:${this.config.port}`;
  }

  /**
   * HTTP URL for the Subsonic server (for config files)
   */
  get serverUrl(): string {
    return `http://localhost:${this.config.port}`;
  }

  /**
   * Username for authentication
   */
  get username(): string {
    return this.config.username;
  }

  get trackCount(): number {
    return this.tracksLoaded;
  }

  async setup(): Promise<void> {
    // Check Docker availability
    if (!(await this.isAvailable())) {
      throw new Error('Docker is not available');
    }

    // Create temp directories
    await mkdir(this.config.musicDir, { recursive: true });
    await mkdir(this.config.dataDir, { recursive: true });

    // Copy test fixtures to music directory
    // Fixtures include:
    //   - goldberg-selections: 3 FLAC files
    //   - synthetic-tests: 3 FLAC files
    //   - multi-format: 8 files (WAV, AIFF, FLAC, ALAC, MP3, AAC, OGG, Opus)
    const fixturesPath = getFixturesDir();
    if (existsSync(fixturesPath)) {
      await cp(fixturesPath, this.config.musicDir, { recursive: true });
      // Total: 14 audio files across 3 albums
      // Note: Navidrome should index all supported formats
      this.tracksLoaded = 14;
    }

    // Start Navidrome container using the container manager
    const result = await startContainer({
      image: 'deluan/navidrome:latest',
      source: 'subsonic',
      ports: [`${this.config.port}:4533`],
      volumes: [`${this.config.musicDir}:/music:ro`, `${this.config.dataDir}:/data`],
      env: [
        // Auto-create admin user with this password (skips first-run wizard)
        // Note: This always creates a user named 'admin', ignoring our username config
        `ND_DEVAUTOCREATEADMINPASSWORD=${this.config.password}`,
        'ND_MUSICFOLDER=/music',
        'ND_DATAFOLDER=/data',
        // Scan library immediately at startup
        'ND_SCANSCHEDULE=@startup',
        'ND_LOGLEVEL=warn',
      ],
    });

    this.containerId = result.containerId;

    // Wait for server to be ready (HTTP + auth)
    await this.waitForServer();

    // Wait for library scan to complete (albums indexed)
    await this.waitForLibraryScan();
  }

  async teardown(): Promise<void> {
    if (this.containerId) {
      await stopContainer(this.containerId);
      this.containerId = null;
    }

    // Clean up temp directory
    try {
      await rm(this.tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  async isAvailable(): Promise<boolean> {
    return isDockerAvailable();
  }

  getEnv(): Record<string, string> {
    return {
      SUBSONIC_PASSWORD: this.config.password,
    };
  }

  /**
   * Wait for Navidrome to finish scanning the library.
   *
   * Navidrome scans asynchronously at startup, so even after the server is
   * ready for auth, the library may not be fully indexed yet. This method
   * polls the getAlbumList2 endpoint until albums are found.
   */
  private async waitForLibraryScan(timeoutMs = 60000): Promise<void> {
    const startTime = Date.now();
    const albumsUrl = `http://localhost:${this.config.port}/rest/getAlbumList2?u=admin&p=${this.config.password}&c=podkit-test&v=1.16.1&f=json&type=alphabeticalByName&size=1`;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(albumsUrl);
        if (response.ok) {
          const data = (await response.json()) as Record<string, unknown>;
          const subsonicResponse = data['subsonic-response'] as Record<string, unknown> | undefined;
          const albumList = subsonicResponse?.albumList2 as Record<string, unknown> | undefined;
          const albums = albumList?.album as unknown[] | undefined;

          if (albums && albums.length > 0) {
            // Library has been scanned - albums found
            return;
          }
        }
      } catch {
        // Request failed, keep trying
      }
      await sleep(500);
    }

    throw new Error(`Navidrome library scan did not complete within ${timeoutMs}ms`);
  }

  private async waitForServer(timeoutMs = 30000): Promise<void> {
    const startTime = Date.now();
    const httpUrl = `http://localhost:${this.config.port}/`;
    // Note: username is always 'admin' due to ND_DEVAUTOCREATEADMINPASSWORD
    const pingUrl = `http://localhost:${this.config.port}/rest/ping?u=admin&p=${this.config.password}&c=podkit-test&v=1.16.1&f=json`;

    while (Date.now() - startTime < timeoutMs) {
      try {
        // First check if HTTP server is responding at all
        const httpResponse = await fetch(httpUrl);
        if (httpResponse.ok || httpResponse.status === 302) {
          // Server is up, now check if auth works (admin user created)
          try {
            const authResponse = await fetch(pingUrl);
            if (authResponse.ok) {
              const data = (await authResponse.json()) as Record<string, unknown>;
              const subsonicResponse = data['subsonic-response'] as
                | Record<string, unknown>
                | undefined;
              if (subsonicResponse?.status === 'ok') {
                // Server is fully ready with admin user
                return;
              }
            }
          } catch {
            // Auth not ready yet, keep waiting
          }
        }
      } catch {
        // Server not ready yet
      }
      await sleep(500);
    }

    throw new Error(`Navidrome server did not start within ${timeoutMs}ms`);
  }
}

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await runDockerCommand(['version']);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a Subsonic test source
 */
export function createSubsonicSource(port?: number): SubsonicTestSource {
  return new SubsonicTestSource(port);
}

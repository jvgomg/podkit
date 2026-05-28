/**
 * Navidrome container helper — the Subsonic back-end used by docker e2e tests.
 *
 * Wraps the generic {@link launchContainer} layer with everything specific to
 * Navidrome: the pinned image, the `ND_*` environment, readiness polling
 * (server up + library scanned), and a fresh-database restart used to bust
 * Navidrome's aggressive artwork cache. Callers populate `musicDir` with their
 * fixtures first, then call {@link startNavidromeContainer}.
 */

import { mkdir, rm } from 'node:fs/promises';
import { launchContainer, type ContainerHandle } from './container.js';
import { NAVIDROME_IMAGE } from './constants.js';

const NAVIDROME_PORT = 4533;

/** ND_DEVAUTOCREATEADMINPASSWORD always names the admin user 'admin'. */
const ADMIN_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'testpass';

export interface NavidromeOptions {
  /** Host directory holding the music library to index (already populated). */
  musicDir: string;

  /** Host directory for Navidrome's database + artwork cache. */
  dataDir: string;

  /**
   * Mount the music directory read-write. Needed by tests that mutate fixtures
   * (e.g. re-embedding artwork) between syncs. Defaults to read-only.
   */
  writable?: boolean;

  /** Container source label suffix for identification. Default `'subsonic'`. */
  label?: string;

  /** Admin password. Default `'testpass'`. */
  password?: string;

  /** Minimum albums to wait for before the scan counts as complete. Default 1. */
  minAlbums?: number;

  /** Library-scan timeout. Default 60000ms. */
  scanTimeoutMs?: number;

  /** Server-readiness timeout. Default 30000ms. */
  serverTimeoutMs?: number;
}

export interface NavidromeContainer {
  /** Current host port (updates after {@link restart}). */
  readonly port: number;

  /** HTTP base URL, e.g. `http://localhost:<port>`. */
  readonly serverUrl: string;

  /** Admin username — always `'admin'`. */
  readonly username: string;

  /** Admin password. */
  readonly password: string;

  /** Environment the podkit CLI needs to reach this source. */
  env(): Record<string, string>;

  /**
   * Restart with a fresh database: clears the data directory, restarts the
   * container, re-resolves the (possibly new) host port, and waits for the
   * server + library scan. This is the reliable way to force Navidrome to serve
   * updated artwork after source files change.
   */
  restart(opts?: { minAlbums?: number }): Promise<void>;

  /** Stop the container. */
  stop(): Promise<void>;
}

/**
 * Start a Navidrome container and wait until it is ready to serve requests.
 */
export async function startNavidromeContainer(opts: NavidromeOptions): Promise<NavidromeContainer> {
  const password = opts.password ?? DEFAULT_PASSWORD;
  const minAlbums = opts.minAlbums ?? 1;
  const scanTimeoutMs = opts.scanTimeoutMs ?? 60000;
  const serverTimeoutMs = opts.serverTimeoutMs ?? 30000;
  // Read-only by default; writable for tests that mutate fixtures between syncs.
  const musicVolume = opts.writable ? `${opts.musicDir}:/music` : `${opts.musicDir}:/music:ro`;

  const handle: ContainerHandle = await launchContainer({
    image: NAVIDROME_IMAGE,
    source: opts.label ?? 'subsonic',
    // Port 0 lets the OS pick a free host port, avoiding conflicts when several
    // Navidrome containers run concurrently.
    ports: [`0:${NAVIDROME_PORT}`],
    volumes: [musicVolume, `${opts.dataDir}:/data`],
    env: [
      `ND_DEVAUTOCREATEADMINPASSWORD=${password}`,
      'ND_MUSICFOLDER=/music',
      'ND_DATAFOLDER=/data',
      'ND_SCANSCHEDULE=@startup',
      'ND_LOGLEVEL=warn',
    ],
  });

  let port = await handle.hostPort(NAVIDROME_PORT);
  await waitForServer(port, password, serverTimeoutMs);
  await waitForLibraryScan(port, password, minAlbums, scanTimeoutMs);

  return {
    get port() {
      return port;
    },
    get serverUrl() {
      return `http://localhost:${port}`;
    },
    username: ADMIN_USERNAME,
    password,
    env() {
      return { SUBSONIC_PASSWORD: password };
    },
    async restart(restartOpts) {
      // Clear the data directory so Navidrome rebuilds from scratch.
      await rm(opts.dataDir, { recursive: true, force: true });
      await mkdir(opts.dataDir, { recursive: true });

      await handle.restart();

      // A `docker restart` with dynamic port allocation reassigns the host port.
      port = await handle.hostPort(NAVIDROME_PORT);
      await waitForServer(port, password, serverTimeoutMs);
      await waitForLibraryScan(port, password, restartOpts?.minAlbums ?? minAlbums, scanTimeoutMs);
    },
    stop() {
      return handle.stop();
    },
  };
}

/**
 * Build a Subsonic REST URL with the shared auth + client params.
 */
function subsonicUrl(
  port: number,
  password: string,
  endpoint: string,
  params: Record<string, string> = {}
): string {
  const search = new URLSearchParams({
    u: ADMIN_USERNAME,
    p: password,
    c: 'podkit-test',
    v: '1.16.1',
    f: 'json',
    ...params,
  });
  return `http://localhost:${port}/rest/${endpoint}?${search.toString()}`;
}

/**
 * Wait for the HTTP server to respond and authenticate the admin user.
 */
async function waitForServer(port: number, password: string, timeoutMs: number): Promise<void> {
  const startTime = Date.now();
  const pingUrl = subsonicUrl(port, password, 'ping');

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(pingUrl);
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const subsonicResponse = data['subsonic-response'] as Record<string, unknown> | undefined;
        if (subsonicResponse?.status === 'ok') {
          return;
        }
      }
    } catch {
      // Server not ready yet — keep polling.
    }
    await sleep(500);
  }

  throw new Error(`Navidrome server did not start within ${timeoutMs}ms`);
}

/**
 * Wait until Navidrome has scanned at least `minAlbums` albums.
 *
 * Navidrome scans asynchronously after startup, so the library may be empty for
 * a moment even once the server answers auth.
 */
async function waitForLibraryScan(
  port: number,
  password: string,
  minAlbums: number,
  timeoutMs: number
): Promise<void> {
  const startTime = Date.now();
  const albumsUrl = subsonicUrl(port, password, 'getAlbumList2', {
    type: 'alphabeticalByName',
    size: '10',
  });

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(albumsUrl);
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const subsonicResponse = data['subsonic-response'] as Record<string, unknown> | undefined;
        const albumList = subsonicResponse?.albumList2 as Record<string, unknown> | undefined;
        const albums = albumList?.album as unknown[] | undefined;
        if (albums && albums.length >= minAlbums) {
          return;
        }
      }
    } catch {
      // Request failed — keep polling.
    }
    await sleep(500);
  }

  throw new Error(`Navidrome library scan did not complete within ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

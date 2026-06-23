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

  /**
   * Return all song IDs in the indexed library.
   *
   * Paginates through all albums via the Subsonic REST API and collects each
   * song's id. Must be called after {@link waitForLibraryScan} completes (i.e.
   * after {@link startNavidromeContainer} or {@link restart} resolves). Useful
   * for building the `songIds` argument to {@link createPlaylist}.
   */
  listSongIds(): Promise<string[]>;

  /**
   * Create a named playlist on the server and return its id.
   *
   * Wraps the Subsonic `createPlaylist` REST endpoint. Pass `songIds: []` to
   * create an **empty** playlist — the endpoint accepts an empty song list and
   * Navidrome creates the playlist with `songCount: 0`.
   *
   * Must be called after the library scan completes (i.e. after
   * {@link startNavidromeContainer} or {@link restart} resolves) so that any
   * song ids provided actually exist on the server.
   *
   * @param name - Display name for the new playlist.
   * @param songIds - Subsonic song ids to include; pass `[]` for an empty playlist.
   * @returns The server-assigned playlist id.
   */
  createPlaylist(name: string, songIds: string[]): Promise<{ id: string }>;

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
    async listSongIds() {
      return listAllSongIds(port, password);
    },
    async createPlaylist(name, songIds) {
      return createSubsonicPlaylist(port, password, name, songIds);
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
  // minAlbums=0 means the caller (typically a writable-mount setup with no
  // initial fixtures) doesn't care about the scan completion — startup is
  // good enough. Return as soon as the server answers, no album poll needed.
  if (minAlbums === 0) return;

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

/**
 * Collect all song ids from the indexed library by paginating through albums.
 *
 * Uses the same `getAlbumList2` → `getAlbum` pattern as the Subsonic adapter
 * so the ids match what the production code sees.
 */
async function listAllSongIds(port: number, password: string): Promise<string[]> {
  const pageSize = 500;
  let offset = 0;
  const ids: string[] = [];

  while (true) {
    const albumsUrl = subsonicUrl(port, password, 'getAlbumList2', {
      type: 'alphabeticalByName',
      size: String(pageSize),
      offset: String(offset),
    });

    const albumsRes = await fetch(albumsUrl);
    if (!albumsRes.ok) {
      throw new Error(`getAlbumList2 failed: HTTP ${albumsRes.status}`);
    }
    const albumsData = (await albumsRes.json()) as Record<string, unknown>;
    const subsonicResponse = albumsData['subsonic-response'] as Record<string, unknown> | undefined;
    const albumList = subsonicResponse?.albumList2 as Record<string, unknown> | undefined;
    const albums = albumList?.album as Array<{ id: string }> | undefined;

    if (!albums || albums.length === 0) break;

    for (const album of albums) {
      const albumUrl = subsonicUrl(port, password, 'getAlbum', { id: album.id });
      const albumRes = await fetch(albumUrl);
      if (!albumRes.ok) {
        throw new Error(`getAlbum(${album.id}) failed: HTTP ${albumRes.status}`);
      }

      const albumData = (await albumRes.json()) as Record<string, unknown>;
      const albumSubsonicResponse = albumData['subsonic-response'] as
        | Record<string, unknown>
        | undefined;
      const fullAlbum = albumSubsonicResponse?.album as
        | { song?: Array<{ id: string }> }
        | undefined;

      if (fullAlbum?.song) {
        for (const song of fullAlbum.song) {
          ids.push(song.id);
        }
      }
    }

    offset += pageSize;
    if (albums.length < pageSize) break;
  }

  return ids;
}

/**
 * Create a named playlist via the Subsonic REST API and return its id.
 *
 * Passes song ids as repeated `songId` query parameters. An empty `songIds`
 * array is valid — Navidrome creates a playlist with `songCount: 0`.
 *
 * Retries on transient 5xx errors (e.g. Navidrome's "file is not a database"
 * SQLite contention that can occur immediately after a library scan).
 */
async function createSubsonicPlaylist(
  port: number,
  password: string,
  name: string,
  songIds: string[]
): Promise<{ id: string }> {
  // Build the URL manually so we can repeat the `songId` parameter for each
  // song — URLSearchParams.append handles the repeated-key case correctly.
  const base = subsonicUrl(port, password, 'createPlaylist', { name });
  const url = new URL(base);
  for (const id of songIds) {
    url.searchParams.append('songId', id);
  }

  const urlString = url.toString();
  const maxAttempts = 5;
  const retryDelayMs = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(urlString);
    if (!response.ok) {
      // Only retry on 5xx errors (transient server issues like SQLite contention).
      // 4xx errors (401/403/404) are client errors and never transient.
      if (response.status >= 500 && attempt < maxAttempts) {
        await sleep(retryDelayMs * attempt);
        continue;
      }
      throw new Error(`createPlaylist failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const subsonicResponse = data['subsonic-response'] as Record<string, unknown> | undefined;

    if (subsonicResponse?.status !== 'ok') {
      // Application-layer Subsonic errors (failed status) are not transient — throw immediately.
      const error = subsonicResponse?.error as { code?: number; message?: string } | undefined;
      const errorMessage = error?.message ?? String(subsonicResponse?.status);
      throw new Error(`createPlaylist failed: ${errorMessage}`);
    }

    const playlist = subsonicResponse.playlist as { id?: string } | undefined;
    if (!playlist?.id) {
      throw new Error('createPlaylist response missing playlist.id');
    }

    return { id: playlist.id };
  }

  // Unreachable, but satisfies TypeScript.
  throw new Error('createPlaylist failed: exhausted retry attempts');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

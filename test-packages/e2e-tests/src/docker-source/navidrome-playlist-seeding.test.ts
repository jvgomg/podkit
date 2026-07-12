/**
 * Docker test: Navidrome playlist-seeding harness
 *
 * Validates that the NavidromeContainer helper's `createPlaylist` and
 * `listSongIds` methods work correctly against a live Navidrome container.
 * This is shared test-infrastructure (no feature code dependency) and is a
 * prerequisite for the playlist-scoped sync e2e tests.
 *
 * To run:
 *   bun run test:e2e:docker
 *   # or targeted:
 *   bun test test-packages/e2e-tests/src/docker-source/navidrome-playlist-seeding.test.ts
 *
 * @tags docker
 */

import { mkdir, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getStaticFixturesRoot } from '@podkit/test-fixtures';
import { startNavidromeContainer, type NavidromeContainer } from '../docker/index.js';
import { isDockerAvailable } from '../sources/subsonic.js';

// =============================================================================
// Test Setup
// =============================================================================

let container: NavidromeContainer | null = null;
let tempDir: string | null = null;

beforeAll(async () => {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    throw new Error('Docker is not available — required for @podkit/e2e-tests docker suite.');
  }

  tempDir = join(tmpdir(), `podkit-playlist-seeding-${randomUUID()}`);
  const musicDir = join(tempDir, 'music');
  const dataDir = join(tempDir, 'data');

  await mkdir(musicDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  // Seed the music library with the standard audio fixtures.
  const fixturesPath = join(getStaticFixturesRoot(), 'audio');
  if (existsSync(fixturesPath)) {
    await cp(fixturesPath, musicDir, { recursive: true });
  }

  console.log('Starting Navidrome container for playlist-seeding tests...');
  container = await startNavidromeContainer({
    musicDir,
    dataDir,
    minAlbums: 1,
  });
  console.log(`Navidrome ready at ${container.serverUrl}`);
}, 120_000);

afterAll(async () => {
  if (container) {
    await container.stop();
    container = null;
  }
  if (tempDir) {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
    tempDir = null;
  }
});

// =============================================================================
// Playlist-seeding harness tests
// =============================================================================

describe('NavidromeContainer playlist seeding', () => {
  describe('listSongIds', () => {
    it('returns at least one song id after the library scan', async () => {
      const ids = await container!.listSongIds();
      expect(ids.length).toBeGreaterThan(0);
      // Ids should be non-empty strings.
      for (const id of ids) {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      }
    });
  });

  describe('createPlaylist — non-empty', () => {
    it('creates a named playlist with a subset of song ids', async () => {
      const allIds = await container!.listSongIds();
      expect(allIds.length).toBeGreaterThan(0);

      // Use up to 3 songs so the test is independent of the total library size.
      const subset = allIds.slice(0, Math.min(3, allIds.length));
      const playlistName = `test-playlist-${randomUUID()}`;

      const { id } = await container!.createPlaylist(playlistName, subset);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      // Verify via getPlaylists that the playlist is listed.
      const playlistsUrl = buildSubsonicUrl(container!.port, container!.password, 'getPlaylists');
      const listRes = await fetch(playlistsUrl);
      expect(listRes.ok).toBe(true);
      const listData = (await listRes.json()) as SubsonicJsonResponse<{
        playlists: { playlist?: Array<{ id: string; name: string; songCount: number }> };
      }>;
      const listed = listData['subsonic-response'].playlists.playlist ?? [];
      const found = listed.find((p) => p.id === id);
      expect(found).toBeDefined();
      expect(found!.name).toBe(playlistName);
      expect(found!.songCount).toBe(subset.length);

      // Verify via getPlaylist that each song id is present in the playlist.
      const playlistUrl = buildSubsonicUrl(container!.port, container!.password, 'getPlaylist', {
        id,
      });
      const detailRes = await fetch(playlistUrl);
      expect(detailRes.ok).toBe(true);
      const detailData = (await detailRes.json()) as SubsonicJsonResponse<{
        playlist: { id: string; songCount: number; entry?: Array<{ id: string }> };
      }>;
      const detail = detailData['subsonic-response'].playlist;
      expect(detail.id).toBe(id);
      expect(detail.songCount).toBe(subset.length);
      const returnedIds = (detail.entry ?? []).map((e) => e.id);
      expect(returnedIds).toEqual(expect.arrayContaining(subset));
      expect(returnedIds.length).toBe(subset.length);
    });
  });

  describe('createPlaylist — empty', () => {
    it('creates a zero-track playlist', async () => {
      const playlistName = `test-empty-playlist-${randomUUID()}`;

      const { id } = await container!.createPlaylist(playlistName, []);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      // Verify via getPlaylist that the playlist exists with zero entries.
      const playlistUrl = buildSubsonicUrl(container!.port, container!.password, 'getPlaylist', {
        id,
      });
      const detailRes = await fetch(playlistUrl);
      expect(detailRes.ok).toBe(true);
      const detailData = (await detailRes.json()) as SubsonicJsonResponse<{
        playlist: { id: string; songCount: number; entry?: Array<{ id: string }> };
      }>;
      const detail = detailData['subsonic-response'].playlist;
      expect(detail.id).toBe(id);
      expect(detail.songCount).toBe(0);
      expect(detail.entry ?? []).toHaveLength(0);
    });
  });
});

// =============================================================================
// Helpers
// =============================================================================

/** Minimal shape of a JSON Subsonic response envelope. */
type SubsonicJsonResponse<T> = {
  'subsonic-response': { status: string } & T;
};

/**
 * Build a Subsonic REST URL using the same auth params as the navidrome helper.
 * Duplicated here (rather than exported from navidrome.ts) so the test stays
 * self-contained and the helper stays internal to the container module.
 */
function buildSubsonicUrl(
  port: number,
  password: string,
  endpoint: string,
  params: Record<string, string> = {}
): string {
  const search = new URLSearchParams({
    u: 'admin',
    p: password,
    c: 'podkit-test',
    v: '1.16.1',
    f: 'json',
    ...params,
  });
  return `http://localhost:${port}/rest/${endpoint}?${search.toString()}`;
}

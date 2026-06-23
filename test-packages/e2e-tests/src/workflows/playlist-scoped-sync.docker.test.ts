/**
 * E2E tests for playlist-scoped Subsonic collections
 *
 * Drives the real `podkit` CLI against a live Navidrome container + a dummy
 * iPod, covering the four e2e scenarios from RFC doc-049 (testing items 5-8):
 *
 *   1. Real playlist sync — only the playlist's tracks land on the device
 *   2. Missing playlist — sync aborts before transfer, nothing transferred
 *   3. Empty playlist headless — aborts non-zero; override with --yes proceeds
 *   4. `collection info` real count — reports OK + track count / MISSING
 *
 * These tests require Docker. The suite throws on module-load if Docker is
 * unavailable, so it appears as a focused failure rather than a silent skip.
 *
 * To run:
 *   bun run test:e2e:docker
 *   # or targeted:
 *   bun test test-packages/e2e-tests/src/workflows/playlist-scoped-sync.docker.test.ts
 *
 * @tags docker
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm, cp, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getStaticFixturesRoot } from '@podkit/test-fixtures';
import { runCli, runCliJson, cleanupTempConfig } from '@podkit/e2e-shared';
import { startNavidromeContainer, type NavidromeContainer } from '../docker/index.js';
import { isDockerAvailable } from '../sources/subsonic.js';
import { withTarget } from '../targets/index.js';

import type { SyncOutput } from 'podkit/types';

// =============================================================================
// Shared state populated in beforeAll
// =============================================================================

let container: NavidromeContainer | null = null;
let tempDir: string | null = null;

/** All song ids in the indexed library — populated in beforeAll. */
let allSongIds: string[] = [];

/**
 * The "Workout" playlist name — a subset of the library. Created in
 * beforeAll so the server has committed it before any test runs.
 */
let workoutPlaylistName = '';
/** How many tracks are in the Workout playlist. */
let workoutTrackCount = 0;
/**
 * Titles of tracks in the Workout playlist — derived from the album-level
 * enumeration (same API path as `listSongIds`). Used for strict identity
 * assertions in Scenario 1 (must match what lands on device by title).
 */
let workoutTrackTitles: string[] = [];
/**
 * Title of a track that is in the library but NOT in the Workout playlist —
 * used to assert it was not transferred (anti-oversync check). Empty string
 * if no complement tracks could be resolved.
 */
let complementTrackTitle = '';

/**
 * The "Empty" playlist name — a playlist with zero tracks. Created in
 * beforeAll for scenario 3.
 */
let emptyPlaylistName = '';

beforeAll(async () => {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    throw new Error('Docker is not available — required for @podkit/e2e-tests docker suite.');
  }

  tempDir = join(tmpdir(), `podkit-playlist-sync-${randomUUID()}`);
  const musicDir = join(tempDir, 'music');
  const dataDir = join(tempDir, 'data');

  await mkdir(musicDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const fixturesPath = join(getStaticFixturesRoot(), 'audio');
  if (existsSync(fixturesPath)) {
    await cp(fixturesPath, musicDir, { recursive: true });
  }

  console.log('Starting Navidrome container for playlist-scoped sync tests...');
  container = await startNavidromeContainer({ musicDir, dataDir, minAlbums: 1 });
  console.log(`Navidrome ready at ${container.serverUrl}`);

  // Collect all song ids so we can build a deterministic subset playlist.
  // Use the container's own listSongIds() which uses the same credentials
  // and port closure as createPlaylist() — avoiding any credential mismatch.
  //
  // CRITICAL: startNavidromeContainer returns after minAlbums are scanned, but
  // the rest of the fixture library keeps scanning in the background. Seeding a
  // playlist mid-scan is unsafe — Navidrome reassigns song ids as the scan
  // progresses, orphaning the playlist's entries (it then resolves to 0 tracks
  // at sync/info time). Wait until the song count is STABLE across consecutive
  // polls before listing ids and creating playlists.
  allSongIds = await waitForStableSongCount(container);

  expect(allSongIds.length).toBeGreaterThan(0);
  // N3: a too-small library causes a cryptic Scenario-1 failure — fail fast here.
  expect(allSongIds.length).toBeGreaterThanOrEqual(2);

  // Resolve every song's title up-front (scan is now settled). Needed to pick a
  // subset whose titles are DISTINCT from the chosen complement title — the
  // fixture library repeats titles across formats/albums ("MP3 Test Track"
  // appears more than once), so a naive "first N / next 1" split can leave the
  // complement title also present in the subset, defeating the absence check.
  const songMap = await fetchAllSongsWithTitles(container.serverUrl, container.password);

  // Choose a strict subset for the Workout playlist (up to half, max 5) plus a
  // complement song whose title does NOT appear in the subset.
  const selection = selectWorkoutSubset(allSongIds, songMap);
  const workoutSongIds = selection.workoutSongIds;
  workoutTrackCount = workoutSongIds.length;
  // Expected on-device titles — a MULTISET (duplicates preserved): every track
  // the playlist holds must land, including same-titled tracks from different
  // formats. Scenario 1 compares sorted arrays, so duplicates are significant.
  workoutTrackTitles = workoutSongIds.map((id) => songMap.get(id) ?? '');
  complementTrackTitle = selection.complementTitle;

  // Create playlists upfront so Navidrome's SQLite WAL has committed them
  // before any test runs. Creating them inside each test would race against
  // Navidrome's getPlaylists returning stale data.
  workoutPlaylistName = `Workout-${randomUUID()}`;
  emptyPlaylistName = `Empty-${randomUUID()}`;

  const { id: workoutPlaylistId } = await container.createPlaylist(
    workoutPlaylistName,
    workoutSongIds
  );
  await container.createPlaylist(emptyPlaylistName, []);

  // Verify that getPlaylists returns our newly-created playlists. This
  // catches any Navidrome WAL or timing issues before the tests start.
  const playlistVisibilityCheck = await verifyPlaylistsVisible(
    container.serverUrl,
    container.password,
    [workoutPlaylistName, emptyPlaylistName]
  );
  if (!playlistVisibilityCheck.ok) {
    throw new Error(
      `Playlists not visible via getPlaylists after creation — got: [${playlistVisibilityCheck.found.join(', ')}]. ` +
        `This is a test-infrastructure timing issue, not a product bug.`
    );
  }

  // The name being visible via getPlaylists does NOT guarantee the playlist's
  // ENTRIES are committed — Navidrome can return the playlist row before its
  // songs land (SQLite WAL). Poll getPlaylist(id) until the Workout playlist
  // reports its full track count, otherwise scenarios 1/4 flake (the playlist
  // resolves to 0 tracks → empty-guard aborts the "real sync" / info shows 0).
  const trackCountReady = await waitForPlaylistTrackCount(
    container.serverUrl,
    container.password,
    workoutPlaylistId,
    workoutTrackCount
  );
  if (!trackCountReady.ok) {
    throw new Error(
      `Workout playlist entries not committed after creation — expected ${workoutTrackCount} tracks, ` +
        `saw ${trackCountReady.lastCount}. This is a test-infrastructure timing issue, not a product bug.`
    );
  }

  console.log(
    `Library: ${allSongIds.length} songs | ` +
      `Workout playlist "${workoutPlaylistName}": ${workoutTrackCount} tracks ` +
      `[${workoutTrackTitles.join(', ')}] | ` +
      `Empty playlist "${emptyPlaylistName}": 0 tracks | ` +
      `Complement track (must stay off device): "${complementTrackTitle}" | ` +
      `Playlist visibility check: OK (found ${playlistVisibilityCheck.found.length} playlists)`
  );
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
// Config helpers
// =============================================================================

/**
 * Write a temporary podkit config with a playlist-scoped subsonic collection.
 *
 * `allowEmptyPlaylist` is a top-level config key (read from `parsed.allowEmptyPlaylist`
 * by the config loader) and must NOT be placed inside `[defaults]`.
 */
async function createPlaylistConfig(
  serverUrl: string,
  username: string,
  playlistName: string,
  opts?: { allowEmptyPlaylist?: boolean }
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'podkit-playlist-config-'));
  const configPath = join(dir, 'config.toml');

  // S1: allowEmptyPlaylist is a top-level key — emit it BEFORE the first table
  // header so TOML parses it at the root level, not inside [defaults].
  const allowLine = opts?.allowEmptyPlaylist ? 'allowEmptyPlaylist = true\n\n' : '';

  const content = `version = 2

${allowLine}[music.workout]
type = "subsonic"
url = "${serverUrl}"
username = "${username}"
playlist = "${playlistName}"

[defaults]
music = "workout"
`;

  await writeFile(configPath, content);
  return configPath;
}

// =============================================================================
// Scenario 1: Real playlist sync
// =============================================================================

describe('playlist-scoped sync', () => {
  describe('scenario 1: real playlist sync', () => {
    it('syncs only playlist tracks to device, leaving non-playlist tracks absent', async () => {
      await withTarget(async (target) => {
        // Device starts empty.
        expect(await target.getTrackCount()).toBe(0);

        const configPath = await createPlaylistConfig(
          container!.serverUrl,
          container!.username,
          workoutPlaylistName
        );
        try {
          const result = await runCli(
            ['--config', configPath, 'sync', '--device', target.path, '--json'],
            { env: container!.env(), timeout: 180_000 }
          );

          // Use splitJsonObjects because the sync command emits one JSON blob per
          // collection result plus a summary; JSON.parse of the full stdout fails.
          const jsonBlobs = splitJsonObjects(result.stdout);
          const summary = jsonBlobs[jsonBlobs.length - 1] as SyncOutput | undefined;

          expect(result.exitCode).toBe(0);
          expect(summary?.success).toBe(true);

          // B1 (1): Exact count — only the playlist subset must land, not more.
          const onDevice = await target.getTrackCount();
          expect(onDevice).toBe(workoutTrackCount);

          // Completed count in the summary must match what the device holds.
          expect(summary?.result?.completed).toBe(onDevice);

          // B1 (2): Identity check — the on-device track titles must exactly
          // match the expected playlist subset titles (derived in beforeAll from
          // the same getAlbumList2→getAlbum enumeration the adapter uses).
          const onDeviceTracks = await target.getTracks();
          const onDeviceTitles = onDeviceTracks.map((t) => t.title).sort();
          const expectedTitles = [...workoutTrackTitles].sort();
          expect(onDeviceTitles).toEqual(expectedTitles);

          // B1 (3): Anti-oversync — a known non-playlist track must be ABSENT.
          if (complementTrackTitle) {
            expect(onDeviceTitles).not.toContain(complementTrackTitle);
          }

          console.log(
            `Playlist sync: ${onDevice} of ${allSongIds.length} library tracks on device ` +
              `(playlist size: ${workoutTrackCount}, titles: [${onDeviceTitles.join(', ')}])`
          );
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    }, 300_000);
  });

  // ===========================================================================
  // Scenario 2: Missing playlist aborts
  // ===========================================================================

  describe('scenario 2: missing playlist aborts before transfer', () => {
    it('exits non-zero and leaves device empty when playlist does not exist', async () => {
      await withTarget(async (target) => {
        expect(await target.getTrackCount()).toBe(0);

        const configPath = await createPlaylistConfig(
          container!.serverUrl,
          container!.username,
          // A name that is guaranteed not to exist on the server.
          `PlaylistThatDoesNotExist-${randomUUID()}`
        );
        try {
          const result = await runCli(
            ['--config', configPath, 'sync', '--device', target.path, '--json'],
            { env: container!.env(), timeout: 60_000 }
          );

          // Must exit non-zero — playlist not found makes the collection fail.
          expect(result.exitCode).not.toBe(0);

          // Device must remain untouched — nothing was transferred.
          expect(await target.getTrackCount()).toBe(0);

          // The sync emits one pretty-printed JSON object per collection
          // followed by a top-level summary object. Split the concatenated
          // stdout into individual payloads.
          const jsonBlobs = splitJsonObjects(result.stdout);
          expect(jsonBlobs.length).toBeGreaterThanOrEqual(2);

          // First blob is the per-collection result with the playlist error.
          const perCollResult = jsonBlobs[0] as {
            success?: boolean;
            error?: string;
          };
          expect(perCollResult.success).toBe(false);
          expect(perCollResult.error).toBeDefined();
          // The error message must reference a playlist resolution failure.
          expect(perCollResult.error!.toLowerCase()).toContain('playlist');

          // Last blob is the run-wide summary — zero completed.
          const summary = jsonBlobs[jsonBlobs.length - 1] as {
            result?: { completed?: number; failed?: number };
          };
          expect(summary.result?.completed ?? 0).toBe(0);

          console.log(
            'Missing playlist: exit',
            result.exitCode,
            '— error:',
            perCollResult.error?.slice(0, 80)
          );
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    }, 120_000);
  });

  // ===========================================================================
  // Scenario 3: Empty playlist headless — aborts; --yes / config overrides
  // ===========================================================================

  describe('scenario 3: empty playlist headless guard', () => {
    it('aborts non-zero when playlist is empty and device is untouched', async () => {
      await withTarget(async (target) => {
        expect(await target.getTrackCount()).toBe(0);

        // The CLI runner spawns without a TTY (stdio: pipe), so `out.isTty`
        // is false — this is the headless path that should abort.
        const configPath = await createPlaylistConfig(
          container!.serverUrl,
          container!.username,
          emptyPlaylistName
        );
        try {
          const result = await runCli(
            ['--config', configPath, 'sync', '--device', target.path, '--json'],
            { env: container!.env(), timeout: 60_000 }
          );

          // Must exit non-zero — headless empty-playlist guard aborts.
          expect(result.exitCode).not.toBe(0);

          // Device remains empty — nothing was transferred.
          expect(await target.getTrackCount()).toBe(0);

          // B2: The EMPTY_PLAYLIST_ABORT CliError propagates to the top-level
          // JSON envelope as a SINGLE blob. Parse unconditionally — the code
          // assertion must not be skippable under any output variation.
          // splitJsonObjects handles the unlikely case of stray prefix output.
          const jsonBlobs = splitJsonObjects(result.stdout);
          expect(jsonBlobs.length).toBeGreaterThanOrEqual(1);
          const topLevel = jsonBlobs[jsonBlobs.length - 1] as {
            success?: boolean;
            code?: string;
          };
          expect(topLevel.success).toBe(false);
          expect(topLevel.code).toBe('EMPTY_PLAYLIST_ABORT');

          console.log('Empty playlist headless: exit code', result.exitCode, '(expected non-zero)');
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    }, 120_000);

    it('proceeds and syncs (zero tracks) when --yes overrides the empty playlist guard', async () => {
      await withTarget(async (target) => {
        expect(await target.getTrackCount()).toBe(0);

        const configPath = await createPlaylistConfig(
          container!.serverUrl,
          container!.username,
          emptyPlaylistName
        );
        try {
          const { result, json } = await runCliJson<SyncOutput>(
            // --yes overrides the empty-playlist guard; --json ensures headless path.
            ['--config', configPath, 'sync', '--device', target.path, '--yes', '--json'],
            { env: container!.env(), timeout: 120_000 }
          );

          // Should succeed — the override allows syncing an empty playlist.
          expect(result.exitCode).toBe(0);
          expect(json?.success).toBe(true);
          // Zero tracks completed (empty playlist = nothing to add).
          expect(json?.result?.completed ?? 0).toBe(0);

          // Device stays empty (empty playlist = nothing to add).
          expect(await target.getTrackCount()).toBe(0);

          console.log('Empty playlist --yes: exit code', result.exitCode, '(expected 0)');
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    }, 120_000);

    it('proceeds when allowEmptyPlaylist = true in config (no --yes flag)', async () => {
      await withTarget(async (target) => {
        expect(await target.getTrackCount()).toBe(0);

        // S1: Config-file override path — allowEmptyPlaylist at top level.
        // No --yes flag is passed; the config key alone must permit the sync.
        const configPath = await createPlaylistConfig(
          container!.serverUrl,
          container!.username,
          emptyPlaylistName,
          { allowEmptyPlaylist: true }
        );
        try {
          const { result, json } = await runCliJson<SyncOutput>(
            ['--config', configPath, 'sync', '--device', target.path, '--json'],
            { env: container!.env(), timeout: 120_000 }
          );

          // Must succeed — config-level override engaged.
          expect(result.exitCode).toBe(0);
          expect(json?.success).toBe(true);
          // Empty playlist means zero tracks transferred.
          expect(json?.result?.completed ?? 0).toBe(0);

          // Device stays empty.
          expect(await target.getTrackCount()).toBe(0);

          console.log('Empty playlist config override: exit code', result.exitCode, '(expected 0)');
        } finally {
          await cleanupTempConfig(configPath);
        }
      });
    }, 120_000);
  });

  // ===========================================================================
  // Scenario 4: collection info real count
  // ===========================================================================

  describe('scenario 4: collection info playlist status', () => {
    it('reports OK with correct track count for a resolved playlist (text output)', async () => {
      const configPath = await createPlaylistConfig(
        container!.serverUrl,
        container!.username,
        workoutPlaylistName
      );
      try {
        const result = await runCli(
          ['--config', configPath, 'collection', 'info', '-c', 'workout'],
          { env: container!.env(), timeout: 60_000 }
        );

        expect(result.exitCode).toBe(0);
        // Text output must mention the playlist name and show OK status.
        expect(result.stdout).toContain(workoutPlaylistName);
        // N2: tighten the OK assertion — must include the track count.
        expect(result.stdout).toMatch(/OK,\s*\d+\s*track/);
        // Track count appears as "<N> track" or "<N> tracks".
        expect(result.stdout).toMatch(/\d+\s+track/);

        console.log('collection info OK:', result.stdout.trim().split('\n').slice(-3).join(' | '));
      } finally {
        await cleanupTempConfig(configPath);
      }
    }, 60_000);

    it('reports MISSING when the playlist does not exist on the server', async () => {
      const missingName = `PlaylistThatDoesNotExist-${randomUUID()}`;

      const configPath = await createPlaylistConfig(
        container!.serverUrl,
        container!.username,
        missingName
      );
      try {
        const result = await runCli(
          ['--config', configPath, 'collection', 'info', '-c', 'workout'],
          { env: container!.env(), timeout: 60_000 }
        );

        // collection info exits 0 even when the playlist is MISSING — it's a
        // diagnostic display command, not a sync. Status is shown in the text.
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain(missingName);
        expect(result.stdout).toContain('MISSING');

        console.log(
          'collection info MISSING:',
          result.stdout.trim().split('\n').slice(-3).join(' | ')
        );
      } finally {
        await cleanupTempConfig(configPath);
      }
    }, 60_000);

    it('reports OK + correct count via --json output', async () => {
      const configPath = await createPlaylistConfig(
        container!.serverUrl,
        container!.username,
        workoutPlaylistName
      );
      try {
        const { result, json } = await runCliJson<{
          success: boolean;
          collections?: Array<{
            name: string;
            type: string;
            playlist?: string;
            playlistStatus?: string;
            playlistTrackCount?: number;
          }>;
        }>(['--config', configPath, 'collection', 'info', '-c', 'workout', '--json'], {
          env: container!.env(),
          timeout: 60_000,
        });

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);

        const col = json?.collections?.find((c) => c.name === 'workout');
        expect(col).toBeDefined();
        expect(col!.playlist).toBe(workoutPlaylistName);
        expect(col!.playlistStatus).toBe('OK');
        // S2: Pin to the exact seeded playlist size rather than just > 0.
        expect(col!.playlistTrackCount).toBe(workoutTrackCount);

        console.log(
          `collection info JSON: playlistStatus=${col!.playlistStatus}, ` +
            `trackCount=${col!.playlistTrackCount}`
        );
      } finally {
        await cleanupTempConfig(configPath);
      }
    }, 60_000);
  });
});

// =============================================================================
// Infrastructure: verify Docker gate works
// =============================================================================

describe('Docker gate', () => {
  it('Docker is available (this suite only runs when Docker is present)', async () => {
    const available = await isDockerAvailable();
    expect(available).toBe(true);
  });
});

// =============================================================================
// Local helpers
// =============================================================================

/**
 * Split a string containing multiple concatenated pretty-printed JSON objects
 * into an array of parsed objects.
 *
 * The sync command emits one JSON payload per collection result followed by a
 * run-wide summary, all pretty-printed and concatenated on stdout. A simple
 * `JSON.parse` of the whole string fails because multiple root-level objects
 * are not valid JSON. This helper tokenises by top-level `{` / `}` boundaries
 * to recover each individual payload.
 */
function splitJsonObjects(text: string): unknown[] {
  const results: unknown[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          results.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // Ignore malformed fragments.
        }
        start = -1;
      }
    }
  }

  return results;
}

/**
 * Enumerate all songs in the Navidrome library with their titles.
 *
 * Uses the same `getAlbumList2` → `getAlbum` pagination pattern as
 * {@link NavidromeContainer.listSongIds} so the returned song IDs match
 * exactly what the subsonic adapter and `listSongIds` see. Extends that
 * pattern to also capture each song's `title` field, allowing Scenario 1
 * to build the expected track identity set from the same source of truth
 * that the adapter uses — without relying on the `getSong` endpoint (which
 * Navidrome rejects for album-scoped internal song IDs).
 *
 * @returns A Map from Subsonic song id → song title (title may be '' if
 *   Navidrome omits the field, but in practice all test fixtures have one).
 */
async function fetchAllSongsWithTitles(
  serverUrl: string,
  password: string
): Promise<Map<string, string>> {
  const songMap = new Map<string, string>();
  const pageSize = 500;
  let offset = 0;

  while (true) {
    const albumsParams = new URLSearchParams({
      u: 'admin',
      p: password,
      c: 'podkit-test',
      v: '1.16.1',
      f: 'json',
      type: 'alphabeticalByName',
      size: String(pageSize),
      offset: String(offset),
    });
    const albumsUrl = `${serverUrl}/rest/getAlbumList2?${albumsParams.toString()}`;
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
      const albumParams = new URLSearchParams({
        u: 'admin',
        p: password,
        c: 'podkit-test',
        v: '1.16.1',
        f: 'json',
        id: album.id,
      });
      const albumUrl = `${serverUrl}/rest/getAlbum?${albumParams.toString()}`;
      const albumRes = await fetch(albumUrl);
      if (!albumRes.ok) {
        throw new Error(`getAlbum(${album.id}) failed: HTTP ${albumRes.status}`);
      }
      const albumData = (await albumRes.json()) as Record<string, unknown>;
      const albumSubsonicResponse = albumData['subsonic-response'] as
        | Record<string, unknown>
        | undefined;
      const fullAlbum = albumSubsonicResponse?.album as
        | { song?: Array<{ id: string; title?: string }> }
        | undefined;

      if (fullAlbum?.song) {
        for (const song of fullAlbum.song) {
          songMap.set(song.id, song.title ?? '');
        }
      }
    }

    offset += pageSize;
    if (albums.length < pageSize) break;
  }

  return songMap;
}

/**
 * Verify that a set of playlist names are visible via `getPlaylists` —
 * the same endpoint the subsonic adapter uses to resolve a playlist by name.
 *
 * Called in `beforeAll` immediately after creating the test playlists to
 * catch any Navidrome WAL or timing issues before the tests start running.
 * If this check fails, the test suite fails with a clear setup error rather
 * than a confusing "PlaylistNotFoundError" deep in a sync test.
 */
async function verifyPlaylistsVisible(
  serverUrl: string,
  password: string,
  expectedNames: string[]
): Promise<{ ok: boolean; found: string[] }> {
  const params = new URLSearchParams({
    u: 'admin',
    p: password,
    c: 'podkit-test',
    v: '1.16.1',
    f: 'json',
  });
  const url = `${serverUrl}/rest/getPlaylists?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    return { ok: false, found: [] };
  }
  const data = (await response.json()) as Record<string, unknown>;
  const subsonicResponse = data['subsonic-response'] as Record<string, unknown> | undefined;
  const playlists = (subsonicResponse?.playlists as Record<string, unknown>)?.playlist as
    | Array<{ name: string }>
    | undefined;
  const found = (playlists ?? []).map((p) => p.name);
  const ok = expectedNames.every((name) => found.includes(name));
  return { ok, found };
}

/**
 * Poll listSongIds() until the library song count is stable across two
 * consecutive reads — i.e. Navidrome's background scan has settled. Returns the
 * final, stable id list. Without this, ids captured mid-scan get reassigned as
 * the scan progresses, orphaning any playlist seeded from them.
 */
async function waitForStableSongCount(
  c: NavidromeContainer,
  attempts = 30,
  delayMs = 1000
): Promise<string[]> {
  let previous = -1;
  let ids = await c.listSongIds();
  for (let i = 0; i < attempts; i++) {
    if (ids.length > 0 && ids.length === previous) {
      return ids;
    }
    previous = ids.length;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    ids = await c.listSongIds();
  }
  // Settled or not, return the last read; the count-stability is best-effort.
  return ids;
}

/**
 * Pick the Workout playlist's song subset plus a complement song whose title is
 * NOT present in the subset.
 *
 * The fixture library repeats titles across audio formats/albums (e.g. several
 * "MP3 Test Track" rows). A naive "first N as subset, next 1 as complement"
 * split can choose a complement whose title also appears in the subset, which
 * silently defeats Scenario 1's anti-oversync absence assertion. This selector:
 *
 *   1. Walks song ids in order, adding each to the subset (max 5, at most half
 *      the library) while tracking the set of subset titles.
 *   2. Scans the remaining songs for the FIRST one whose title is not already a
 *      subset title — that becomes the complement.
 *
 * If no distinctly-titled complement exists (a library where every title is in
 * the subset), `complementTitle` is '' and Scenario 1 skips the title-absence
 * check, falling back to the exact-count guarantee (still a strict-subset proof).
 */
function selectWorkoutSubset(
  songIds: string[],
  songMap: Map<string, string>
): { workoutSongIds: string[]; complementTitle: string } {
  const maxSubset = Math.max(1, Math.min(Math.floor(songIds.length / 2), 5));
  const workoutSongIds = songIds.slice(0, maxSubset);
  const subsetTitles = new Set(workoutSongIds.map((id) => songMap.get(id) ?? ''));

  let complementTitle = '';
  for (const id of songIds.slice(maxSubset)) {
    const title = songMap.get(id) ?? '';
    if (title && !subsetTitles.has(title)) {
      complementTitle = title;
      break;
    }
  }

  return { workoutSongIds, complementTitle };
}

/**
 * Poll getPlaylist(id) until the playlist reports the expected number of
 * entries (or attempts are exhausted). Guards against Navidrome returning a
 * playlist row before its songs are committed (SQLite WAL), which otherwise
 * makes a freshly-seeded playlist resolve to 0 tracks at sync/info time.
 */
async function waitForPlaylistTrackCount(
  serverUrl: string,
  password: string,
  playlistId: string,
  expectedCount: number,
  attempts = 20,
  delayMs = 500
): Promise<{ ok: boolean; lastCount: number }> {
  let lastCount = -1;
  for (let i = 0; i < attempts; i++) {
    const params = new URLSearchParams({
      u: 'admin',
      p: password,
      c: 'podkit-test',
      v: '1.16.1',
      f: 'json',
      id: playlistId,
    });
    const response = await fetch(`${serverUrl}/rest/getPlaylist?${params.toString()}`);
    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>;
      const subsonicResponse = data['subsonic-response'] as Record<string, unknown> | undefined;
      const playlist = subsonicResponse?.playlist as Record<string, unknown> | undefined;
      const entries = (playlist?.entry as unknown[] | undefined) ?? [];
      lastCount = entries.length;
      if (lastCount >= expectedCount) {
        return { ok: true, lastCount };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return { ok: false, lastCount };
}

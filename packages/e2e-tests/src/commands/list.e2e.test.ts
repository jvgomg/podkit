/* eslint-disable no-console */
/**
 * E2E tests for the `podkit list` command.
 *
 * Tests listing tracks in different formats, from iPod and source directory.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { runCli, runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { areFixturesAvailable, Albums, getAlbumDir } from '../helpers/fixtures';

interface ListTrack {
  title: string;
  artist: string;
  album: string;
  duration?: number;
  durationFormatted?: string;
}

describe('podkit list', () => {
  let fixturesAvailable: boolean;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
  });

  describe('from iPod', () => {
    it('lists tracks in table format', async () => {
      await withTarget(async (target) => {
        // Empty iPod should show "No tracks found"
        const result = await runCli(['list', '--device', target.path]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('No tracks found');
      });
    });

    it('outputs JSON with --json flag', async () => {
      await withTarget(async (target) => {
        const { result, json } = await runCliJson<ListTrack[]>([
          'list',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(Array.isArray(json)).toBe(true);
        expect(json?.length).toBe(0);
      });
    });

    it('outputs JSON with --format json', async () => {
      await withTarget(async (target) => {
        const { result, json } = await runCliJson<ListTrack[]>([
          'list',
          '--device',
          target.path,
          '--format',
          'json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(Array.isArray(json)).toBe(true);
      });
    });

    it('outputs CSV with --format csv', async () => {
      await withTarget(async (target) => {
        const result = await runCli([
          'list',
          '--device',
          target.path,
          '--format',
          'csv',
        ]);

        expect(result.exitCode).toBe(0);
        // CSV header should be present
        expect(result.stdout).toContain('Title,Artist,Album,Duration');
      });
    });
  });

  describe('from source directory', () => {
    it('lists tracks from source with --source', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
      const result = await runCli(['list', '--source', sourcePath]);

      expect(result.exitCode).toBe(0);
      // Should show track titles from fixtures
      expect(result.stdout).toContain('Harmony');
      expect(result.stdout).toContain('Vibrato');
      expect(result.stdout).toContain('Tremolo');
    });

    it('outputs JSON from source', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
      const { result, json } = await runCliJson<ListTrack[]>([
        'list',
        '--source',
        sourcePath,
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      expect(Array.isArray(json)).toBe(true);
      expect(json?.length).toBe(3);

      // Check track data
      const titles = json?.map((t) => t.title) ?? [];
      expect(titles).toContain('Harmony');
      expect(titles).toContain('Vibrato');
      expect(titles).toContain('Tremolo');
    });

    it('shows custom fields with --fields', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);
      const result = await runCli([
        'list',
        '--source',
        sourcePath,
        '--fields',
        'title,year,genre',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Title');
      expect(result.stdout).toContain('Year');
      expect(result.stdout).toContain('Genre');
    });
  });

  describe('error handling', () => {
    it('fails when neither device nor source specified', async () => {
      // Use non-existent config to ensure we don't pick up user's config file
      const result = await runCli(['--config', '/nonexistent/config.toml', 'list']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No iPod device specified');
    });

    it('fails when source directory does not exist', async () => {
      const result = await runCli(['list', '--source', '/nonexistent/path']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    it('outputs error in JSON format', async () => {
      const { result, json } = await runCliJson<{ error: boolean; message: string }>([
        'list',
        '--source',
        '/nonexistent/path',
        '--json',
      ]);

      expect(result.exitCode).toBe(1);
      expect(json?.error).toBe(true);
      expect(json?.message).toContain('not found');
    });
  });
});

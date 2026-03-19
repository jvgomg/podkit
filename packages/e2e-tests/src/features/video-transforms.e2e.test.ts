/**
 * E2E tests for video transforms (showLanguage) and filename parsing.
 *
 * Tests the full video transform pipeline from config through to iPod metadata:
 * - Video filename parsing (Plex naming, anime fansub, scene release cleanup)
 * - showLanguage transform toggle workflow (enable → sync → change format → sync)
 * - Dry-run output shows video transform info
 *
 * These tests use the compatible H.264 video fixture, organized into
 * Plex-standard folder structures with language markers.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp, rm, cp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import {
  areVideoFixturesAvailable,
  cleanupVideoSourceDir,
  Videos,
  getVideoPath,
} from '../helpers/video-fixtures';

// =============================================================================
// Test Fixture Helpers
// =============================================================================

/**
 * Create a video source directory organized with language markers.
 *
 * Structure:
 *   Show (JPN)/Season 01/Show - S01E01.mp4
 *   Show (ENG)/Season 01/Show - S01E01.mp4
 */
async function createLanguageVideoSourceDir(): Promise<string> {
  const tempDir = join(tmpdir(), `podkit-video-lang-e2e-${Date.now()}`);
  const sourcePath = getVideoPath(Videos.COMPATIBLE_H264);

  // Create JPN version
  const jpnDir = join(tempDir, 'Test Show (JPN)', 'Season 01');
  await mkdir(jpnDir, { recursive: true });
  await cp(sourcePath, join(jpnDir, 'Test Show - S01E01.mp4'));

  // Create ENG version
  const engDir = join(tempDir, 'Test Show (ENG)', 'Season 01');
  await mkdir(engDir, { recursive: true });
  await cp(sourcePath, join(engDir, 'Test Show - S01E01.mp4'));

  return tempDir;
}

/**
 * Create a config file for video sync with showLanguage settings.
 */
async function createVideoTransformConfig(
  configDir: string,
  options: {
    source: string;
    showLanguage?:
      | boolean
      | {
          enabled?: boolean;
          format?: string;
          expand?: boolean;
        };
  }
): Promise<string> {
  const configPath = join(configDir, 'config.toml');

  let content = `# Video transform test config\n`;

  if (options.showLanguage !== undefined) {
    if (typeof options.showLanguage === 'boolean') {
      content += `showLanguage = ${options.showLanguage}\n`;
    } else {
      content += '\n[showLanguage]\n';
      if (options.showLanguage.enabled !== undefined) {
        content += `enabled = ${options.showLanguage.enabled}\n`;
      }
      if (options.showLanguage.format !== undefined) {
        content += `format = "${options.showLanguage.format}"\n`;
      }
      if (options.showLanguage.expand !== undefined) {
        content += `expand = ${options.showLanguage.expand}\n`;
      }
    }
  }

  content += `
[video.main]
path = "${options.source}"

[defaults]
video = "main"
`;

  await writeFile(configPath, content);
  return configPath;
}

// =============================================================================
// Tests
// =============================================================================

describe('video transforms: showLanguage', () => {
  let fixturesAvailable: boolean;

  beforeAll(async () => {
    fixturesAvailable = await areVideoFixturesAvailable();
  });

  function skipIfUnavailable(): boolean {
    if (!fixturesAvailable) {
      console.log('Skipping: video fixtures not available');
      return true;
    }
    return false;
  }

  describe('filename parsing with language markers', () => {
    it('detects language markers from folder names in dry-run', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const sourceDir = await createLanguageVideoSourceDir();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          const configPath = await createVideoTransformConfig(configDir, {
            source: sourceDir,
          });

          // Dry-run to see what would be synced
          const result = await runCli([
            '--config',
            configPath,
            'sync',
            '-t',
            'video',
            '--device',
            target.path,
            '--dry-run',
          ]);

          expect(result.exitCode).toBe(0);
          // Should detect both language versions as separate TV shows
          expect(result.stdout).toContain('TV Shows: 2');
          // Transforms line should show showLanguage is active
          expect(result.stdout).toContain('Show language');
        } finally {
          await cleanupVideoSourceDir(sourceDir);
          await rm(configDir, { recursive: true, force: true });
        }
      });
    });
  });

  describe('showLanguage transform with expand', () => {
    it('syncs videos with expanded language markers', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const sourceDir = await createLanguageVideoSourceDir();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          // Sync with showLanguage expand=true (JPN → Japanese)
          const configPath = await createVideoTransformConfig(configDir, {
            source: sourceDir,
            showLanguage: { enabled: true, format: '({})', expand: true },
          });

          const result = await runCli([
            '--config',
            configPath,
            'sync',
            '-t',
            'video',
            '--device',
            target.path,
          ]);

          expect(result.exitCode).toBe(0);

          // Verify tracks on iPod have expanded language names
          const tracks = await target.getTracks();
          expect(tracks.length).toBe(2);

          const jpnTrack = tracks.find((t) => t.artist?.includes('Japanese'));
          expect(jpnTrack).toBeDefined();
          expect(jpnTrack?.artist).toBe('Test Show (Japanese)');

          const engTrack = tracks.find((t) => t.artist?.includes('English'));
          expect(engTrack).toBeDefined();
          expect(engTrack?.artist).toBe('Test Show (English)');
        } finally {
          await cleanupVideoSourceDir(sourceDir);
          await rm(configDir, { recursive: true, force: true });
        }
      });
    });
  });

  describe('showLanguage disabled', () => {
    it('strips language markers when showLanguage is disabled', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const sourceDir = await createLanguageVideoSourceDir();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          const configPath = await createVideoTransformConfig(configDir, {
            source: sourceDir,
            showLanguage: false,
          });

          const result = await runCli([
            '--config',
            configPath,
            'sync',
            '-t',
            'video',
            '--device',
            target.path,
          ]);

          expect(result.exitCode).toBe(0);

          // Verify tracks on iPod have stripped language markers
          const tracks = await target.getTracks();
          expect(tracks.length).toBe(2);

          // Both tracks should have "Test Show" without any language marker
          for (const track of tracks) {
            expect(track.artist).toBe('Test Show');
            expect(track.artist).not.toContain('JPN');
            expect(track.artist).not.toContain('ENG');
          }
        } finally {
          await cleanupVideoSourceDir(sourceDir);
          await rm(configDir, { recursive: true, force: true });
        }
      });
    });
  });

  describe('transform toggle workflow', () => {
    it('updates metadata without re-transfer when toggling showLanguage', async () => {
      if (skipIfUnavailable()) return;

      await withTarget(async (target) => {
        const sourceDir = await createLanguageVideoSourceDir();
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          // Step 1: Initial sync with default showLanguage (enabled, abbreviated)
          const configDefault = await createVideoTransformConfig(configDir, {
            source: sourceDir,
          });

          const result1 = await runCli([
            '--config',
            configDefault,
            'sync',
            '-t',
            'video',
            '--device',
            target.path,
          ]);
          expect(result1.exitCode).toBe(0);

          // Verify: tracks have abbreviated markers
          const tracksBefore = await target.getTracks();
          expect(tracksBefore.length).toBe(2);
          const jpnBefore = tracksBefore.find((t) => t.artist?.includes('JPN'));
          expect(jpnBefore).toBeDefined();

          // Step 2: Change to expanded format and dry-run
          const configExpand = await createVideoTransformConfig(configDir, {
            source: sourceDir,
            showLanguage: { enabled: true, format: '({})', expand: true },
          });

          const dryRun = await runCli([
            '--config',
            configExpand,
            'sync',
            '-t',
            'video',
            '--device',
            target.path,
            '--dry-run',
          ]);

          expect(dryRun.exitCode).toBe(0);
          // Should show metadata updates, not new adds
          expect(dryRun.stdout).toContain('update');

          // Step 3: Actually sync with expanded format
          const result2 = await runCli([
            '--config',
            configExpand,
            'sync',
            '-t',
            'video',
            '--device',
            target.path,
          ]);
          expect(result2.exitCode).toBe(0);

          // Verify: tracks now have expanded language names
          const tracksAfter = await target.getTracks();
          expect(tracksAfter.length).toBe(2);
          const jpnAfter = tracksAfter.find((t) => t.artist?.includes('Japanese'));
          expect(jpnAfter).toBeDefined();
          expect(jpnAfter?.artist).toBe('Test Show (Japanese)');
        } finally {
          await cleanupVideoSourceDir(sourceDir);
          await rm(configDir, { recursive: true, force: true });
        }
      });
    });
  });
});

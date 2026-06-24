/**
 * E2E: per-device default collection precedence.
 *
 * Pins the end-to-end wiring of `defaultMusic` in `[devices.<name>]`:
 *
 * - AC#1 (must-have): when a device stanza names a *different* collection than
 *   the global default, a no-flag sync targets the DEVICE's collection, not the
 *   global one.
 * - AC#2 (false suppression): when the device stanza sets `defaultMusic = false`,
 *   a no-flag sync emits NO_COLLECTIONS (exit code 1) even though a global
 *   default music collection exists.
 *
 * Uses a mass-storage (rockbox) target so no hardware or gpod-tool is needed —
 * the device is a temp directory. Dry-run keeps the test fast and side-effect
 * free (no files are written to the device).
 *
 * The two collections are kept maximally distinguishable:
 *   - "globalcol": 1 track (just harmony.flac)
 *   - "devcol":    3 tracks (the full goldberg-selections fixture set)
 *
 * The decisive assertion: `plan.tracksToAdd === 3` (the devcol count) when the
 * device default is "devcol", and `json.source` contains the devcol directory
 * path. Matching on COUNT alone rules out globalcol (1 track); matching on
 * `source` makes the provenance explicit — both are required.
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureFixturesExist } from '@podkit/e2e-shared';
import { runCliJson } from '../helpers/cli-runner';
import { withMassStorageTarget } from '../targets';
import { getAlbumDir, Albums } from '../helpers/fixtures';
import type { SyncOutput } from 'podkit/types';

ensureFixturesExist('goldberg-selections');

describe('feature: per-device default collection', () => {
  /**
   * AC#1 — device default overrides global default.
   *
   * Config layout:
   *   [music.globalcol]  path = <1-track dir>
   *   [music.devcol]     path = <3-track dir>
   *   [defaults] music = "globalcol"
   *   [devices.<name>] defaultMusic = "devcol"
   *
   * Sync with NO -c flag → must resolve devcol (3 tracks), not globalcol (1 track).
   */
  it('device default collection overrides global default when no -c flag', async () => {
    await withMassStorageTarget(
      async (target) => {
        const fragment = target.deviceConfig();
        if (!fragment) throw new Error('mass-storage target must return a deviceConfig fragment');

        const goldbergDir = getAlbumDir(Albums.GOLDBERG_SELECTIONS);

        // Create two temp source dirs with distinct track counts:
        //   globalcol: 1 track  → tracksToAdd == 1 if this collection (incorrectly) wins
        //   devcol:    3 tracks → tracksToAdd == 3 if this collection (correctly) wins
        const tmpRoot = await mkdtemp(join(tmpdir(), 'podkit-devdefault-'));
        const globalColDir = join(tmpRoot, 'globalcol');
        const devColDir = join(tmpRoot, 'devcol');
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-devdefault-cfg-'));
        const configPath = join(configDir, 'config.toml');

        try {
          await mkdir(globalColDir);
          await symlink(
            join(goldbergDir, '01-harmony.flac'),
            join(globalColDir, '01-harmony.flac')
          );

          await mkdir(devColDir);
          await symlink(join(goldbergDir, '01-harmony.flac'), join(devColDir, '01-harmony.flac'));
          await symlink(join(goldbergDir, '02-vibrato.flac'), join(devColDir, '02-vibrato.flac'));
          await symlink(join(goldbergDir, '03-tremolo.flac'), join(devColDir, '03-tremolo.flac'));

          // Build TOML: global default = "globalcol", device default = "devcol".
          // Insert defaultMusic immediately after the [devices.<name>] header so
          // it always lands inside the device table — robust even if the fragment
          // ever grows a trailing sub-table.
          const deviceToml = fragment.toml
            .trimEnd()
            .replace(/^(\[devices\.[^\]]+\]\n)/, '$1defaultMusic = "devcol"\n');
          const toml = [
            'version = 2',
            '',
            '[music.globalcol]',
            `path = "${globalColDir}"`,
            '',
            '[music.devcol]',
            `path = "${devColDir}"`,
            '',
            deviceToml,
            '',
            '[defaults]',
            'music = "globalcol"',
            `device = "${fragment.name}"`,
            '',
          ].join('\n');

          await writeFile(configPath, toml, 'utf8');

          // Dry-run with NO -c flag: should resolve devcol (3 tracks), not globalcol (1 track).
          const { result, json } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            fragment.name,
            '--dry-run',
            '--json',
          ]);

          expect(result.exitCode).toBe(0);
          expect(json).not.toBeNull();
          expect(json!.success).toBe(true);
          expect(json!.dryRun).toBe(true);
          expect(json!.plan).toBeDefined();

          // Primary assertion: 3 tracks means devcol was chosen; 1 track would
          // mean globalcol was chosen (regression). This distinguishes the two
          // collections unambiguously.
          expect(json!.plan!.tracksToAdd).toBe(3);

          // Secondary assertion: source path must point into devcol, not globalcol.
          // Both are required — count + path together make the provenance explicit.
          expect(json!.source).toContain('devcol');
          expect(json!.source).not.toContain('globalcol');
        } finally {
          await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
          await rm(configDir, { recursive: true, force: true }).catch(() => {});
        }
      },
      { preset: 'rockbox' }
    );
  }, 60000);

  /**
   * AC#2 — `defaultMusic = false` suppresses music entirely.
   *
   * Config layout:
   *   [music.globalcol]  path = <3-track dir>
   *   [defaults] music = "globalcol"
   *   [devices.<name>] defaultMusic = false
   *
   * Sync with NO -c flag → no music collections active → CLI exits with
   * NO_COLLECTIONS error (exit code 1), even though a global default exists.
   */
  it('defaultMusic = false suppresses music even when global default exists', async () => {
    await withMassStorageTarget(
      async (target) => {
        const fragment = target.deviceConfig();
        if (!fragment) throw new Error('mass-storage target must return a deviceConfig fragment');

        const goldbergDir = getAlbumDir(Albums.GOLDBERG_SELECTIONS);

        const tmpRoot = await mkdtemp(join(tmpdir(), 'podkit-devfalse-'));
        const globalColDir = join(tmpRoot, 'globalcol');
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-devfalse-cfg-'));
        const configPath = join(configDir, 'config.toml');

        try {
          await mkdir(globalColDir);
          await symlink(
            join(goldbergDir, '01-harmony.flac'),
            join(globalColDir, '01-harmony.flac')
          );
          await symlink(
            join(goldbergDir, '02-vibrato.flac'),
            join(globalColDir, '02-vibrato.flac')
          );
          await symlink(
            join(goldbergDir, '03-tremolo.flac'),
            join(globalColDir, '03-tremolo.flac')
          );

          // Build TOML: global default = "globalcol", device explicitly suppresses music.
          // Insert defaultMusic right after the [devices.<name>] header (see AC#1).
          const deviceToml = fragment.toml
            .trimEnd()
            .replace(/^(\[devices\.[^\]]+\]\n)/, '$1defaultMusic = false\n');
          const toml = [
            'version = 2',
            '',
            '[music.globalcol]',
            `path = "${globalColDir}"`,
            '',
            deviceToml,
            '',
            '[defaults]',
            'music = "globalcol"',
            `device = "${fragment.name}"`,
            '',
          ].join('\n');

          await writeFile(configPath, toml, 'utf8');

          // Dry-run with NO -c flag: music suppressed → NO_COLLECTIONS error.
          const { result, json } = await runCliJson<{
            success: false;
            code: string;
            error: string;
          }>(['--config', configPath, 'sync', '--device', fragment.name, '--dry-run', '--json']);

          // Non-zero exit: no collections to sync.
          expect(result.exitCode).not.toBe(0);
          // CliErrorOutput shape: { success: false, code: 'NO_COLLECTIONS', error: '...' }
          expect(json).not.toBeNull();
          expect(json!.success).toBe(false);
          expect(json!.code).toBe('NO_COLLECTIONS');
        } finally {
          await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
          await rm(configDir, { recursive: true, force: true }).catch(() => {});
        }
      },
      { preset: 'rockbox' }
    );
  }, 60000);
});

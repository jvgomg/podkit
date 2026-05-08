/**
 * E2E smoke tests for `podkit collection music` / `podkit collection video`.
 *
 * These run the BUILT CLI binary against real fixture directories. The
 * exhaustive option-matrix coverage lives in
 * `packages/podkit-cli/src/commands/collection.integration.test.ts` (in-process).
 * This file just verifies the wiring still works end-to-end against the
 * compiled artifact — argv parsing, exit codes, stdout/stderr routing.
 */

import { describe, it, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, runCliJson, getFixturesDir, getVideoFixturesDir } from '../helpers';

async function makeConfig(
  toml: string
): Promise<{ configPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'podkit-e2e-collection-'));
  const configPath = join(dir, 'config.toml');
  await writeFile(configPath, toml);
  return {
    configPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

describe('podkit collection music (e2e)', () => {
  it('lists tracks in JSON against real fixtures', async () => {
    const { configPath, cleanup } = await makeConfig(
      `version = 1\n\n[music.main]\npath = "${getFixturesDir()}"\n\n[defaults]\nmusic = "main"\n`
    );
    try {
      const { result, json } = await runCliJson<Array<{ title?: string; artist?: string }>>([
        '--config',
        configPath,
        'collection',
        'music',
        '--tracks',
        '--format',
        'json',
        '-q',
      ]);

      expect(result.exitCode).toBe(0);
      expect(Array.isArray(json)).toBe(true);
      expect(json!.length).toBeGreaterThan(0);
      expect(json![0]).toHaveProperty('title');
    } finally {
      await cleanup();
    }
  }, 30000);

  it('exits 1 with an error when no music collection is configured', async () => {
    const { configPath, cleanup } = await makeConfig(`version = 1\n`);
    try {
      const result = await runCli(['--config', configPath, 'collection', 'music', '--tracks']);
      expect(result.exitCode).toBe(1);
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toMatch(/no.*collection|configured|add/);
    } finally {
      await cleanup();
    }
  }, 30000);
});

describe('podkit collection video (e2e)', () => {
  const videoAvailable =
    existsSync(getVideoFixturesDir()) &&
    existsSync(join(getVideoFixturesDir(), 'compatible-h264.mp4'));

  it.skipIf(!videoAvailable)(
    'lists videos in JSON against real fixtures',
    async () => {
      const { configPath, cleanup } = await makeConfig(
        `version = 1\n\n[video.main]\npath = "${getVideoFixturesDir()}"\n\n[defaults]\nvideo = "main"\n`
      );
      try {
        const { result, json } = await runCliJson<Array<{ title?: string }>>([
          '--config',
          configPath,
          'collection',
          'video',
          '--tracks',
          '--format',
          'json',
          '-q',
        ]);

        expect(result.exitCode).toBe(0);
        expect(Array.isArray(json)).toBe(true);
        expect(json!.length).toBeGreaterThan(0);
        expect(json![0]).toHaveProperty('title');
      } finally {
        await cleanup();
      }
    },
    30000
  );
});

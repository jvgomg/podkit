/**
 * E2E tests for the `podkit status` command.
 *
 * Tests device info display, JSON output, and error handling.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';

interface StatusOutput {
  connected: boolean;
  device?: {
    modelName: string;
    modelNumber: string | null;
    generation: string;
    capacity: number;
  };
  mount?: string;
  storage?: {
    used: number;
    total: number;
    free: number;
    percentUsed: number;
  };
  tracks?: number;
  playlists?: number;
  error?: string;
}

describe('podkit status', () => {
  describe('with valid iPod', () => {
    it('displays device information', async () => {
      await withTarget(async (target) => {
        const result = await runCli(['status', '--device', target.path]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Mount:');
        expect(result.stdout).toContain(target.path);
        expect(result.stdout).toContain('Tracks:');
      });
    });

    it('outputs JSON with --json flag', async () => {
      await withTarget(async (target) => {
        const { result, json } = await runCliJson<StatusOutput>([
          'status',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json).not.toBeNull();
        expect(json?.connected).toBe(true);
        expect(json?.device).toBeDefined();
        expect(json?.device?.modelName).toBeDefined();
        expect(json?.mount).toBe(target.path);
        expect(typeof json?.tracks).toBe('number');
      });
    });

    it('shows zero tracks on empty iPod', async () => {
      await withTarget(async (target) => {
        const { result, json } = await runCliJson<StatusOutput>([
          'status',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.tracks).toBe(0);
      });
    });
  });

  describe('error handling', () => {
    it('fails when no device specified', async () => {
      // Use non-existent config to ensure we don't pick up user's config file
      const result = await runCli(['--config', '/nonexistent/config.toml', 'status']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No iPod device specified');
    });

    it('outputs error in JSON when no device specified', async () => {
      // Use non-existent config to ensure we don't pick up user's config file
      const { result, json } = await runCliJson<StatusOutput>([
        '--config',
        '/nonexistent/config.toml',
        'status',
        '--json',
      ]);

      expect(result.exitCode).toBe(1);
      expect(json?.connected).toBe(false);
      expect(json?.error).toContain('No device');
    });

    it('fails when device path does not exist', async () => {
      const result = await runCli(['status', '--device', '/nonexistent/path']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('iPod not found');
    });

    it('outputs error in JSON when device path does not exist', async () => {
      const { result, json } = await runCliJson<StatusOutput>([
        'status',
        '--device',
        '/nonexistent/path',
        '--json',
      ]);

      expect(result.exitCode).toBe(1);
      expect(json?.connected).toBe(false);
      expect(json?.error).toContain('not found');
    });

    it('fails when path is not a valid iPod', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'podkit-status-test-'));
      try {
        const result = await runCli(['status', '--device', tempDir]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Cannot read iPod database');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});

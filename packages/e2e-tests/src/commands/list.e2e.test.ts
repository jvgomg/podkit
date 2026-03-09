/**
 * E2E tests for the `podkit device music` command.
 *
 * Tests listing music tracks on iPod in different formats.
 *
 * Note: Previously tested `podkit list`, now uses `podkit device music`.
 * This command lists music tracks on a configured device.
 */

import { describe, it, expect } from 'bun:test';
import { runCli, runCliJson } from '../helpers/cli-runner';

describe('podkit device music', () => {
  describe('error handling', () => {
    it('fails when no device configured', async () => {
      // Use non-existent config to ensure we don't pick up user's config file
      const result = await runCli(['--config', '/nonexistent/config.toml', 'device', 'music']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No devices configured');
    });

    it('outputs error in JSON when no device configured', async () => {
      // Use non-existent config to ensure we don't pick up user's config file
      const { result, json } = await runCliJson<{ error: boolean; message: string }>([
        '--config',
        '/nonexistent/config.toml',
        'device',
        'music',
        '--json',
      ]);

      expect(result.exitCode).toBe(1);
      expect(json?.error).toBe(true);
      expect(json?.message).toContain('No devices configured');
    });

    it('fails when specified device not found in config', async () => {
      const result = await runCli([
        '--config',
        '/nonexistent/config.toml',
        'device',
        'music',
        'nonexistent-device',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found in config');
    });
  });
});

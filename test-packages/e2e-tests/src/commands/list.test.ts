/**
 * E2E tests for the `podkit device music` command.
 *
 * Tests listing music tracks on iPod in different formats.
 *
 * Note: Previously tested `podkit list`, now uses `podkit device music`.
 * This command lists music tracks on a configured device.
 */

import { describe, it, expect } from 'bun:test';
import { runCli } from '../helpers/cli-runner';
import { expectCliError } from '../helpers/cli-error';

describe('podkit device music', () => {
  describe('error handling', () => {
    it('fails when no device configured', async () => {
      const result = await runCli(['--config', '/nonexistent/config.toml', 'device', 'music']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No devices configured');
    });

    it('outputs error in JSON when no device configured', async () => {
      await expectCliError(['--config', '/nonexistent/config.toml', 'device', 'music', '--json'], {
        error: /No devices configured/,
        code: 'DEVICE_NOT_RESOLVED',
      });
    });

    it('fails when specified device not found in config', async () => {
      const result = await runCli([
        '--config',
        '/nonexistent/config.toml',
        '--device',
        'nonexistent-device',
        'device',
        'music',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });
  });
});

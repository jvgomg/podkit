/**
 * E2E tests for the `podkit device info` command.
 *
 * Tests device info display, JSON output, and error handling.
 *
 * Note: `device info` shows configured device info + live status.
 * It requires a device to be registered in config first.
 */

import { describe, it, expect } from 'bun:test';
import { runCli, runCliJson } from '../helpers/cli-runner';

interface DeviceInfoOutput {
  success: boolean;
  device?: {
    name: string;
    volumeUuid: string;
    volumeName: string;
    quality?: string;
    artwork?: boolean;
    isDefault: boolean;
  };
  status?: {
    mounted: boolean;
    mountPoint?: string;
    model?: {
      name: string;
      number: string | null;
      generation: string;
      capacity: number;
    };
    storage?: {
      used: number;
      total: number;
      free: number;
      percentUsed: number;
    };
    musicCount?: number;
    videoCount?: number;
  };
  error?: string;
}

describe('podkit device info', () => {
  describe('error handling', () => {
    it('fails when no device specified and none configured', async () => {
      // Use non-existent config to ensure we don't pick up user's config file
      const result = await runCli(['--config', '/nonexistent/config.toml', 'device', 'info']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No devices configured');
    });

    it('outputs error in JSON when no device specified', async () => {
      // Use non-existent config to ensure we don't pick up user's config file
      const { result, json } = await runCliJson<DeviceInfoOutput>([
        '--config',
        '/nonexistent/config.toml',
        'device',
        'info',
        '--json',
      ]);

      expect(result.exitCode).toBe(1);
      expect(json?.success).toBe(false);
      expect(json?.error).toContain('No devices configured');
    });

    it('fails when specified device not found in config', async () => {
      // Use non-existent config
      const result = await runCli([
        '--config',
        '/nonexistent/config.toml',
        'device',
        'info',
        'nonexistent-device',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found in config');
    });
  });
});

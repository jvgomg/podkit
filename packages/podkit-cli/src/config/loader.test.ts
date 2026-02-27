import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadConfigFile,
  loadEnvConfig,
  loadCliConfig,
  mergeConfigs,
  loadConfig,
} from './loader.js';
import { DEFAULT_CONFIG, ENV_KEYS } from './defaults.js';
import type { GlobalOptions, PartialConfig } from './types.js';

describe('config loader', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory for test config files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Clear environment variables
    delete process.env[ENV_KEYS.source];
    delete process.env[ENV_KEYS.device];
    delete process.env[ENV_KEYS.quality];
    delete process.env[ENV_KEYS.artwork];
  });

  describe('DEFAULT_CONFIG', () => {
    it('has expected default values', () => {
      expect(DEFAULT_CONFIG.quality).toBe('high');
      expect(DEFAULT_CONFIG.artwork).toBe(true);
      expect(DEFAULT_CONFIG.source).toBeUndefined();
      expect(DEFAULT_CONFIG.device).toBeUndefined();
    });
  });

  describe('loadConfigFile', () => {
    it('returns undefined for non-existent file', () => {
      const result = loadConfigFile(path.join(tempDir, 'nonexistent.toml'));
      expect(result).toBeUndefined();
    });

    it('parses valid TOML config file', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, `
source = "/path/to/music"
device = "/media/ipod"
quality = "medium"
artwork = false
`);

      const result = loadConfigFile(configPath);
      expect(result).toEqual({
        source: '/path/to/music',
        device: '/media/ipod',
        quality: 'medium',
        artwork: false,
      });
    });

    it('handles partial config files', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, `
source = "/music"
`);

      const result = loadConfigFile(configPath);
      expect(result).toEqual({
        source: '/music',
      });
    });

    it('throws on invalid quality value', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, `
quality = "invalid"
`);

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid quality value/);
    });

    // Quality preset tests
    const validPresets = ['alac', 'max', 'max-cbr', 'high', 'high-cbr', 'medium', 'medium-cbr', 'low', 'low-cbr'];
    for (const preset of validPresets) {
      it(`accepts quality = "${preset}"`, () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, `quality = "${preset}"`);

        const result = loadConfigFile(configPath);
        expect(result?.quality).toBe(preset);
      });
    }

    // Fallback tests
    it('parses fallback option', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, `
quality = "alac"
fallback = "high"
`);

      const result = loadConfigFile(configPath);
      expect(result?.quality).toBe('alac');
      expect(result?.fallback).toBe('high');
    });

    it('throws on alac as fallback (alac is not valid AAC preset)', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, `
quality = "alac"
fallback = "alac"
`);

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid fallback value/);
    });

    const validFallbacks = ['max', 'max-cbr', 'high', 'high-cbr', 'medium', 'medium-cbr', 'low', 'low-cbr'];
    for (const fallback of validFallbacks) {
      it(`accepts fallback = "${fallback}"`, () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, `
quality = "alac"
fallback = "${fallback}"
`);

        const result = loadConfigFile(configPath);
        expect(result?.fallback).toBe(fallback);
      });
    }

    it('handles empty config file', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, '# Empty config\n');

      const result = loadConfigFile(configPath);
      expect(result).toEqual({});
    });

    it('handles commented out values', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, `
# source = "/path/to/music"
quality = "low"
# artwork = false
`);

      const result = loadConfigFile(configPath);
      expect(result).toEqual({
        quality: 'low',
      });
    });

    it('throws on malformed TOML syntax', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, `
source = "missing end quote
`);

      expect(() => loadConfigFile(configPath)).toThrow();
    });

    it('ignores unknown keys', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, `
source = "/music"
unknown_key = "should be ignored"
another_unknown = 123
`);

      const result = loadConfigFile(configPath);
      expect(result).toEqual({
        source: '/music',
      });
    });

    it('ignores artwork with wrong type (string instead of boolean)', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, `
artwork = "yes"
`);

      const result = loadConfigFile(configPath);
      // String "yes" should not be parsed as artwork since type check is strict
      expect(result).toEqual({});
    });

    it('handles whitespace in paths', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, `
source = "/path/with spaces/music"
device = "/media/iPod Nano"
`);

      const result = loadConfigFile(configPath);
      expect(result).toEqual({
        source: '/path/with spaces/music',
        device: '/media/iPod Nano',
      });
    });
  });

  describe('loadEnvConfig', () => {
    it('returns empty config when no env vars set', () => {
      const result = loadEnvConfig();
      expect(result).toEqual({});
    });

    it('reads PODKIT_SOURCE', () => {
      process.env[ENV_KEYS.source] = '/env/music';
      const result = loadEnvConfig();
      expect(result.source).toBe('/env/music');
    });

    it('reads PODKIT_DEVICE', () => {
      process.env[ENV_KEYS.device] = '/env/ipod';
      const result = loadEnvConfig();
      expect(result.device).toBe('/env/ipod');
    });

    it('reads PODKIT_QUALITY with valid value', () => {
      process.env[ENV_KEYS.quality] = 'low';
      const result = loadEnvConfig();
      expect(result.quality).toBe('low');
    });

    it('ignores PODKIT_QUALITY with invalid value', () => {
      process.env[ENV_KEYS.quality] = 'invalid';
      const result = loadEnvConfig();
      expect(result.quality).toBeUndefined();
    });

    // All quality presets via env
    const envPresets = ['alac', 'max', 'max-cbr', 'high', 'high-cbr', 'medium', 'medium-cbr', 'low', 'low-cbr'];
    for (const preset of envPresets) {
      it(`reads PODKIT_QUALITY=${preset}`, () => {
        process.env[ENV_KEYS.quality] = preset;
        const result = loadEnvConfig();
        expect(result.quality).toBe(preset);
      });
    }

    it('reads PODKIT_ARTWORK=true', () => {
      process.env[ENV_KEYS.artwork] = 'true';
      const result = loadEnvConfig();
      expect(result.artwork).toBe(true);
    });

    it('reads PODKIT_ARTWORK=false', () => {
      process.env[ENV_KEYS.artwork] = 'false';
      const result = loadEnvConfig();
      expect(result.artwork).toBe(false);
    });

    it('reads PODKIT_ARTWORK=1 as true', () => {
      process.env[ENV_KEYS.artwork] = '1';
      const result = loadEnvConfig();
      expect(result.artwork).toBe(true);
    });

    it('reads PODKIT_ARTWORK=yes as true', () => {
      process.env[ENV_KEYS.artwork] = 'yes';
      const result = loadEnvConfig();
      expect(result.artwork).toBe(true);
    });

    it('reads all env vars together', () => {
      process.env[ENV_KEYS.source] = '/env/music';
      process.env[ENV_KEYS.device] = '/env/ipod';
      process.env[ENV_KEYS.quality] = 'medium';
      process.env[ENV_KEYS.artwork] = 'false';

      const result = loadEnvConfig();
      expect(result).toEqual({
        source: '/env/music',
        device: '/env/ipod',
        quality: 'medium',
        artwork: false,
      });
    });
  });

  describe('loadCliConfig', () => {
    it('returns empty config with no options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const result = loadCliConfig(globalOpts);
      expect(result).toEqual({});
    });

    it('extracts device from global options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        device: '/cli/ipod',
      };
      const result = loadCliConfig(globalOpts);
      expect(result.device).toBe('/cli/ipod');
    });

    it('extracts source from command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { source: '/cli/music' };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.source).toBe('/cli/music');
    });

    it('extracts quality from command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { quality: 'low' };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.quality).toBe('low');
    });

    it('extracts artwork from command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { artwork: false };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.artwork).toBe(false);
    });

    it('ignores invalid quality in command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { quality: 'invalid' };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.quality).toBeUndefined();
    });

    // All quality presets via CLI
    const cliPresets = ['alac', 'max', 'max-cbr', 'high', 'high-cbr', 'medium', 'medium-cbr', 'low', 'low-cbr'];
    for (const preset of cliPresets) {
      it(`extracts quality = "${preset}" from command options`, () => {
        const globalOpts: GlobalOptions = {
          verbose: 0,
          quiet: false,
          json: false,
          color: true,
        };
        const commandOpts = { quality: preset };
        const result = loadCliConfig(globalOpts, commandOpts);
        expect(result.quality).toBe(preset);
      });
    }

    // Fallback option via CLI
    it('extracts fallback from command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { quality: 'alac', fallback: 'high' };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.quality).toBe('alac');
      expect(result.fallback).toBe('high');
    });

    // Invalid fallback via CLI (alac is not valid AAC preset)
    it('ignores invalid fallback in command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { fallback: 'invalid' };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.fallback).toBeUndefined();
    });
  });

  describe('mergeConfigs', () => {
    it('starts with defaults', () => {
      const result = mergeConfigs();
      expect(result).toEqual(DEFAULT_CONFIG);
    });

    it('merges single partial config', () => {
      const partial: PartialConfig = { source: '/merged' };
      const result = mergeConfigs(partial);
      expect(result.source).toBe('/merged');
      expect(result.quality).toBe('high'); // default preserved
    });

    it('later configs override earlier ones', () => {
      const first: PartialConfig = { source: '/first', quality: 'low' };
      const second: PartialConfig = { source: '/second' };
      const result = mergeConfigs(first, second);
      expect(result.source).toBe('/second');
      expect(result.quality).toBe('low'); // from first, not overwritten
    });

    it('preserves undefined values (does not override with undefined)', () => {
      const first: PartialConfig = { source: '/first' };
      const second: PartialConfig = {}; // no source
      const result = mergeConfigs(first, second);
      expect(result.source).toBe('/first');
    });

    it('merges multiple configs in priority order', () => {
      const file: PartialConfig = { source: '/file', device: '/file-device', quality: 'low' };
      const env: PartialConfig = { source: '/env' };
      const cli: PartialConfig = { device: '/cli-device' };

      const result = mergeConfigs(file, env, cli);
      expect(result.source).toBe('/env'); // env overrides file
      expect(result.device).toBe('/cli-device'); // cli overrides all
      expect(result.quality).toBe('low'); // from file
      expect(result.artwork).toBe(true); // from default
    });
  });

  describe('loadConfig', () => {
    it('returns defaults when no config exists', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        config: path.join(tempDir, 'nonexistent.toml'),
      };

      const result = loadConfig(globalOpts);
      expect(result.config).toEqual(DEFAULT_CONFIG);
      expect(result.configFileExists).toBe(false);
      expect(result.configPath).toBeUndefined();
    });

    it('loads config from custom path', () => {
      const configPath = path.join(tempDir, 'custom.toml');
      fs.writeFileSync(configPath, `
source = "/custom/music"
quality = "medium"
`);

      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        config: configPath,
      };

      const result = loadConfig(globalOpts);
      expect(result.config.source).toBe('/custom/music');
      expect(result.config.quality).toBe('medium');
      expect(result.configFileExists).toBe(true);
      expect(result.configPath).toBe(configPath);
    });

    it('merges config file with env vars', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, `
source = "/file/music"
device = "/file/device"
`);

      process.env[ENV_KEYS.source] = '/env/music';

      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        config: configPath,
      };

      const result = loadConfig(globalOpts);
      expect(result.config.source).toBe('/env/music'); // env wins
      expect(result.config.device).toBe('/file/device'); // from file
    });

    it('CLI options override everything', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, `
source = "/file/music"
device = "/file/device"
`);

      process.env[ENV_KEYS.device] = '/env/device';

      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        config: configPath,
        device: '/cli/device',
      };

      const commandOpts = { source: '/cli/music' };

      const result = loadConfig(globalOpts, commandOpts);
      expect(result.config.source).toBe('/cli/music'); // CLI wins
      expect(result.config.device).toBe('/cli/device'); // CLI wins over env
    });

    it('handles missing config file gracefully', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        // Use a non-existent config path to avoid loading real user config
        config: '/nonexistent/path/to/config.toml',
      };

      // Should not throw, should use defaults
      const result = loadConfig(globalOpts);
      expect(result.config.quality).toBe('high');
      expect(result.config.artwork).toBe(true);
      expect(result.configFileExists).toBe(false);
    });
  });
});

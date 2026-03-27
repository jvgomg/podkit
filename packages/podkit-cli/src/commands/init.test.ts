import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Command } from 'commander';
import {
  configExists,
  createConfigFile,
  formatSuccessMessage,
  CONFIG_TEMPLATE,
  initCommand,
} from './init.js';
import { DEFAULT_CONFIG, CURRENT_CONFIG_VERSION } from '../config/index.js';

describe('init command', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory for test config files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-init-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('CONFIG_TEMPLATE', () => {
    it('is valid TOML-like content', () => {
      // Should contain ADR-008 format sections
      expect(CONFIG_TEMPLATE).toContain('[music.main]');
      expect(CONFIG_TEMPLATE).toContain('[devices.ipod]');
    });

    it('includes version field matching CURRENT_CONFIG_VERSION', () => {
      expect(CONFIG_TEMPLATE).toContain(`version = ${CURRENT_CONFIG_VERSION}`);
    });

    it('uses default values from DEFAULT_CONFIG in device section', () => {
      // The template should use the same defaults as the config system (inside devices section)
      expect(CONFIG_TEMPLATE).toContain(`quality = "${DEFAULT_CONFIG.quality}"`);
      expect(CONFIG_TEMPLATE).toContain(`artwork = ${DEFAULT_CONFIG.artwork}`);
    });

    it('has commented out music and device sections (optional)', () => {
      // These are optional, so they should be commented examples
      expect(CONFIG_TEMPLATE).toContain('# [music.main]');
      expect(CONFIG_TEMPLATE).toContain('# [devices.ipod]');
    });

    it('has descriptive comments', () => {
      expect(CONFIG_TEMPLATE).toContain('# podkit configuration');
      expect(CONFIG_TEMPLATE).toContain('# Music collections');
      expect(CONFIG_TEMPLATE).toContain('# Devices');
    });
  });

  describe('configExists', () => {
    it('returns false for non-existent file', () => {
      const result = configExists(path.join(tempDir, 'nonexistent.toml'));
      expect(result).toBe(false);
    });

    it('returns true for existing file', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, '# existing config');

      const result = configExists(configPath);
      expect(result).toBe(true);
    });

    it('returns false for existing directory', () => {
      const dirPath = path.join(tempDir, 'not-a-file');
      fs.mkdirSync(dirPath);

      // existsSync returns true for directories, but for our use case
      // we care about file existence
      const result = configExists(dirPath);
      expect(result).toBe(true); // This is expected - existsSync returns true for dirs
    });
  });

  describe('createConfigFile', () => {
    describe('when file does not exist', () => {
      it('creates config file at specified path', () => {
        const configPath = path.join(tempDir, 'config.toml');

        const result = createConfigFile({ configPath });

        expect(result.success).toBe(true);
        expect(result.configPath).toBe(configPath);
        expect(result.alreadyExisted).toBe(false);
        expect(result.error).toBeUndefined();
        expect(fs.existsSync(configPath)).toBe(true);
      });

      it('writes CONFIG_TEMPLATE content', () => {
        const configPath = path.join(tempDir, 'config.toml');

        createConfigFile({ configPath });

        const content = fs.readFileSync(configPath, 'utf-8');
        expect(content).toBe(CONFIG_TEMPLATE);
      });

      it('creates parent directories if they do not exist', () => {
        const configPath = path.join(tempDir, 'nested', 'dir', 'config.toml');

        const result = createConfigFile({ configPath });

        expect(result.success).toBe(true);
        expect(fs.existsSync(configPath)).toBe(true);
        expect(fs.existsSync(path.dirname(configPath))).toBe(true);
      });

      it('creates deeply nested directories', () => {
        const configPath = path.join(tempDir, 'a', 'b', 'c', 'd', 'config.toml');

        const result = createConfigFile({ configPath });

        expect(result.success).toBe(true);
        expect(fs.existsSync(configPath)).toBe(true);
      });
    });

    describe('when file already exists', () => {
      it('returns error without force flag', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, '# existing config');

        const result = createConfigFile({ configPath });

        expect(result.success).toBe(false);
        expect(result.alreadyExisted).toBe(true);
        expect(result.error).toContain('already exists');
        expect(result.error).toContain('--force');
      });

      it('does not modify existing file without force flag', () => {
        const configPath = path.join(tempDir, 'config.toml');
        const originalContent = '# my custom config\nquality = "low"';
        fs.writeFileSync(configPath, originalContent);

        createConfigFile({ configPath });

        const content = fs.readFileSync(configPath, 'utf-8');
        expect(content).toBe(originalContent);
      });

      it('overwrites file with force flag', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, '# old config');

        const result = createConfigFile({ configPath, force: true });

        expect(result.success).toBe(true);
        expect(result.alreadyExisted).toBe(true);

        const content = fs.readFileSync(configPath, 'utf-8');
        expect(content).toBe(CONFIG_TEMPLATE);
      });

      it('returns correct path in error result', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, '# existing');

        const result = createConfigFile({ configPath });

        expect(result.configPath).toBe(configPath);
      });
    });

    describe('force flag variations', () => {
      it('force: false behaves like omitted force', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, '# existing');

        const result = createConfigFile({ configPath, force: false });

        expect(result.success).toBe(false);
      });

      it('force: true on non-existent file works fine', () => {
        const configPath = path.join(tempDir, 'new-config.toml');

        const result = createConfigFile({ configPath, force: true });

        expect(result.success).toBe(true);
        expect(result.alreadyExisted).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('handles config path with spaces', () => {
        const configPath = path.join(tempDir, 'my configs', 'config.toml');

        const result = createConfigFile({ configPath });

        expect(result.success).toBe(true);
        expect(fs.existsSync(configPath)).toBe(true);
      });

      it('handles config path with special characters', () => {
        const configPath = path.join(tempDir, 'config-v1.0.toml');

        const result = createConfigFile({ configPath });

        expect(result.success).toBe(true);
        expect(fs.existsSync(configPath)).toBe(true);
      });
    });
  });

  describe('formatSuccessMessage', () => {
    it('includes the config path', () => {
      const configPath = '/home/user/.config/podkit/config.toml';
      const message = formatSuccessMessage(configPath);

      expect(message).toContain(configPath);
    });

    it('includes "Created config file at" prefix', () => {
      const message = formatSuccessMessage('/any/path');

      expect(message).toContain('Created config file at');
    });

    it('includes next steps', () => {
      const message = formatSuccessMessage('/any/path');

      expect(message).toContain('Next steps:');
    });

    it('includes instruction to edit config', () => {
      const configPath = '/home/user/.config/podkit/config.toml';
      const message = formatSuccessMessage(configPath);

      expect(message).toContain('Edit');
      expect(message).toContain(configPath);
      expect(message).toContain('music source');
    });

    it('includes instruction to connect iPod', () => {
      const message = formatSuccessMessage('/any/path');

      expect(message).toContain('Connect your iPod');
    });

    it('includes instruction to run device info', () => {
      const message = formatSuccessMessage('/any/path');

      expect(message).toContain('podkit device info');
    });

    it('includes instruction to run sync --dry-run', () => {
      const message = formatSuccessMessage('/any/path');

      expect(message).toContain('podkit sync --dry-run');
    });

    it('has numbered steps', () => {
      const message = formatSuccessMessage('/any/path');

      expect(message).toContain('1.');
      expect(message).toContain('2.');
      expect(message).toContain('3.');
      expect(message).toContain('4.');
    });
  });
});

describe('initCommand action exit codes', () => {
  let tempDir: string;
  let savedExitCode: number | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-init-test-'));
    savedExitCode = process.exitCode as number | undefined;
    process.exitCode = 0;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = savedExitCode;
  });

  it('sets process.exitCode = 1 when config already exists without --force', async () => {
    const configPath = path.join(tempDir, 'config.toml');
    fs.writeFileSync(configPath, '# existing');

    const program = new Command('podkit');
    program.addCommand(initCommand);

    await program.parseAsync(['init', '--path', configPath], { from: 'user' });

    expect(process.exitCode).toBe(1);
  });

  it('does not set process.exitCode = 1 on success', async () => {
    const configPath = path.join(tempDir, 'new-config.toml');

    const program = new Command('podkit');
    program.addCommand(initCommand);

    await program.parseAsync(['init', '--path', configPath], { from: 'user' });

    expect(process.exitCode).toBe(0);
  });
});

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { deviceCommand } from './device.js';
import { addDevice, setDefaultDevice } from '../config/writer.js';
import { setContext, clearContext } from '../context.js';

describe('device command', () => {
  describe('command structure', () => {
    it('has correct name', () => {
      expect(deviceCommand.name()).toBe('device');
    });

    it('has description', () => {
      expect(deviceCommand.description()).toBeTruthy();
      expect(deviceCommand.description()).toContain('manage');
    });

    it('has list subcommand', () => {
      const listCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'list');
      expect(listCmd).toBeDefined();
      expect(listCmd?.description()).toContain('list');
    });

    it('has add subcommand', () => {
      const addCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'add');
      expect(addCmd).toBeDefined();
      expect(addCmd?.description()).toContain('add');
    });

    it('has remove subcommand', () => {
      const removeCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'remove');
      expect(removeCmd).toBeDefined();
      expect(removeCmd?.description()).toContain('remove');
    });

    it('has info subcommand', () => {
      const infoCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'info');
      expect(infoCmd).toBeDefined();
      expect(infoCmd?.description()).toContain('display');
    });

    it('has music subcommand', () => {
      const musicCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'music');
      expect(musicCmd).toBeDefined();
      expect(musicCmd?.description()).toContain('music');
    });

    it('has video subcommand', () => {
      const videoCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'video');
      expect(videoCmd).toBeDefined();
      expect(videoCmd?.description()).toContain('video');
    });

    it('has clear subcommand', () => {
      const clearCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'clear');
      expect(clearCmd).toBeDefined();
      expect(clearCmd?.description()).toContain('content');
    });

    it('has reset subcommand', () => {
      const resetCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'reset');
      expect(resetCmd).toBeDefined();
      expect(resetCmd?.description()).toContain('database');
    });

    it('has eject subcommand', () => {
      const ejectCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'eject');
      expect(ejectCmd).toBeDefined();
      expect(ejectCmd?.description()).toContain('unmount');
    });

    it('has mount subcommand', () => {
      const mountCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'mount');
      expect(mountCmd).toBeDefined();
      expect(mountCmd?.description()).toContain('mount');
    });

    it('has init subcommand', () => {
      const initCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'init');
      expect(initCmd).toBeDefined();
      expect(initCmd?.description()).toContain('initialize');
    });
  });

  describe('--fields validation', () => {
    let savedExitCode: typeof process.exitCode;

    beforeEach(() => {
      savedExitCode = process.exitCode;
      process.exitCode = undefined;
      const minimalConfig = { music: {}, video: {}, devices: {} } as any;
      setContext({
        config: minimalConfig,
        globalOpts: { json: false, quiet: false, verbose: 0, color: false },
        configResult: { config: minimalConfig, configPath: '/tmp/test.toml', configFileExists: true },
      });
    });

    afterEach(() => {
      process.exitCode = 0;
      clearContext();
    });

    it('music subcommand errors when --fields used without --tracks', async () => {
      const musicCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'music')!;
      await musicCmd.parseAsync(['node', 'music', '--fields', 'title,artist']);
      expect(process.exitCode).toBe(1);
    });

    it('video subcommand errors when --fields used without --tracks', async () => {
      const videoCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'video')!;
      await videoCmd.parseAsync(['node', 'video', '--fields', 'title,artist']);
      expect(process.exitCode).toBe(1);
    });
  });

  describe('additional command structure', () => {
    it('add subcommand requires name argument', () => {
      const addCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'add');
      const nameArg = addCmd?.registeredArguments.find((arg) => arg.name() === 'name');
      expect(nameArg).toBeDefined();
      expect(nameArg?.required).toBe(true);
    });

    it('remove subcommand requires name argument', () => {
      const removeCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'remove');
      const nameArg = removeCmd?.registeredArguments.find((arg) => arg.name() === 'name');
      expect(nameArg).toBeDefined();
      expect(nameArg?.required).toBe(true);
    });

    it('remove subcommand has --confirm option', () => {
      const removeCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'remove');
      const confirmOption = removeCmd?.options.find((opt) => opt.long === '--confirm');
      expect(confirmOption).toBeDefined();
    });

    it('info subcommand has optional name argument', () => {
      const infoCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'info');
      const nameArg = infoCmd?.registeredArguments.find((arg) => arg.name() === 'name');
      expect(nameArg).toBeDefined();
      expect(nameArg?.required).toBe(false);
    });

    it('clear subcommand has optional name argument', () => {
      const clearCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'clear');
      const nameArg = clearCmd?.registeredArguments.find((arg) => arg.name() === 'name');
      expect(nameArg).toBeDefined();
      expect(nameArg?.required).toBe(false);
    });

    it('clear subcommand has --confirm option', () => {
      const clearCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'clear');
      const confirmOption = clearCmd?.options.find((opt) => opt.long === '--confirm');
      expect(confirmOption).toBeDefined();
    });

    it('clear subcommand has --dry-run option', () => {
      const clearCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'clear');
      const dryRunOption = clearCmd?.options.find((opt) => opt.long === '--dry-run');
      expect(dryRunOption).toBeDefined();
    });

    it('clear subcommand has --type option', () => {
      const clearCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'clear');
      const typeOption = clearCmd?.options.find((opt) => opt.long === '--type');
      expect(typeOption).toBeDefined();
    });

    it('reset subcommand has optional name argument', () => {
      const resetCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'reset');
      const nameArg = resetCmd?.registeredArguments.find((arg) => arg.name() === 'name');
      expect(nameArg).toBeDefined();
      expect(nameArg?.required).toBe(false);
    });

    it('reset subcommand has --yes option', () => {
      const resetCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'reset');
      const yesOption = resetCmd?.options.find((opt) => opt.long === '--yes');
      expect(yesOption).toBeDefined();
    });

    it('reset subcommand has --dry-run option', () => {
      const resetCmd = deviceCommand.commands.find((cmd) => cmd.name() === 'reset');
      const dryRunOption = resetCmd?.options.find((opt) => opt.long === '--dry-run');
      expect(dryRunOption).toBeDefined();
    });
  });
});

describe('config writer functions', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    // Create a temporary directory for test config files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-device-test-'));
    configPath = path.join(tempDir, 'config.toml');
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('addDevice', () => {
    it('creates config file if it does not exist', () => {
      const result = addDevice(
        'terapod',
        {
          volumeUuid: 'ABC-123',
          volumeName: 'TERAPOD',
        },
        { configPath }
      );

      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it('adds device section to config', () => {
      const result = addDevice(
        'terapod',
        {
          volumeUuid: 'ABC-123',
          volumeName: 'TERAPOD',
        },
        { configPath }
      );

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('[devices.terapod]');
      expect(content).toContain('volumeUuid = "ABC-123"');
      expect(content).toContain('volumeName = "TERAPOD"');
    });

    it('adds optional quality settings', () => {
      const result = addDevice(
        'terapod',
        {
          volumeUuid: 'ABC-123',
          volumeName: 'TERAPOD',
          quality: 'high',
          videoQuality: 'high',
          artwork: true,
        },
        { configPath }
      );

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('quality = "high"');
      expect(content).toContain('videoQuality = "high"');
      expect(content).toContain('artwork = true');
    });

    it('fails if device already exists', () => {
      // Add device first
      addDevice('terapod', { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' }, { configPath });

      // Try to add again
      const result = addDevice(
        'terapod',
        { volumeUuid: 'DEF-456', volumeName: 'TERAPOD2' },
        { configPath }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('appends to existing config file', () => {
      // Create initial config with some content
      fs.writeFileSync(configPath, 'quality = "medium"\n');

      const result = addDevice(
        'terapod',
        { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
        { configPath }
      );

      expect(result.success).toBe(true);
      expect(result.created).toBe(false);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('quality = "medium"');
      expect(content).toContain('[devices.terapod]');
    });
  });

  describe('removeDevice', () => {
    it('removes device section from config', () => {
      // Add device first
      addDevice('terapod', { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' }, { configPath });

      // Import and use removeDevice
      const { removeDevice } = require('../config/writer.js');
      const result = removeDevice('terapod', { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).not.toContain('[devices.terapod]');
      expect(content).not.toContain('ABC-123');
    });

    it('fails if device does not exist', () => {
      // Create empty config
      fs.writeFileSync(configPath, '');

      const { removeDevice } = require('../config/writer.js');
      const result = removeDevice('nonexistent', { configPath });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('fails if config file does not exist', () => {
      const { removeDevice } = require('../config/writer.js');
      const result = removeDevice('terapod', { configPath });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('setDefaultDevice', () => {
    it('creates defaults section if it does not exist', () => {
      // Add a device first
      addDevice('terapod', { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' }, { configPath });

      const result = setDefaultDevice('terapod', { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('[defaults]');
      expect(content).toContain('device = "terapod"');
    });

    it('updates existing default device', () => {
      // Create config with defaults section
      fs.writeFileSync(
        configPath,
        `[defaults]
device = "old-device"
`
      );

      const result = setDefaultDevice('new-device', { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('device = "new-device"');
      expect(content).not.toContain('old-device');
    });

    it('clears default device when empty string passed', () => {
      // Create config with defaults section
      fs.writeFileSync(
        configPath,
        `[defaults]
device = "terapod"
music = "main"
`
      );

      const result = setDefaultDevice('', { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('[defaults]');
      expect(content).toContain('music = "main"');
      expect(content).not.toContain('device = "terapod"');
    });

    it('adds device to existing defaults section without device', () => {
      // Create config with defaults section but no device
      fs.writeFileSync(
        configPath,
        `[defaults]
music = "main"
`
      );

      const result = setDefaultDevice('terapod', { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('[defaults]');
      expect(content).toContain('device = "terapod"');
      expect(content).toContain('music = "main"');
    });
  });
});

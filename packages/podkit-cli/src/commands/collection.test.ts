import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { collectionCommand } from './collection.js';
import { setContext, clearContext } from '../context.js';

describe('collection command', () => {
  describe('command structure', () => {
    it('has correct name', () => {
      expect(collectionCommand.name()).toBe('collection');
    });

    it('has description', () => {
      expect(collectionCommand.description()).toBeTruthy();
      expect(collectionCommand.description()).toContain('collection');
    });

    it('has list subcommand', () => {
      const listCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'list');
      expect(listCmd).toBeDefined();
      expect(listCmd?.description()).toContain('list');
    });

    it('list subcommand has optional --type flag', () => {
      const listCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'list');
      expect(listCmd).toBeDefined();
      const typeOption = listCmd?.options.find((opt) => opt.long === '--type');
      expect(typeOption).toBeDefined();
    });

    it('has add subcommand', () => {
      const addCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'add');
      expect(addCmd).toBeDefined();
      expect(addCmd?.description()).toContain('add');
    });

    it('add subcommand has --type, --collection, and --path options', () => {
      const addCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'add');
      expect(addCmd).toBeDefined();

      const typeOption = addCmd?.options.find((opt) => opt.long === '--type');
      expect(typeOption).toBeDefined();

      const collectionOption = addCmd?.options.find((opt) => opt.long === '--collection');
      expect(collectionOption).toBeDefined();

      const pathOption = addCmd?.options.find((opt) => opt.long === '--path');
      expect(pathOption).toBeDefined();

      // No positional arguments
      expect(addCmd?.registeredArguments).toHaveLength(0);
    });

    it('has remove subcommand', () => {
      const removeCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'remove');
      expect(removeCmd).toBeDefined();
      expect(removeCmd?.description()).toContain('remove');
    });

    it('remove subcommand has --collection option', () => {
      const removeCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'remove');
      expect(removeCmd).toBeDefined();

      const collectionOption = removeCmd?.options.find((opt) => opt.long === '--collection');
      expect(collectionOption).toBeDefined();
    });

    it('remove subcommand has --yes option', () => {
      const removeCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'remove');
      expect(removeCmd).toBeDefined();

      const yesOption = removeCmd?.options.find((opt) => opt.long === '--yes');
      expect(yesOption).toBeDefined();
    });

    it('has info subcommand', () => {
      const infoCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'info');
      expect(infoCmd).toBeDefined();
      expect(infoCmd?.description()).toContain('detail');
    });

    it('info subcommand has --collection option', () => {
      const infoCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'info');
      expect(infoCmd).toBeDefined();

      const collectionOption = infoCmd?.options.find((opt) => opt.long === '--collection');
      expect(collectionOption).toBeDefined();
    });

    it('has music subcommand', () => {
      const musicCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'music');
      expect(musicCmd).toBeDefined();
      expect(musicCmd?.description()).toContain('music');
    });

    it('music subcommand has optional --collection flag', () => {
      const musicCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'music');
      expect(musicCmd).toBeDefined();

      const collectionOption = musicCmd?.options.find((opt) => opt.long === '--collection');
      expect(collectionOption).toBeDefined();
    });

    it('has video subcommand', () => {
      const videoCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'video');
      expect(videoCmd).toBeDefined();
      expect(videoCmd?.description()).toContain('video');
    });

    it('video subcommand has optional --collection flag', () => {
      const videoCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'video');
      expect(videoCmd).toBeDefined();

      const collectionOption = videoCmd?.options.find((opt) => opt.long === '--collection');
      expect(collectionOption).toBeDefined();
    });
  });

  describe('--fields validation', () => {
    let _savedExitCode: typeof process.exitCode;

    beforeEach(() => {
      _savedExitCode = process.exitCode;
      process.exitCode = undefined;
      const minimalConfig = { music: {}, video: {}, devices: {} } as any;
      setContext({
        config: minimalConfig,
        globalOpts: { json: false, quiet: false, verbose: 0, color: false, tips: true, tty: false },
        configResult: {
          config: minimalConfig,
          configPath: '/tmp/test.toml',
          configFileExists: true,
        },
      });
    });

    afterEach(() => {
      process.exitCode = 0;
      clearContext();
    });

    it('music subcommand errors when --fields used without --tracks', async () => {
      const musicCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'music')!;
      // Parse with --fields but no --tracks (stats mode)
      await musicCmd.parseAsync(['node', 'music', '--fields', 'title,artist']);
      expect(process.exitCode).toBe(1);
    });

    it('video subcommand errors when --fields used without --tracks', async () => {
      const videoCmd = collectionCommand.commands.find((cmd) => cmd.name() === 'video')!;
      await videoCmd.parseAsync(['node', 'video', '--fields', 'title,artist']);
      expect(process.exitCode).toBe(1);
    });
  });
});

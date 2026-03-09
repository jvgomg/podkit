import { describe, expect, it } from 'bun:test';
import { collectionCommand } from './collection.js';

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
      const listCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'list'
      );
      expect(listCmd).toBeDefined();
      expect(listCmd?.description()).toContain('list');
    });

    it('list subcommand accepts optional type argument', () => {
      const listCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'list'
      );
      expect(listCmd).toBeDefined();
      const typeArg = listCmd?.registeredArguments.find(
        (arg) => arg.name() === 'type'
      );
      expect(typeArg).toBeDefined();
      expect(typeArg?.required).toBe(false);
    });

    it('has add subcommand', () => {
      const addCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'add'
      );
      expect(addCmd).toBeDefined();
      expect(addCmd?.description()).toContain('add');
    });

    it('add subcommand requires type, name, and path arguments', () => {
      const addCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'add'
      );
      expect(addCmd).toBeDefined();

      const typeArg = addCmd?.registeredArguments.find(
        (arg) => arg.name() === 'type'
      );
      expect(typeArg).toBeDefined();
      expect(typeArg?.required).toBe(true);

      const nameArg = addCmd?.registeredArguments.find(
        (arg) => arg.name() === 'name'
      );
      expect(nameArg).toBeDefined();
      expect(nameArg?.required).toBe(true);

      const pathArg = addCmd?.registeredArguments.find(
        (arg) => arg.name() === 'path'
      );
      expect(pathArg).toBeDefined();
      expect(pathArg?.required).toBe(true);
    });

    it('has remove subcommand', () => {
      const removeCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'remove'
      );
      expect(removeCmd).toBeDefined();
      expect(removeCmd?.description()).toContain('remove');
    });

    it('remove subcommand requires name argument', () => {
      const removeCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'remove'
      );
      expect(removeCmd).toBeDefined();

      const nameArg = removeCmd?.registeredArguments.find(
        (arg) => arg.name() === 'name'
      );
      expect(nameArg).toBeDefined();
      expect(nameArg?.required).toBe(true);
    });

    it('remove subcommand has --yes option', () => {
      const removeCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'remove'
      );
      expect(removeCmd).toBeDefined();

      const yesOption = removeCmd?.options.find(
        (opt) => opt.long === '--yes'
      );
      expect(yesOption).toBeDefined();
    });

    it('has info subcommand', () => {
      const infoCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'info'
      );
      expect(infoCmd).toBeDefined();
      expect(infoCmd?.description()).toContain('detail');
    });

    it('info subcommand requires name argument', () => {
      const infoCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'info'
      );
      expect(infoCmd).toBeDefined();

      const nameArg = infoCmd?.registeredArguments.find(
        (arg) => arg.name() === 'name'
      );
      expect(nameArg).toBeDefined();
      expect(nameArg?.required).toBe(true);
    });

    it('has music subcommand', () => {
      const musicCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'music'
      );
      expect(musicCmd).toBeDefined();
      expect(musicCmd?.description()).toContain('tracks');
    });

    it('music subcommand has optional name argument', () => {
      const musicCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'music'
      );
      expect(musicCmd).toBeDefined();

      const nameArg = musicCmd?.registeredArguments.find(
        (arg) => arg.name() === 'name'
      );
      expect(nameArg).toBeDefined();
      expect(nameArg?.required).toBe(false);
    });

    it('has video subcommand', () => {
      const videoCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'video'
      );
      expect(videoCmd).toBeDefined();
      expect(videoCmd?.description()).toContain('video');
    });

    it('video subcommand has optional name argument', () => {
      const videoCmd = collectionCommand.commands.find(
        (cmd) => cmd.name() === 'video'
      );
      expect(videoCmd).toBeDefined();

      const nameArg = videoCmd?.registeredArguments.find(
        (arg) => arg.name() === 'name'
      );
      expect(nameArg).toBeDefined();
      expect(nameArg?.required).toBe(false);
    });
  });
});

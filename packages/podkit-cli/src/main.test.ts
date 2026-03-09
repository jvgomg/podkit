import { describe, expect, it } from 'bun:test';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { deviceCommand } from './commands/device.js';
import { collectionCommand } from './commands/collection.js';
import { ejectCommand } from './commands/eject.js';
import { mountCommand } from './commands/mount.js';

describe('podkit-cli commands', () => {
  it('init command is defined with correct name', () => {
    expect(initCommand.name()).toBe('init');
    expect(initCommand.description()).toContain('config');
  });

  it('sync command is defined with correct name', () => {
    expect(syncCommand.name()).toBe('sync');
    expect(syncCommand.description()).toContain('sync');
  });

  it('device command is defined with correct name', () => {
    expect(deviceCommand.name()).toBe('device');
    expect(deviceCommand.description()).toContain('device');
  });

  it('collection command is defined with correct name', () => {
    expect(collectionCommand.name()).toBe('collection');
    expect(collectionCommand.description()).toContain('collection');
  });

  it('eject command is defined with correct name', () => {
    expect(ejectCommand.name()).toBe('eject');
    expect(ejectCommand.description()).toContain('unmount');
  });

  it('mount command is defined with correct name', () => {
    expect(mountCommand.name()).toBe('mount');
    expect(mountCommand.description()).toContain('mount');
  });

  it('sync command has expected options', () => {
    const opts = syncCommand.options.map(o => o.long);
    expect(opts).toContain('--dry-run');
    expect(opts).toContain('--quality');
    expect(opts).toContain('--filter');
    expect(opts).toContain('--no-artwork');
    expect(opts).toContain('--delete');
    expect(opts).toContain('--collection');
    expect(opts).toContain('--device-name');
  });

  it('device command has subcommands', () => {
    const subcommands = deviceCommand.commands.map(c => c.name());
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('add');
    expect(subcommands).toContain('remove');
    expect(subcommands).toContain('info');
    expect(subcommands).toContain('music');
    expect(subcommands).toContain('video');
    expect(subcommands).toContain('clear');
    expect(subcommands).toContain('reset');
    expect(subcommands).toContain('eject');
    expect(subcommands).toContain('mount');
    expect(subcommands).toContain('init');
  });

  it('collection command has subcommands', () => {
    const subcommands = collectionCommand.commands.map(c => c.name());
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('add');
    expect(subcommands).toContain('remove');
    expect(subcommands).toContain('info');
    expect(subcommands).toContain('music');
    expect(subcommands).toContain('video');
  });
});

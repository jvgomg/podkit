/**
 * Unit tests for ScsiError and defaultMessage.
 */

import { describe, it, expect } from 'bun:test';
import { ScsiError } from './errors.js';

describe('ScsiError eacces message', () => {
  it('contains sudo recommendation', () => {
    const err = new ScsiError({ kind: 'eacces', devicePath: '/dev/sg3' });
    expect(err.message).toContain('sudo');
  });

  it('contains udev repair command', () => {
    const err = new ScsiError({ kind: 'eacces', devicePath: '/dev/sg3' });
    expect(err.message).toContain('podkit doctor --repair udev-rule');
  });

  it('contains replug instruction', () => {
    const err = new ScsiError({ kind: 'eacces', devicePath: '/dev/sg3' });
    expect(err.message).toContain('unplug and replug');
  });

  it('mentions the device path', () => {
    const err = new ScsiError({ kind: 'eacces', devicePath: '/dev/sg3' });
    expect(err.message).toContain('/dev/sg3');
  });

  it('falls back to generic device label when path is absent', () => {
    const err = new ScsiError({ kind: 'eacces' });
    expect(err.message).toContain('SCSI device');
    expect(err.message).toContain('sudo');
    expect(err.message).toContain('podkit doctor --repair udev-rule');
  });

  it('contains the troubleshooting docs link', () => {
    const err = new ScsiError({ kind: 'eacces' });
    expect(err.message).toContain('https://podkit.dev/docs/troubleshooting#linux-scsi-permissions');
  });

  it('kind discriminator is preserved', () => {
    const err = new ScsiError({ kind: 'eacces', devicePath: '/dev/sg0' });
    expect(err.kind).toBe('eacces');
  });
});

describe('ScsiError other kinds', () => {
  it('enoent message mentions the device path', () => {
    const err = new ScsiError({ kind: 'enoent', devicePath: '/dev/sg99' });
    expect(err.message).toContain('/dev/sg99');
  });

  it('ebusy message mentions busy', () => {
    const err = new ScsiError({ kind: 'ebusy' });
    expect(err.message).toContain('busy');
  });

  it('timeout message mentions timed out', () => {
    const err = new ScsiError({ kind: 'timeout' });
    expect(err.message).toContain('timed out');
  });

  it('kext-missing message mentions iPodDriver.kext', () => {
    const err = new ScsiError({ kind: 'kext-missing' });
    expect(err.message).toContain('iPodDriver.kext');
  });
});

/**
 * Unit tests for `resolveDeviceName` — the helper that lets `device add` /
 * `device remove` accept either a positional `<name>` argument or the
 * program-level `-d <name>` flag, but rejects a silent disagreement
 * between the two.
 */
import { describe, it, expect } from 'bun:test';
import { CliError } from '../../errors.js';
import { resolveDeviceName } from './shared.js';

describe('resolveDeviceName', () => {
  it('returns the positional argument when given alone', () => {
    expect(resolveDeviceName('terapod', undefined, 'add')).toBe('terapod');
  });

  it('returns the -d global flag when given alone', () => {
    expect(resolveDeviceName(undefined, 'terapod', 'remove')).toBe('terapod');
  });

  it('accepts both forms when they agree (user being explicit)', () => {
    expect(resolveDeviceName('terapod', 'terapod', 'add')).toBe('terapod');
  });

  it('throws DEVICE_ARG_CONFLICT when positional and -d disagree', () => {
    let thrown: unknown;
    try {
      resolveDeviceName('terapod', 'sallys-ipod', 'remove');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CliError);
    const err = thrown as CliError;
    expect(err.code).toBe('DEVICE_ARG_CONFLICT');
    expect(err.message).toContain('terapod');
    expect(err.message).toContain('sallys-ipod');
  });

  it('throws DEVICE_REQUIRED with both-form usage hint when neither is given', () => {
    let thrown: unknown;
    try {
      resolveDeviceName(undefined, undefined, 'add');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CliError);
    const err = thrown as CliError;
    expect(err.code).toBe('DEVICE_REQUIRED');
    // Both forms must be in the usage hint so a confused user sees both.
    expect(err.message).toContain('podkit device add <name>');
    expect(err.message).toContain('podkit -d <name> device add');
  });

  it('treats empty-string positional as missing (not as a valid name)', () => {
    let thrown: unknown;
    try {
      resolveDeviceName('', undefined, 'add');
    } catch (err) {
      thrown = err;
    }
    const err = thrown as CliError;
    expect(err.code).toBe('DEVICE_REQUIRED');
  });

  it('treats whitespace-only positional as missing', () => {
    let thrown: unknown;
    try {
      resolveDeviceName('   ', undefined, 'remove');
    } catch (err) {
      thrown = err;
    }
    const err = thrown as CliError;
    expect(err.code).toBe('DEVICE_REQUIRED');
  });

  it('trims surrounding whitespace from a valid positional', () => {
    expect(resolveDeviceName('  terapod  ', undefined, 'add')).toBe('terapod');
  });

  it('uses the command label in the usage hint', () => {
    let thrown: unknown;
    try {
      resolveDeviceName(undefined, undefined, 'remove');
    } catch (err) {
      thrown = err;
    }
    const err = thrown as CliError;
    expect(err.message).toContain('podkit device remove <name>');
    expect(err.message).toContain('podkit -d <name> device remove');
  });
});

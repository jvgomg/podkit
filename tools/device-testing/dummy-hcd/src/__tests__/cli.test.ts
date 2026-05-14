/**
 * Unit tests for the daemon CLI argument parser.
 */

import { describe, it, expect } from 'bun:test';

import { DEFAULT_FFS_MOUNT, DEFAULT_GADGET_NAME, DEFAULT_SIDECAR_PATH, parseArgs } from '../cli.js';

describe('parseArgs', () => {
  it('requires --persona', () => {
    const r = parseArgs([]);
    if (r.kind !== 'error') throw new Error('expected error');
    expect(r.message).toContain('--persona');
  });

  it('parses --persona <id> with all defaults', () => {
    const r = parseArgs(['--persona', 'ipod-test']);
    if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
    expect(r.options).toEqual({
      persona: 'ipod-test',
      sidecar: DEFAULT_SIDECAR_PATH,
      gadgetName: DEFAULT_GADGET_NAME,
      ffsMount: DEFAULT_FFS_MOUNT,
      dryRun: false,
    });
  });

  it('accepts --flag=value syntax', () => {
    const r = parseArgs([
      '--persona=ipod-test',
      '--sidecar=/tmp/personas.json',
      '--gadget-name=alt',
      '--ffs-mount=/dev/alt',
    ]);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.options.persona).toBe('ipod-test');
    expect(r.options.sidecar).toBe('/tmp/personas.json');
    expect(r.options.gadgetName).toBe('alt');
    expect(r.options.ffsMount).toBe('/dev/alt');
  });

  it('accepts --dry-run', () => {
    const r = parseArgs(['--persona', 'p', '--dry-run']);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.options.dryRun).toBe(true);
  });

  it('returns help on -h', () => {
    expect(parseArgs(['-h']).kind).toBe('help');
    expect(parseArgs(['--help']).kind).toBe('help');
  });

  it('rejects unknown flags', () => {
    const r = parseArgs(['--persona', 'p', '--whoops']);
    if (r.kind !== 'error') throw new Error('expected error');
    expect(r.message).toContain('--whoops');
  });

  it('rejects --flag without a value', () => {
    const r = parseArgs(['--persona']);
    if (r.kind !== 'error') throw new Error('expected error');
    expect(r.message).toContain('--persona');
  });
});

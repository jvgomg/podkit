/**
 * Pins the public-ID → internal-check-ID dispatch table.
 *
 * Every test here documents one of the two public surfaces the CLI exposes:
 *
 * 1. Public IDs map 1:1 to internal IDs for the well-known checks.
 * 2. The "unified" IDs (`orphan-files`, `debris-files`) dispatch by device
 *    type to a device-specific internal check.
 */

import { describe, it, expect } from 'bun:test';
import {
  PUBLIC_REPAIR_IDS,
  resolvePublicRepairId,
  getRepairCheck,
  getRepairCheckForValidation,
} from './repair-dispatch.js';

describe('PUBLIC_REPAIR_IDS', () => {
  it('lists every public ID the CLI advertises', () => {
    // Stability test — adding/removing a public ID is a user-facing change.
    expect([...PUBLIC_REPAIR_IDS].sort()).toEqual([
      'artwork-rebuild',
      'artwork-reset',
      'debris-files',
      'debris-transcode-tmp',
      'orphan-files',
      'sysinfo-consistency',
      'sysinfo-extended',
      'sysinfo-modelnum-mismatch',
      'udev-rule',
    ]);
  });

  it('does NOT list the legacy device-suffixed IDs', () => {
    expect(PUBLIC_REPAIR_IDS).not.toContain('orphan-files-mass-storage');
    expect(PUBLIC_REPAIR_IDS).not.toContain('debris-files-mass-storage');
    expect(PUBLIC_REPAIR_IDS).not.toContain('debris-files-ipod');
  });
});

describe('resolvePublicRepairId', () => {
  describe('unified orphan-files dispatch', () => {
    it('dispatches orphan-files to the iPod check on iPod', () => {
      expect(resolvePublicRepairId('orphan-files', 'ipod')).toBe('orphan-files');
    });

    it('dispatches orphan-files to the mass-storage check on mass-storage', () => {
      expect(resolvePublicRepairId('orphan-files', 'mass-storage')).toBe(
        'orphan-files-mass-storage'
      );
    });
  });

  describe('unified debris-files dispatch', () => {
    it('dispatches debris-files to the iPod check on iPod', () => {
      expect(resolvePublicRepairId('debris-files', 'ipod')).toBe('debris-files-ipod');
    });

    it('dispatches debris-files to the mass-storage check on mass-storage', () => {
      expect(resolvePublicRepairId('debris-files', 'mass-storage')).toBe(
        'debris-files-mass-storage'
      );
    });
  });

  describe('passthrough IDs', () => {
    it.each([
      'artwork-rebuild',
      'artwork-reset',
      'debris-transcode-tmp',
      'sysinfo-consistency',
      'sysinfo-extended',
      'sysinfo-modelnum-mismatch',
      'udev-rule',
    ])('passes %s through unchanged for both device types', (id) => {
      expect(resolvePublicRepairId(id, 'ipod')).toBe(id);
      expect(resolvePublicRepairId(id, 'mass-storage')).toBe(id);
    });
  });
});

describe('getRepairCheck', () => {
  it('returns the iPod orphan check when called with (orphan-files, ipod)', () => {
    const check = getRepairCheck('orphan-files', 'ipod');
    expect(check?.id).toBe('orphan-files');
    expect(check?.applicableTo).toContain('ipod');
  });

  it('returns the mass-storage orphan check when called with (orphan-files, mass-storage)', () => {
    const check = getRepairCheck('orphan-files', 'mass-storage');
    expect(check?.id).toBe('orphan-files-mass-storage');
    expect(check?.applicableTo).toContain('mass-storage');
  });

  it('returns the iPod debris check when called with (debris-files, ipod)', () => {
    const check = getRepairCheck('debris-files', 'ipod');
    expect(check?.id).toBe('debris-files-ipod');
  });

  it('returns the mass-storage debris check when called with (debris-files, mass-storage)', () => {
    const check = getRepairCheck('debris-files', 'mass-storage');
    expect(check?.id).toBe('debris-files-mass-storage');
  });

  it('returns undefined for unknown public IDs', () => {
    expect(getRepairCheck('not-a-check', 'ipod')).toBeUndefined();
  });
});

describe('getRepairCheckForValidation', () => {
  it('returns a check (iPod variant) for unified IDs — early validation', () => {
    // Used before device resolution; both variants of a unified ID share
    // scope + CLI-visible requirements so the iPod variant is a safe proxy.
    const check = getRepairCheckForValidation('debris-files');
    expect(check?.applicableTo).toContain('ipod');
    expect(check?.scope).toBe('database-health');
  });

  it('returns the only variant for non-unified IDs', () => {
    expect(getRepairCheckForValidation('artwork-rebuild')?.id).toBe('artwork-rebuild');
    expect(getRepairCheckForValidation('debris-transcode-tmp')?.id).toBe('debris-transcode-tmp');
  });

  it('pins that orphan-files variants have divergent requirements (intentional)', () => {
    // The iPod orphan check declares a 'database' requirement because it
    // walks the iTunesDB; the mass-storage variant does not (manifest is
    // a flat JSON file, not a libgpod handle). This divergence is
    // intentional and must NOT be relied on for CLI early validation —
    // the CLI only consults 'source-collection' and empty-set
    // (system-repair fast path) from the requirements array.
    const ipod = getRepairCheck('orphan-files', 'ipod');
    const ms = getRepairCheck('orphan-files', 'mass-storage');
    expect(ipod?.repair?.requirements).toContain('writable-device');
    expect(ipod?.repair?.requirements).toContain('database');
    expect(ms?.repair?.requirements).toContain('writable-device');
    expect(ms?.repair?.requirements).not.toContain('database');
    // Both share the CLI-visible signals: neither needs source-collection.
    expect(ipod?.repair?.requirements).not.toContain('source-collection');
    expect(ms?.repair?.requirements).not.toContain('source-collection');
  });
});

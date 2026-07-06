/**
 * Unit tests for the unknown-iPod-model sync guard.
 *
 * The guard is the universal backstop that refuses to sync an iPod whose model
 * cannot be resolved from on-disk identity, replacing the old silent
 * degradation to a "generic iPod". Pure and table-tested — no device required.
 */

import { describe, expect, it } from 'bun:test';

import type { IpodModel, ResolveModelInput } from '@podkit/devices-ipod';

import { UnknownIpodModelError, assertKnownIpodModel } from './unknown-ipod-model.js';

// =============================================================================
// Helpers
// =============================================================================

function makeModel(overrides: Partial<IpodModel> = {}): IpodModel {
  return {
    displayName: 'iPod nano (4th generation)',
    generationId: 'nano_4g',
    family: 'nano',
    ordinal: 4,
    checksumType: 'none',
    source: 'serial',
    ...overrides,
  } as IpodModel;
}

// =============================================================================
// assertKnownIpodModel
// =============================================================================

describe('assertKnownIpodModel', () => {
  it('returns the model unchanged when resolution succeeded', () => {
    const model = makeModel();
    const result = assertKnownIpodModel(model, { serialNumber: '5U851AEH3R0', familyId: 15 });
    expect(result).toBe(model);
  });

  it('throws UnknownIpodModelError when the model is null', () => {
    expect(() => assertKnownIpodModel(null, { serialNumber: 'XXXXXXX', familyId: 9999 })).toThrow(
      UnknownIpodModelError
    );
  });

  it('tags the error with a stable typed code', () => {
    try {
      assertKnownIpodModel(null, { serialNumber: 'XXXXXXX', familyId: null });
      throw new Error('expected guard to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownIpodModelError);
      expect((err as UnknownIpodModelError).code).toBe('UNKNOWN_IPOD_MODEL');
    }
  });

  it('carries the resolution inputs for diagnostics', () => {
    const identity: ResolveModelInput = {
      serialNumber: 'XXXXXXX',
      familyId: 9999,
      modelNumStr: 'MZ999',
    };
    try {
      assertKnownIpodModel(null, identity);
      throw new Error('expected guard to throw');
    } catch (err) {
      expect((err as UnknownIpodModelError).identity).toEqual(identity);
    }
  });
});

// =============================================================================
// Remediation text (AC#2)
// =============================================================================

describe('UnknownIpodModelError remediation', () => {
  it('points at the one-time USB setup via device add', () => {
    const err = new UnknownIpodModelError({ serialNumber: 'XXXXXXX', familyId: null });
    expect(err.message).toContain('device add');
  });

  it('points at doctor --repair sysinfo-extended', () => {
    const err = new UnknownIpodModelError({ serialNumber: 'XXXXXXX', familyId: null });
    expect(err.message).toContain('doctor --repair sysinfo-extended');
  });

  it('does not leak libgpod implementation wording', () => {
    const err = new UnknownIpodModelError({ serialNumber: 'XXXXXXX', familyId: null });
    expect(err.message.toLowerCase()).not.toContain('libgpod');
  });
});

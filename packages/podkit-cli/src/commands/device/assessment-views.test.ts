/**
 * Unit tests for the per-kind assessment adapters.
 *
 * Pins the mapping of the real `IpodIdentityAssessment` /
 * `MassStorageAssessment` fields onto the kind-agnostic `DeviceAssessmentView`
 * — the one place kind dispatch is allowed. Mass-storage MUST collapse to
 * `identityStore: 'not-applicable'` so the M4 policy stays kind-free.
 */

import { describe, it, expect } from 'bun:test';
import type { IpodIdentityAssessment, IpodModel, MassStorageAssessment } from '@podkit/core';
import { ipodAssessmentToView, massStorageAssessmentToView } from './assessment-views.js';
import { decideAddOutcome } from './verification-policy.js';

// =============================================================================
// iPod adapter
// =============================================================================

const VIDEO_5G: IpodModel = {
  displayName: 'iPod Video (5th Generation)',
  generationId: 'video_5g',
  family: 'iPod Video',
  ordinal: 5,
  checksumType: 'none',
  source: 'usb',
};

function ipodAssessment(over: Partial<IpodIdentityAssessment> = {}): IpodIdentityAssessment {
  return {
    model: VIDEO_5G,
    capabilities: null,
    needsChecksum: false,
    checksumType: 'none',
    firmwareInquiry: 'present',
    existing: null,
    usbFingerprint: null,
    sysInfoModelNumber: undefined,
    ...over,
  };
}

describe('ipodAssessmentToView', () => {
  it('maps firmwareInquiry "present" → identityStore "present"', () => {
    const v = ipodAssessmentToView(ipodAssessment({ firmwareInquiry: 'present' }));
    expect(v.identityStore).toBe('present');
  });

  it('maps firmwareInquiry "missing" → identityStore "missing"', () => {
    const v = ipodAssessmentToView(ipodAssessment({ firmwareInquiry: 'missing' }));
    expect(v.identityStore).toBe('missing');
  });

  it('maps firmwareInquiry "unwritable" → identityStore "unwritable"', () => {
    const v = ipodAssessmentToView(ipodAssessment({ firmwareInquiry: 'unwritable' }));
    expect(v.identityStore).toBe('unwritable');
  });

  it('maps a resolved model → hasIdentity true + displayName', () => {
    const v = ipodAssessmentToView(ipodAssessment());
    expect(v.hasIdentity).toBe(true);
    expect(v.displayName).toBe('iPod Video (5th Generation)');
  });

  it('maps a null model → hasIdentity false + "Unknown iPod" display', () => {
    const v = ipodAssessmentToView(ipodAssessment({ model: null }));
    expect(v.hasIdentity).toBe(false);
    expect(v.displayName).toBe('Unknown iPod');
  });

  it('uses the user-supplied type as a display fallback when no model', () => {
    const v = ipodAssessmentToView(ipodAssessment({ model: null }), { userType: 'ipod' });
    expect(v.displayName).toBe('ipod');
  });

  it('maps needsChecksum → identityStoreRequired', () => {
    const required = ipodAssessmentToView(ipodAssessment({ needsChecksum: true }));
    expect(required.identityStoreRequired).toBe(true);
    const optional = ipodAssessmentToView(ipodAssessment({ needsChecksum: false }));
    expect(optional.identityStoreRequired).toBe(false);
  });

  it('maps model.unsupportedReason → unsupportedReason (kind + headline)', () => {
    const v = ipodAssessmentToView(
      ipodAssessment({
        model: {
          ...VIDEO_5G,
          unsupportedReason: {
            kind: 'ios-device',
            headline: "iPod touch uses Apple's proprietary sync protocol.",
          },
        },
      })
    );
    expect(v.unsupportedReason).toEqual({
      kind: 'ios-device',
      headline: "iPod touch uses Apple's proprietary sync protocol.",
    });
  });

  it('preserves docsUrl and details from unsupportedReason (FIX 4)', () => {
    const v = ipodAssessmentToView(
      ipodAssessment({
        model: {
          ...VIDEO_5G,
          unsupportedReason: {
            kind: 'unsupported-device',
            headline: 'Not supported.',
            docsUrl: 'https://podkit.dev/docs/unsupported',
            details: ['Reason one.', 'Reason two.'],
          },
        },
      })
    );
    expect(v.unsupportedReason).toEqual({
      kind: 'unsupported-device',
      headline: 'Not supported.',
      docsUrl: 'https://podkit.dev/docs/unsupported',
      details: ['Reason one.', 'Reason two.'],
    });
  });

  it('omits unsupportedReason for a supported model', () => {
    const v = ipodAssessmentToView(ipodAssessment());
    expect(v.unsupportedReason).toBeUndefined();
  });

  it('sets hasSysInfoModelNumber true when sysInfoModelNumber is set (FIX 1)', () => {
    const v = ipodAssessmentToView(ipodAssessment({ model: null, sysInfoModelNumber: 'MA147' }));
    expect(v.hasIdentity).toBe(false);
    expect(v.hasSysInfoModelNumber).toBe(true);
  });

  it('sets hasSysInfoModelNumber false when sysInfoModelNumber is absent', () => {
    const v = ipodAssessmentToView(ipodAssessment({ sysInfoModelNumber: undefined }));
    expect(v.hasSysInfoModelNumber).toBe(false);
  });
});

// =============================================================================
// Mass-storage adapter
// =============================================================================

function massAssessment(over: Partial<MassStorageAssessment> = {}): MassStorageAssessment {
  return {
    identity: { kind: 'mass-storage', presetId: 'echo-mini' },
    preset: {
      manufacturer: 'FiiO Snowsky',
      productName: 'Echo Mini',
    } as MassStorageAssessment['preset'],
    capabilities: null,
    mountPoint: '/mnt/echo',
    ...over,
  };
}

describe('massStorageAssessmentToView', () => {
  it('always reports identityStore "not-applicable" (keeps M4 kind-free)', () => {
    const v = massStorageAssessmentToView(massAssessment());
    expect(v.identityStore).toBe('not-applicable');
    expect(v.identityStoreRequired).toBe(false);
  });

  it('maps a resolved preset → hasIdentity true + productName display', () => {
    const v = massStorageAssessmentToView(massAssessment());
    expect(v.hasIdentity).toBe(true);
    expect(v.displayName).toBe('Echo Mini');
  });

  it('maps a null preset → hasIdentity false, falling back to presetId display', () => {
    const v = massStorageAssessmentToView(massAssessment({ preset: null }));
    expect(v.hasIdentity).toBe(false);
    expect(v.displayName).toBe('echo-mini');
  });

  it('never carries an unsupportedReason', () => {
    const v = massStorageAssessmentToView(massAssessment());
    expect(v.unsupportedReason).toBeUndefined();
  });

  it('always reports hasSysInfoModelNumber false (mass-storage has no classic SysInfo)', () => {
    const v = massStorageAssessmentToView(massAssessment());
    expect(v.hasSysInfoModelNumber).toBe(false);
  });

  it('model:null + sysInfoModelNumber set → hasSysInfoModelNumber:true → NOT refuse-empty-identity (FIX 1)', () => {
    // Verify end-to-end: even when model lookup fails, on-disk SysInfo
    // ModelNumStr prevents the device being treated as fully-empty.
    // This mirrors isIdentityFullyEmpty's hasSysInfoModelNumber check.
    const view = ipodAssessmentToView(
      ipodAssessment({ model: null, sysInfoModelNumber: 'MA147', firmwareInquiry: 'unwritable' })
    );
    expect(view.hasSysInfoModelNumber).toBe(true);
    const outcome = decideAddOutcome('verify', { mode: 'undeclared' }, view, {
      located: true,
      volumeUuid: 'AAAA-BBBB',
      filesystem: 'vfat',
      platform: 'darwin',
      crossCheck: 'pass',
    });
    // Should NOT refuse-empty-identity because sysInfoModelNumber was present.
    // With unwritable store + no model it reaches step 9 (partial-identity).
    expect(outcome.kind).not.toBe('refuse-empty-identity');
    expect(outcome).toMatchObject({ kind: 'proceed-with-warning', warning: 'partial-identity' });
  });
});

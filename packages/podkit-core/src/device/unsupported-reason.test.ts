/**
 * Unit tests for the cascade → readiness unsupported-reason bridge.
 *
 * Pins:
 * - Supported models return `undefined` (no rejection).
 * - Unsupported models map to a typed payload with the right `kind`
 *   discriminator (touch_* → `'ios-device'`, everything else →
 *   `'unsupported-device'`).
 * - Headline reflects the model's `notSupportedReason` verbatim.
 * - Canonical docs URL is attached.
 */

import { describe, expect, it } from 'bun:test';
import type { IpodModel } from '@podkit/devices-ipod';
import { DOCS_URLS } from '../docs-urls.js';
import {
  makeUnsupportedReasonFromModel,
  makeUnsupportedReasonFromAssessment,
} from './unsupported-reason.js';
import type { IpodIdentityAssessment } from './ipod-identity.js';

function model(overrides: Partial<IpodModel>): IpodModel {
  return {
    displayName: 'iPod nano (2nd Generation)',
    generationId: 'nano_2g',
    checksumType: 'none',
    source: 'usb',
    ...overrides,
  };
}

describe('makeUnsupportedReasonFromModel', () => {
  it('returns undefined for a supported model', () => {
    const m = model({ generationId: 'nano_2g' });
    expect(makeUnsupportedReasonFromModel(m)).toBeUndefined();
  });

  it('returns undefined for null / undefined input', () => {
    expect(makeUnsupportedReasonFromModel(null)).toBeUndefined();
    expect(makeUnsupportedReasonFromModel(undefined)).toBeUndefined();
  });

  it('maps a nano 7G (hashAB) to kind=unsupported-device', () => {
    const m = model({
      generationId: 'nano_7g',
      displayName: 'iPod nano (7th Generation)',
      notSupportedReason: 'iPod nano (7th Generation) is not supported by podkit.',
    });
    const reason = makeUnsupportedReasonFromModel(m);
    expect(reason).toBeDefined();
    expect(reason!.kind).toBe('unsupported-device');
    expect(reason!.headline).toBe('iPod nano (7th Generation) is not supported by podkit.');
    expect(reason!.docsUrl).toBe(DOCS_URLS.supportedDevices);
  });

  it('maps an iPod touch (any generation) to kind=ios-device', () => {
    const m = model({
      generationId: 'touch_5g',
      displayName: 'iPod touch 5th generation',
      notSupportedReason: 'iPod touch 5th generation is not supported.',
    });
    const reason = makeUnsupportedReasonFromModel(m);
    expect(reason).toBeDefined();
    expect(reason!.kind).toBe('ios-device');
  });

  it('maps a shuffle 3G to kind=unsupported-device', () => {
    const m = model({
      generationId: 'shuffle_3g',
      displayName: 'iPod shuffle 3rd generation',
      notSupportedReason: 'iPod shuffle 3rd gen requires iTunes authentication.',
    });
    const reason = makeUnsupportedReasonFromModel(m);
    expect(reason!.kind).toBe('unsupported-device');
  });
});

describe('makeUnsupportedReasonFromAssessment', () => {
  function assessment(modelOverrides: Partial<IpodModel>): IpodIdentityAssessment {
    return {
      model: model(modelOverrides),
      capabilities: null,
      needsChecksum: false,
      checksumType: undefined,
      firmwareInquiry: 'unwritable',
      existing: null,
      usbFingerprint: null,
      sysInfoModelNumber: undefined,
    };
  }

  it('returns undefined for a supported assessment', () => {
    const a = assessment({ generationId: 'nano_2g' });
    expect(makeUnsupportedReasonFromAssessment(a)).toBeUndefined();
  });

  it('returns undefined for null / undefined assessment', () => {
    expect(makeUnsupportedReasonFromAssessment(null)).toBeUndefined();
    expect(makeUnsupportedReasonFromAssessment(undefined)).toBeUndefined();
  });

  it('produces the same reason as makeUnsupportedReasonFromModel for a nano 7G assessment', () => {
    const m = model({
      generationId: 'nano_7g',
      displayName: 'iPod nano (7th Generation)',
      notSupportedReason: 'iPod nano (7th Generation) is not supported by podkit.',
    });
    const a: IpodIdentityAssessment = {
      model: m,
      capabilities: null,
      needsChecksum: true,
      checksumType: 'hashAB',
      firmwareInquiry: 'present',
      existing: null,
      usbFingerprint: null,
      sysInfoModelNumber: undefined,
    };
    expect(makeUnsupportedReasonFromAssessment(a)).toEqual(makeUnsupportedReasonFromModel(m));
  });
});

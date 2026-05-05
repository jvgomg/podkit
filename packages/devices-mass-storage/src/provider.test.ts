/**
 * Tests for createMassStorageProvider()
 */

import { describe, expect, it } from 'bun:test';
import { createMassStorageProvider } from './provider.js';
import { BUILT_IN_PRESETS } from './presets/built-in.js';
import type { UsbFingerprint } from '@podkit/device-types';

// =============================================================================
// Helpers
// =============================================================================

/** Minimal UsbFingerprint for Echo Mini (Pioneer 0x071b / 0x3203) */
const ECHO_MINI_FP: UsbFingerprint = {
  vendorId: '0x071b',
  productId: '0x3203',
  bus: 1,
  devnum: 5,
};

/** UsbFingerprint for an unknown device */
const UNKNOWN_FP: UsbFingerprint = {
  vendorId: '0x1234',
  productId: '0x5678',
  bus: 1,
  devnum: 6,
};

// =============================================================================
// Provider identity
// =============================================================================

describe('createMassStorageProvider — provider id', () => {
  it('has id "mass-storage"', () => {
    const provider = createMassStorageProvider(BUILT_IN_PRESETS);
    expect(provider.id).toBe('mass-storage');
  });
});

// =============================================================================
// detect — known device
// =============================================================================

describe('createMassStorageProvider — detect Echo Mini', () => {
  it('returns MassStorageIdentity with presetId "echo-mini" for 0x071b/0x3203', async () => {
    const provider = createMassStorageProvider(BUILT_IN_PRESETS);
    const result = await provider.detect(ECHO_MINI_FP);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('mass-storage');
    expect(result?.presetId).toBe('echo-mini');
  });

  it('propagates serialNumber from the fingerprint', async () => {
    const provider = createMassStorageProvider(BUILT_IN_PRESETS);
    const fp: UsbFingerprint = { ...ECHO_MINI_FP, serialNumber: 'SN-ECHO-001' };
    const result = await provider.detect(fp);
    expect(result?.serialNumber).toBe('SN-ECHO-001');
  });

  it('does not set serialNumber when absent from fingerprint', async () => {
    const provider = createMassStorageProvider(BUILT_IN_PRESETS);
    const result = await provider.detect(ECHO_MINI_FP);
    expect(result?.serialNumber).toBeUndefined();
  });
});

// =============================================================================
// detect — unknown device
// =============================================================================

describe('createMassStorageProvider — detect unknown device', () => {
  it('returns null for unknown VID/PID with no "generic" preset in scope', async () => {
    // Only echo-mini in the preset map — unknown devices should return null
    const provider = createMassStorageProvider({ 'echo-mini': BUILT_IN_PRESETS['echo-mini'] });
    const result = await provider.detect(UNKNOWN_FP);
    expect(result).toBeNull();
  });

  it('returns null for unknown VID/PID with empty preset map', async () => {
    const provider = createMassStorageProvider({});
    const result = await provider.detect(UNKNOWN_FP);
    expect(result).toBeNull();
  });
});

// =============================================================================
// detect — preset scope filtering
// =============================================================================

describe('createMassStorageProvider — preset scope filtering', () => {
  it('returns null for Echo Mini when "echo-mini" is not in the preset map', async () => {
    // Provide only generic — echo-mini hint will be filtered out by identify()
    const provider = createMassStorageProvider({ generic: BUILT_IN_PRESETS['generic'] });
    const result = await provider.detect(ECHO_MINI_FP);
    expect(result).toBeNull();
  });

  it('returns Echo Mini identity when "echo-mini" is in the preset map', async () => {
    const provider = createMassStorageProvider({ 'echo-mini': BUILT_IN_PRESETS['echo-mini'] });
    const result = await provider.detect(ECHO_MINI_FP);
    expect(result?.presetId).toBe('echo-mini');
  });
});

// =============================================================================
// Statelessness — two providers, different preset maps
// =============================================================================

describe('createMassStorageProvider — statelessness', () => {
  it('two providers with different preset maps yield different results for the same fingerprint', async () => {
    // Provider A has echo-mini; provider B does not
    const providerA = createMassStorageProvider({ 'echo-mini': BUILT_IN_PRESETS['echo-mini'] });
    const providerB = createMassStorageProvider({ generic: BUILT_IN_PRESETS['generic'] });

    const resultA = await providerA.detect(ECHO_MINI_FP);
    const resultB = await providerB.detect(ECHO_MINI_FP);

    expect(resultA?.presetId).toBe('echo-mini');
    expect(resultB).toBeNull();
  });

  it('two providers share the same id string', () => {
    const providerA = createMassStorageProvider(BUILT_IN_PRESETS);
    const providerB = createMassStorageProvider({});
    expect(providerA.id).toBe(providerB.id);
  });
});

// =============================================================================
// detect — case-insensitive VID/PID (inherited from identify)
// =============================================================================

describe('createMassStorageProvider — case-insensitive VID/PID', () => {
  it('matches Echo Mini with uppercase hex in fingerprint', async () => {
    const provider = createMassStorageProvider(BUILT_IN_PRESETS);
    const fp: UsbFingerprint = { ...ECHO_MINI_FP, vendorId: '0x071B', productId: '0x3203' };
    const result = await provider.detect(fp);
    expect(result?.presetId).toBe('echo-mini');
  });

  it('matches Echo Mini with bare hex (no 0x prefix) in fingerprint', async () => {
    const provider = createMassStorageProvider(BUILT_IN_PRESETS);
    const fp: UsbFingerprint = { ...ECHO_MINI_FP, vendorId: '071b', productId: '3203' };
    const result = await provider.detect(fp);
    expect(result?.presetId).toBe('echo-mini');
  });
});

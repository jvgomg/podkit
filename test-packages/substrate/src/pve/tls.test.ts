/**
 * Pinning is only worth having if a mismatch stops the request *before* the
 * token is sent, so that ordering is pinned here alongside the comparison
 * itself.
 */

import { describe, it, expect } from 'bun:test';

import {
  fingerprintsMatch,
  normalizeFingerprint,
  resolvePinnedTls,
  PveTlsPinError,
  PveTlsFingerprintFormatError,
  type ProbedCertificate,
} from './tls.js';

const FP = 'a'.repeat(64);
const OTHER_FP = 'b'.repeat(64);

/** The colon-separated spelling `openssl` and `getPeerCertificate` both use. */
function colonized(hex: string): string {
  return (hex.toUpperCase().match(/.{2}/g) ?? []).join(':');
}

function probeYielding(fingerprint256: string): {
  probe: (url: URL) => Promise<ProbedCertificate>;
  calls: URL[];
} {
  const calls: URL[] = [];
  return {
    calls,
    probe: async (url) => {
      calls.push(url);
      return {
        pem: '-----BEGIN CERTIFICATE-----\nZm9v\n-----END CERTIFICATE-----\n',
        fingerprint256,
        subject: 'rae',
      };
    },
  };
}

describe('normalizeFingerprint', () => {
  it('treats the colon-separated and bare spellings as one value', () => {
    expect(normalizeFingerprint(colonized(FP))).toBe(FP);
    expect(fingerprintsMatch(colonized(FP), FP)).toBe(true);
    expect(fingerprintsMatch(FP, OTHER_FP)).toBe(false);
  });

  it('refuses anything that is not a SHA-256 digest', () => {
    // A SHA-1 fingerprint is the likely wrong paste, and it must not read as
    // "the certificate changed".
    expect(() => normalizeFingerprint('a'.repeat(40))).toThrow(PveTlsFingerprintFormatError);
    expect(() => normalizeFingerprint('')).toThrow(PveTlsFingerprintFormatError);
    expect(() => normalizeFingerprint(`${'a'.repeat(63)}z`)).toThrow(PveTlsFingerprintFormatError);
  });
});

describe('resolvePinnedTls', () => {
  const url = new URL('https://pve.example:8006');

  it('pins the probed certificate as the sole CA with verification left on', async () => {
    const { probe, calls } = probeYielding(FP);
    const opts = await resolvePinnedTls(url, colonized(FP), probe);

    expect(calls).toEqual([url]);
    expect(opts.rejectUnauthorized).toBe(true);
    expect(opts.ca).toContain('BEGIN CERTIFICATE');
  });

  it('rejects a mismatch, naming both fingerprints', async () => {
    const { probe } = probeYielding(OTHER_FP);
    const err = await resolvePinnedTls(url, FP, probe).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err).toBeInstanceOf(PveTlsPinError);
    expect(err?.message).toContain(FP);
    expect(err?.message).toContain(OTHER_FP);
    expect(err?.message).toContain('no token was sent');
  });

  it('re-checks the fingerprint on the live connection instead of the hostname', async () => {
    const { probe } = probeYielding(FP);
    const opts = await resolvePinnedTls(url, FP, probe);

    // A name that does not match the certificate is fine; a fingerprint that
    // does not match is not.
    expect(
      opts.checkServerIdentity('some.other.name', { fingerprint256: colonized(FP) })
    ).toBeUndefined();
    expect(
      opts.checkServerIdentity('pve.example', { fingerprint256: colonized(OTHER_FP) })
    ).toBeInstanceOf(PveTlsPinError);
    expect(opts.checkServerIdentity('pve.example', {})).toBeInstanceOf(PveTlsPinError);
  });
});

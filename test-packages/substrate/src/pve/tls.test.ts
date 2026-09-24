/**
 * Pinning is only worth having if a mismatch stops the request *before* the
 * token is sent, so that ordering is pinned here alongside the comparison
 * itself.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  fingerprintsMatch,
  sniFor,
  normalizeFingerprint,
  verifyPinnedCertificate,
  PveTlsPinError,
  PveTlsFingerprintFormatError,
  createPinnedFetch,
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

describe('sniFor', () => {
  it('omits SNI for an address, which TLS forbids and Node refuses', () => {
    // A hypervisor reached by address is the ordinary case; the pin identifies
    // it regardless.
    expect(sniFor('192.168.10.200')).toBeUndefined();
    expect(sniFor('::1')).toBeUndefined();
  });

  it('sends SNI for a name', () => {
    expect(sniFor('pve.example')).toBe('pve.example');
  });
});

describe('verifyPinnedCertificate', () => {
  const url = new URL('https://pve.example:8006');

  it('accepts the pinned certificate in either spelling', async () => {
    const { probe, calls } = probeYielding(FP);
    const presented = await verifyPinnedCertificate(url, colonized(FP), probe);

    expect(calls).toEqual([url]);
    expect(presented.fingerprint256).toBe(FP);
  });

  it('rejects a mismatch, naming both fingerprints', async () => {
    const { probe } = probeYielding(OTHER_FP);
    const err = await verifyPinnedCertificate(url, FP, probe).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err).toBeInstanceOf(PveTlsPinError);
    expect(err?.message).toContain(FP);
    expect(err?.message).toContain(OTHER_FP);
    expect(err?.message).toContain('no token was sent');
  });
});

describe('createPinnedFetch', () => {
  // Enforcement lives on the socket, so it can only be proven against a real
  // handshake. Two higher-level routes were measured returning 200 against a
  // deliberately wrong pin — Bun's `fetch` never calls
  // `tls.checkServerIdentity`, and its `https.request` ignores
  // `createConnection` — which is why this is worth a server.
  let server: https.Server;
  let origin: string;
  let fingerprint: string;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-pin-'));
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    const gen = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=localhost',
      ],
      { encoding: 'utf8' }
    );
    expect(gen.status, `openssl failed: ${gen.stderr}`).toBe(0);
    fingerprint = normalizeFingerprint(
      spawnSync('openssl', ['x509', '-noout', '-fingerprint', '-sha256', '-in', cert], {
        encoding: 'utf8',
      })
        .stdout.split('=')
        .pop()!
        .trim()
    );

    server = https.createServer(
      { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
      (req, res) => {
        res.writeHead(403, 'Permission check failed (/vms/9000, VM.Audit)', {
          'content-type': 'application/json',
        });
        res.end(JSON.stringify({ method: req.method, url: req.url }));
      }
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('talks to the holder of the pinned certificate', async () => {
    const response = await createPinnedFetch(fingerprint)(`${origin}/api2/json/version`, {
      method: 'POST',
      body: 'a=1',
    });
    expect(response.status).toBe(403);
    // PVE reports an ACL denial in the reason phrase and nowhere else, so it
    // has to survive the parse intact.
    expect(response.statusText).toBe('Permission check failed (/vms/9000, VM.Audit)');
    expect(await response.json()).toEqual({ method: 'POST', url: '/api2/json/version' });
  });

  it('tears the connection down before sending anything, on a mismatch', async () => {
    const err = await createPinnedFetch(OTHER_FP)(`${origin}/api2/json/version`).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err).toBeInstanceOf(PveTlsPinError);
    expect(err!.message).toContain('not the pinned');
    expect(err!.message).toContain('before the request was sent');
  });
});

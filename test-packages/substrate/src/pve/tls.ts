/**
 * Certificate pinning for the Proxmox API.
 *
 * A PVE host's certificate is self-signed, so system-CA validation fails
 * against it. doc-060 rules out an insecure flag, so the pin narrows the trust
 * anchor instead of relaxing verification:
 *
 *   1. Probe the presented certificate over a socket that carries no
 *      credentials and is closed immediately.
 *   2. Compare its SHA-256 against the pin. A mismatch aborts before the token
 *      is sent anywhere.
 *   3. Issue every real request with that certificate as the sole `ca`,
 *      `rejectUnauthorized` on, and identity decided by fingerprint.
 *
 * Step 3 closes the gap step 1 opens: the credential-bearing connection
 * validates against an anchor the pin itself validated. The one
 * `rejectUnauthorized: false` in the repo is the probe socket, and no option
 * reaches it. With no pin configured, `fetch` does ordinary CA validation.
 *
 * Identity is the fingerprint, not the hostname: PVE issues its certificate to
 * the node name, which need not match the URL it is reached at.
 *
 * @module
 */

import * as tls from 'node:tls';

/** Fingerprint pinning refused the certificate the host presented. */
export class PveTlsPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PveTlsPinError';
  }
}

/** A malformed value in `PODKIT_PVE_TLS_FINGERPRINT`. */
export class PveTlsFingerprintFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PveTlsFingerprintFormatError';
  }
}

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * Reduce a SHA-256 fingerprint to bare lowercase hex, so the colon-separated
 * form `openssl` prints compares equal to whatever a config file holds.
 *
 * Validated, not just normalised: a malformed pin that silently never matched
 * would read as "the certificate changed" and send the reader to the wrong
 * machine.
 */
export function normalizeFingerprint(raw: string): string {
  const cleaned = raw.trim().replaceAll(':', '').replaceAll(' ', '').toLowerCase();
  if (!HEX_64.test(cleaned)) {
    throw new PveTlsFingerprintFormatError(
      `'${raw}' is not a SHA-256 certificate fingerprint. Expected 64 hex characters, ` +
        `optionally colon-separated, as \`openssl x509 -noout -fingerprint -sha256\` prints ` +
        `them; got ${cleaned.length} character(s) after stripping separators.`
    );
  }
  return cleaned;
}

/** Constant-ish comparison of two fingerprints in any accepted spelling. */
export function fingerprintsMatch(a: string, b: string): boolean {
  return normalizeFingerprint(a) === normalizeFingerprint(b);
}

/** What a probe learns about the certificate a host presents. */
export interface ProbedCertificate {
  /** PEM encoding, suitable for use as a `ca` on a later connection. */
  readonly pem: string;
  /** SHA-256 fingerprint, bare lowercase hex. */
  readonly fingerprint256: string;
  /** Subject common name, for error messages only. */
  readonly subject: string;
}

/** DI seam: obtain the certificate a host presents. */
export type ProbeCertificateFn = (url: URL) => Promise<ProbedCertificate>;

/** Wrap base64 DER at 64 columns, which is what PEM readers expect. */
function derToPem(der: Buffer): string {
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/** How long the credential-free probe waits before giving up. */
export const PROBE_TIMEOUT_MS = 10_000;

/**
 * Read the presented certificate over a socket that sends nothing and is torn
 * down at handshake. The measurement, not the trusted channel — see the module
 * note.
 */
export const probeCertificateOverTls: ProbeCertificateFn = (url) =>
  new Promise<ProbedCertificate>((resolve, reject) => {
    const port = url.port ? Number(url.port) : 443;
    const socket = tls.connect(
      {
        host: url.hostname,
        port,
        servername: url.hostname,
        // Measurement only. The pin is the verification; the connection that
        // carries the token is a separate, verifying one.
        rejectUnauthorized: false,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.destroy();
        if (!cert || !cert.raw) {
          reject(
            new PveTlsPinError(
              `${url.origin} completed a TLS handshake but presented no certificate to pin.`
            )
          );
          return;
        }
        resolve({
          pem: derToPem(cert.raw),
          fingerprint256: normalizeFingerprint(cert.fingerprint256),
          subject: [cert.subject?.CN].flat().filter(Boolean).join(', ') || '(no common name)',
        });
      }
    );
    socket.setTimeout(PROBE_TIMEOUT_MS, () => {
      socket.destroy();
      reject(
        new PveTlsPinError(
          `timed out after ${PROBE_TIMEOUT_MS}ms reading the TLS certificate at ${url.origin}. ` +
            `Check PODKIT_PVE_API_URL, and that the host is reachable from here.`
        )
      );
    });
    socket.on('error', (err: Error) => {
      reject(
        new PveTlsPinError(`cannot reach ${url.origin} to read its TLS certificate: ${err.message}`)
      );
    });
  });

/**
 * TLS settings for a pinned request: the probed certificate as sole trust
 * anchor, chain validation on, identity by fingerprint.
 *
 * A plain object so it can be handed to the runtime's `fetch` as-is. A runtime
 * that ignores it fails the handshake — loudly wrong rather than quietly
 * insecure.
 */
export interface PinnedTlsOptions {
  readonly ca: string;
  readonly rejectUnauthorized: true;
  checkServerIdentity(hostname: string, cert: { fingerprint256?: string }): Error | undefined;
}

/**
 * Verify the pin and build the TLS settings every subsequent request uses.
 *
 * @throws {PveTlsPinError} when the presented certificate is not the pinned
 * one, before any credential leaves this process.
 */
export async function resolvePinnedTls(
  url: URL,
  pinnedFingerprint: string,
  probe: ProbeCertificateFn = probeCertificateOverTls
): Promise<PinnedTlsOptions> {
  const expected = normalizeFingerprint(pinnedFingerprint);
  const presented = await probe(url);

  if (presented.fingerprint256 !== expected) {
    throw new PveTlsPinError(
      `${url.origin} presented a certificate that is not the pinned one, so no token was sent.\n` +
        `  pinned:    ${expected}\n` +
        `  presented: ${presented.fingerprint256}  (subject: ${presented.subject})\n` +
        `If you regenerated the host's certificate, update PODKIT_PVE_TLS_FINGERPRINT in ` +
        `.env.local from \`openssl x509 -noout -fingerprint -sha256 -in ` +
        `/etc/pve/local/pve-ssl.pem\` on the host. If you did not, stop and find out who did.`
    );
  }

  return {
    ca: presented.pem,
    rejectUnauthorized: true,
    checkServerIdentity(_hostname, cert) {
      const live = cert.fingerprint256 ? normalizeFingerprint(cert.fingerprint256) : '';
      if (live === expected) return undefined;
      return new PveTlsPinError(
        `the live connection to ${url.origin} presented ${live || '(no certificate)'}, ` +
          `not the pinned ${expected}.`
      );
    },
  };
}

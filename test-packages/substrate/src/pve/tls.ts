/**
 * Certificate pinning for the Proxmox API (ADR-029 §3).
 *
 * PVE presents only its leaf, signed by a cluster CA that never reaches the
 * wire, so no trust anchor can be obtained from the connection and ordinary
 * chain validation cannot succeed. doc-060 rules out an insecure flag, so the
 * pin *replaces* chain validation rather than being bolted beside it:
 *
 *   1. Probe the presented certificate over a credential-free socket and
 *      compare it to the pin, so a mismatch is diagnosed before a token is
 *      sent anywhere.
 *   2. Issue every request through {@link createPinnedFetch}, which checks the
 *      live certificate's SHA-256 on `secureConnect` and destroys the socket
 *      on mismatch — before a single request byte is written.
 *
 * Step 2 is the enforcement; step 1 only buys a better message. The two
 * `rejectUnauthorized: false` in this file are both paired with that check in
 * the same function, and no option reaches either. Substituting a certificate
 * requires producing one whose SHA-256 equals the pin.
 *
 * Identity is the fingerprint, not the hostname — PVE issues to the node name,
 * which need not match the address it is reached at. SNI is omitted for an
 * address, which TLS forbids there.
 *
 * With no pin configured, `fetch` does ordinary system-CA validation.
 *
 * @module
 */

import * as net from 'node:net';
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
  /**
   * The whole presented chain, PEM-encoded, usable as a `ca`. A leaf alone is
   * not a trust anchor — PVE signs its leaf with a cluster CA, so a chain that
   * stopped at the leaf fails validation with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.
   */
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

/**
 * Leaf first, then each issuer up to the root. A self-signed root points at
 * itself, so the walk stops on a repeat rather than spinning.
 */
function chainToPem(leaf: tls.DetailedPeerCertificate): string {
  const pems: string[] = [];
  const seen = new Set<string>();
  let node: tls.DetailedPeerCertificate | undefined = leaf;
  while (node?.raw && !seen.has(node.fingerprint256)) {
    seen.add(node.fingerprint256);
    pems.push(derToPem(node.raw));
    node = node.issuerCertificate;
  }
  return pems.join('');
}

/** How long the credential-free probe waits before giving up. */
export const PROBE_TIMEOUT_MS = 10_000;

/**
 * SNI for a host, or `undefined` for an IP literal — the TLS spec forbids an
 * address there, and Node rejects it outright. A hypervisor reached by address
 * is the ordinary case, and the pin identifies it anyway.
 */
export function sniFor(hostname: string): string | undefined {
  return net.isIP(hostname) === 0 ? hostname : undefined;
}

/**
 * Read the presented certificate over a socket that sends nothing and is torn
 * down at handshake. The measurement, not the trusted channel — see the module
 * note.
 */
export const probeCertificateOverTls: ProbeCertificateFn = (url) =>
  new Promise<ProbedCertificate>((resolve, reject) => {
    const port = url.port ? Number(url.port) : 443;
    const sni = sniFor(url.hostname);
    const socket = tls.connect(
      {
        host: url.hostname,
        port,
        ...(sni ? { servername: sni } : {}),
        // Measurement only. The pin is the verification; the connection that
        // carries the token is a separate, verifying one.
        rejectUnauthorized: false,
      },
      () => {
        const leaf = socket.getPeerCertificate(true);
        socket.destroy();
        if (!leaf || !leaf.raw) {
          reject(
            new PveTlsPinError(
              `${url.origin} completed a TLS handshake but presented no certificate to pin.`
            )
          );
          return;
        }
        resolve({
          pem: chainToPem(leaf),
          fingerprint256: normalizeFingerprint(leaf.fingerprint256),
          subject: [leaf.subject?.CN].flat().filter(Boolean).join(', ') || '(no common name)',
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
 * Verify the pin against what the host presents, before anything is sent.
 *
 * Diagnosis only — {@link createPinnedFetch} enforces the pin on the
 * connection that carries the token. This runs first so a rotated certificate
 * reads as a named mismatch rather than as a connection error.
 *
 * @throws {PveTlsPinError} when the presented certificate is not the pinned one.
 */
export async function verifyPinnedCertificate(
  url: URL,
  pinnedFingerprint: string,
  probe: ProbeCertificateFn = probeCertificateOverTls
): Promise<ProbedCertificate> {
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
  return presented;
}

type HeaderInput = Record<string, string> | readonly (readonly [string, string])[] | Headers;

function headerEntries(headers: HeaderInput | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers as Record<string, string>;
}

/** Re-join a chunked body. */
function dechunk(body: Buffer): Buffer {
  const parts: Buffer[] = [];
  let at = 0;
  for (;;) {
    const eol = body.indexOf('\r\n', at);
    if (eol < 0) break;
    const size = Number.parseInt(body.toString('ascii', at, eol), 16);
    if (!Number.isFinite(size) || size === 0) break;
    parts.push(body.subarray(eol + 2, eol + 2 + size));
    at = eol + 2 + size + 2;
  }
  return Buffer.concat(parts);
}

/** Turn a raw HTTP/1.1 response into a `Response`. */
function parseResponse(raw: Buffer): Response {
  const split = raw.indexOf('\r\n\r\n');
  const head = raw.toString('latin1', 0, split < 0 ? raw.length : split);
  const [statusLine = '', ...headerLines] = head.split('\r\n');
  const match = /^HTTP\/\d\.\d (\d{3}) ?(.*)$/.exec(statusLine);
  if (!match)
    throw new PveTlsPinError(`the host did not answer with HTTP: ${statusLine.slice(0, 80)}`);

  const headers: [string, string][] = [];
  for (const line of headerLines) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  const chunked = headers.some(
    ([k, v]) => k.toLowerCase() === 'transfer-encoding' && v.toLowerCase().includes('chunked')
  );
  const rawBody = split < 0 ? Buffer.alloc(0) : raw.subarray(split + 4);

  return new Response(chunked ? dechunk(rawBody) : rawBody, {
    status: Number(match[1]),
    // PVE reports an ACL denial in the reason phrase and nowhere else, so it
    // has to survive intact.
    statusText: match[2] ?? '',
    headers,
  });
}

/**
 * A `fetch` that talks only to the holder of the pinned certificate.
 *
 * HTTP is spoken over a socket this function opens, because nothing higher up
 * can be made to enforce a pin on either runtime we use. Measured, both
 * returning 200 against a deliberately wrong pin: Bun's `fetch` never calls
 * `tls.checkServerIdentity`, and its `https.request` ignores
 * `createConnection`. Owning the socket is what makes the check unmissable.
 *
 * Six JSON endpoints and `Connection: close` keep the HTTP small.
 */
export function createPinnedFetch(pinnedFingerprint: string): typeof fetch {
  const expected = normalizeFingerprint(pinnedFingerprint);

  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const port = url.port ? Number(url.port) : 443;
    const sni = sniFor(url.hostname);
    const body = typeof init?.body === 'string' ? init.body : '';
    const headers = headerEntries(init?.headers as HeaderInput | undefined);

    return new Promise<Response>((resolve, reject) => {
      const socket = tls.connect(
        {
          host: url.hostname,
          port,
          // Chain validation is REPLACED by the fingerprint check in the
          // handshake callback below — PVE presents only its leaf, so no
          // anchor to validate against ever reaches the wire. The two are
          // written together so neither can appear without the other.
          rejectUnauthorized: false,
          ...(sni ? { servername: sni } : {}),
        },
        () => {
          const cert = socket.getPeerCertificate();
          const live = cert?.fingerprint256 ? normalizeFingerprint(cert.fingerprint256) : '';
          if (live !== expected) {
            socket.destroy(
              new PveTlsPinError(
                `${url.origin} presented ${live || '(no certificate)'}, not the pinned ` +
                  `${expected}. The connection was torn down before the request was sent.`
              )
            );
            return;
          }
          const lines = [
            `${init?.method ?? 'GET'} ${url.pathname}${url.search} HTTP/1.1`,
            `Host: ${url.host}`,
            'Connection: close',
            'Accept: application/json',
            ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
            ...(body ? [`Content-Length: ${Buffer.byteLength(body)}`] : []),
          ];
          socket.write(`${lines.join('\r\n')}\r\n\r\n${body}`);
        }
      );

      const chunks: Buffer[] = [];
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.on('end', () => {
        try {
          resolve(parseResponse(Buffer.concat(chunks)));
        } catch (err) {
          reject(err);
        }
      });
      socket.on('error', reject);

      const signal = init?.signal;
      if (signal) {
        signal.addEventListener('abort', () => socket.destroy(new Error('request aborted')), {
          once: true,
        });
      }
    });
  }) as typeof fetch;
}

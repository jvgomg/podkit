/**
 * A repo-wide guard on the one thing that would quietly undo certificate
 * pinning: a switch that turns TLS verification off.
 *
 * doc-060 rules one out because of where it ends up — a flag shipped in a
 * public repository gets copied into someone's production automation, where it
 * is permanent and applies to every connection. So the check is not "does this
 * client verify" (the unit tests cover that) but "can anyone ask it not to".
 *
 * Exactly one relaxed socket is allowed: the credential-free probe that obtains
 * the certificate the pin is measured against. Everything else must verify.
 */

import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

import { repoRoot } from '../paths.js';

const PVE_DIR = path.join('test-packages', 'substrate', 'src', 'pve');
/** The probe socket, and this file, which necessarily names what it forbids. */
const ALLOWED = [
  `./${path.join(PVE_DIR, 'tls.ts')}`,
  `./${path.join(PVE_DIR, 'tls-posture.test.ts')}`,
];

/** Source files only — no build output, no dependencies. */
function grepRepo(pattern: string): string[] {
  const result = spawnSync(
    'grep',
    [
      '-rn',
      '--include=*.ts',
      '--include=*.js',
      '--include=*.mjs',
      '--include=*.sh',
      '--include=*.yaml',
      '--exclude-dir=node_modules',
      '--exclude-dir=dist',
      '--exclude-dir=.git',
      '-E',
      pattern,
      '.',
    ],
    { cwd: repoRoot(), encoding: 'utf8' }
  );
  return result.stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .filter((line) => !ALLOWED.some((allowed) => line.startsWith(`${allowed}:`)));
}

describe('TLS posture', () => {
  it('relaxes verification in exactly one place: the credential-free probe', () => {
    expect(grepRepo('rejectUnauthorized:\\s*false')).toEqual([]);
  });

  it('has no environment escape hatch', () => {
    expect(grepRepo('NODE_TLS_REJECT_UNAUTHORIZED')).toEqual([]);
  });

  it('exposes no insecure option, flag or config key', () => {
    // Prose may discuss why there is no such flag; an identifier or a CLI
    // switch would BE one. `--no-verify` is podkit's device-verification flag
    // and has nothing to do with TLS.
    expect(
      grepRepo(
        '(--insecure|--no-check-certificate|PODKIT_[A-Z_]*INSECURE|allowInsecure|insecureTls|skipTlsVerify)'
      )
    ).toEqual([]);
  });
});

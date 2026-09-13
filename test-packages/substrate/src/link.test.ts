/**
 * Unit tests for the substrate link's shared vocabulary.
 *
 * Two things here are load-bearing beyond their size. `resolveGuestArgv` is the
 * single definition of how a caller's command becomes guest argv, which used to
 * exist twice; and `looksLikeSshLinkFailure` is what decides whether a failure
 * is a reason to skip or a reason to fail, so a false positive is a green run
 * that tested nothing.
 */

import { describe, expect, it } from 'bun:test';

import {
  SubstrateLinkError,
  describeGuestCommand,
  guestCommandError,
  isSubstrateLinkError,
  looksLikeLinkFailureResult,
  looksLikeSshLinkFailure,
  resolveGuestArgv,
  shellQuote,
  wrapGuestCommand,
} from './link.js';

describe('resolveGuestArgv', () => {
  it('carries an argv vector verbatim when there is nothing to wrap', () => {
    // No shell at all is the point: `sudo install …` has no quoting surface.
    expect(resolveGuestArgv(['sudo', 'install', '-m', '0755', '/tmp/x', '/usr/bin/x'])).toEqual([
      'sudo',
      'install',
      '-m',
      '0755',
      '/tmp/x',
      '/usr/bin/x',
    ]);
  });

  it('wraps a command string in sh -c', () => {
    expect(resolveGuestArgv('echo hi')).toEqual(['sh', '-c', 'echo hi']);
  });

  it('exports env and cds before the command', () => {
    const argv = resolveGuestArgv('run', { cwd: '/work', env: { FOO: 'bar' } });
    expect(argv.slice(0, 2)).toEqual(['sh', '-c']);
    expect(argv[2]).toContain("export FOO='bar'");
    expect(argv[2]).toContain("cd '/work'");
    expect(argv[2]!.endsWith('run')).toBe(true);
  });

  // Adding a cwd must not change how the command parses. Quoting each argv word
  // is what makes the two forms interchangeable rather than merely similar.
  it('shell-quotes an argv vector word by word when cwd or env forces a shell', () => {
    const argv = resolveGuestArgv(['echo', 'two words', "it's"], { cwd: '/tmp' });
    expect(argv.slice(0, 2)).toEqual(['sh', '-c']);
    expect(argv[2]).toContain(`'echo' 'two words' 'it'\\''s'`);
  });

  it('rejects an env name a shell cannot export', () => {
    expect(() => resolveGuestArgv('run', { env: { 'bad-name': 'x' } })).toThrow(
      /invalid variable name/
    );
  });
});

describe('wrapGuestCommand', () => {
  it('is a no-op when there is no cwd and no env', () => {
    expect(wrapGuestCommand('true')).toBe('true');
  });
});

describe('shellQuote', () => {
  it('survives an embedded single quote', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe('looksLikeSshLinkFailure', () => {
  const linkFailures = [
    'ssh: connect to host 127.0.0.1 port 60022: Connection refused',
    'ssh: connect to host podkit-substrate port 22: Operation timed out',
    'ssh: Could not resolve hostname podkit-substrate: nodename nor servname provided',
    'kex_exchange_identification: read: Connection reset by peer',
    'Host key verification failed.',
    'james@host: Permission denied (publickey).',
    'Connection closed by 192.0.2.1 port 22',
    'Connection reset by 192.0.2.1 port 22',
    'client_loop: send disconnect: Broken pipe',
    'scp: lost connection',
  ];
  for (const stderr of linkFailures) {
    it(`recognises: ${stderr.slice(0, 48)}`, () => {
      expect(looksLikeSshLinkFailure(stderr)).toBe(true);
    });
  }

  // The reason the patterns are anchored on ssh's own framing. Every string
  // below is a GUEST command failing, and reading any of them as "the substrate
  // is unreachable" would turn a real failure into a skip — the one outcome
  // ADR-028 §5 rules out.
  const guestFailures = [
    'systemctl: Failed to reload daemon: Connection refused',
    'curl: (7) Failed to connect to localhost port 4533: Connection refused',
    'psql: could not connect to server: Connection reset by peer',
    'rsync: connection unexpectedly closed',
    'mount: /mnt: No route to host.',
    'sh: 1: podkit: not found',
    'install: cannot create regular file: Permission denied',
  ];
  for (const stderr of guestFailures) {
    it(`does not mistake a guest failure for a link failure: ${stderr.slice(0, 44)}`, () => {
      expect(looksLikeSshLinkFailure(stderr)).toBe(false);
    });
  }

  it('says nothing about an empty stderr', () => {
    expect(looksLikeSshLinkFailure('')).toBe(false);
  });
});

describe('looksLikeLinkFailureResult', () => {
  const stderr = 'Connection reset by 192.0.2.1 port 22';

  it('reads a silent, ssh-shaped failure as the link dying', () => {
    expect(looksLikeLinkFailureResult({ stdout: '', stderr, exitCode: 255 })).toBe(true);
  });

  // The gate the bare stderr predicate cannot apply, and the one realistic way
  // ssh's vocabulary reaches a healthy substrate's stderr: a guest command
  // running its OWN ssh/scp/rsync against a third host. It spoke, so something
  // was there to speak — calling that an unreachable substrate would turn a
  // real failure into a skipped test.
  it('refuses to convict when the guest produced output of its own', () => {
    expect(looksLikeLinkFailureResult({ stdout: 'syncing 3 files\n', stderr, exitCode: 255 })).toBe(
      false
    );
  });

  it('is unmoved by an empty result with nothing ssh-shaped in it', () => {
    expect(looksLikeLinkFailureResult({ stdout: '', stderr: 'oops', exitCode: 1 })).toBe(false);
  });
});

describe('SubstrateLinkError', () => {
  // Callers branch on the TYPE, never on the message — that is the whole
  // reason the type exists, and a narrowing helper is what keeps them honest.
  it('narrows, and carries the substrate and operation as data', () => {
    const err: unknown = new SubstrateLinkError({
      substrateId: 'device',
      operation: 'copyIn',
      message: 'boom',
    });
    expect(isSubstrateLinkError(err)).toBe(true);
    if (!isSubstrateLinkError(err)) throw new Error('unreachable');
    expect(err.substrateId).toBe('device');
    expect(err.operation).toBe('copyIn');
    expect(err.name).toBe('SubstrateLinkError');
  });

  it('is not confused with an ordinary Error', () => {
    expect(isSubstrateLinkError(new Error('boom'))).toBe(false);
    expect(isSubstrateLinkError('boom')).toBe(false);
  });
});

describe('describeGuestCommand', () => {
  it('renders both command forms for a message', () => {
    expect(describeGuestCommand('echo hi')).toBe('echo hi');
    expect(describeGuestCommand(['echo', 'hi'])).toBe('echo hi');
  });

  // Generated build scripts run to hundreds of characters. Echoing one whole
  // makes the message unreadable, which loses the sentence that said why.
  it('truncates a long command and says how long it was', () => {
    const long = 'x'.repeat(400);
    const rendered = describeGuestCommand(long);
    expect(rendered.length).toBeLessThan(long.length);
    expect(rendered).toContain('(400 chars)');
  });
});

describe('guestCommandError', () => {
  it('leads with the guest stderr', () => {
    expect(
      guestCommandError('failed to probe', { stdout: 'out', stderr: 'no such file', exitCode: 1 })
        .message
    ).toBe('failed to probe: exit=1: no such file');
  });

  it('falls back to stdout for tools that report on the wrong stream', () => {
    expect(
      guestCommandError('failed', { stdout: 'oops', stderr: '', exitCode: 2 }).message
    ).toContain('oops');
  });

  // "exit=1" and nothing else is the log line that sends a reader to open a
  // shell on the substrate to find out what happened.
  it('says so explicitly when the guest said nothing at all', () => {
    expect(guestCommandError('failed', { stdout: '', stderr: '', exitCode: 7 }).message).toBe(
      'failed: exit=7: (no output, exit=7)'
    );
  });
});

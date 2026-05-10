import { describe, expect, it } from 'bun:test';
import { CliError, runAction } from '../errors.js';
import { BufferExitCodeSink, OutputContext } from '../output/index.js';
import { BufferSink } from './buffer-sink.js';
import { expectCliError } from './cli-error.js';

function makeOut() {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const exitCode = new BufferExitCodeSink();
  const out = new OutputContext({
    mode: 'json',
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
    stdout,
    stderr,
    exitCode,
  });
  return { out, stdout, stderr, exitCode };
}

describe('expectCliError', () => {
  it('matches code exactly and returns the parsed payload', async () => {
    const { out, stdout, exitCode } = makeOut();
    await runAction(out, async () => {
      throw new CliError({ message: 'no device', code: 'NO_DEVICE' });
    });

    const payload = expectCliError(stdout, exitCode, { code: 'NO_DEVICE' });

    expect(payload.error).toBe('no device');
    expect(payload.code).toBe('NO_DEVICE');
    expect(payload.success).toBe(false);
  });

  it('substring-matches error when given a string', async () => {
    const { out, stdout, exitCode } = makeOut();
    await runAction(out, async () => {
      throw new CliError({ message: 'Mount failed for /dev/disk4', code: 'MOUNT_FAILED' });
    });

    expectCliError(stdout, exitCode, {
      code: 'MOUNT_FAILED',
      error: 'Mount failed',
    });
  });

  it('regex-matches error when given a RegExp', async () => {
    const { out, stdout, exitCode } = makeOut();
    await runAction(out, async () => {
      throw new CliError({
        message: 'FFmpeg not available: spawn ffmpeg ENOENT',
        code: 'FFMPEG_UNAVAILABLE',
      });
    });

    expectCliError(stdout, exitCode, {
      code: 'FFMPEG_UNAVAILABLE',
      error: /FFmpeg.*ENOENT/,
    });
  });

  it('checks nested details with toMatchObject semantics', async () => {
    const { out, stdout, exitCode } = makeOut();
    await runAction(out, async () => {
      throw new CliError({
        message: 'mount sudo',
        code: 'MOUNT_REQUIRES_SUDO',
        details: { device: '/dev/disk4s2', requiresSudo: true, extra: 'ignored' },
      });
    });

    expectCliError(stdout, exitCode, {
      code: 'MOUNT_REQUIRES_SUDO',
      details: { device: '/dev/disk4s2', requiresSudo: true },
    });
  });

  it('asserts exitCode 1 by default', async () => {
    const { out, stdout, exitCode } = makeOut();
    await runAction(out, async () => {
      throw new CliError({ message: 'x', code: 'X' });
    });

    expectCliError(stdout, exitCode, { code: 'X' });
  });

  it('asserts a custom exitCode when provided', async () => {
    const { out, stdout, exitCode } = makeOut();
    await runAction(out, async () => {
      throw new CliError({ message: 'x', code: 'X', exitCode: 7 });
    });

    expectCliError(stdout, exitCode, { code: 'X', exitCode: 7 });
  });

  it('throws when code mismatches', async () => {
    const { out, stdout, exitCode } = makeOut();
    await runAction(out, async () => {
      throw new CliError({ message: 'a', code: 'A' });
    });

    expect(() => expectCliError(stdout, exitCode, { code: 'B' })).toThrow();
  });
});

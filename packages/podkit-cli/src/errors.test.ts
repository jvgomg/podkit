import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { CliError, runAction } from './errors.js';
import { OutputContext } from './output/index.js';
import { BufferSink } from './test-utils/buffer-sink.js';

const makeOut = (
  mode: 'json' | 'text' = 'text',
  stdout = new BufferSink(),
  stderr = new BufferSink()
) => ({
  out: new OutputContext({
    mode,
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
    stdout,
    stderr,
  }),
  stdout,
  stderr,
});

describe('CliError', () => {
  it('captures message, code, exitCode, details', () => {
    const err = new CliError({
      message: 'Path not found',
      code: 'PATH_NOT_FOUND',
      exitCode: 2,
      details: { path: '/missing' },
    });
    expect(err.message).toBe('Path not found');
    expect(err.code).toBe('PATH_NOT_FOUND');
    expect(err.exitCode).toBe(2);
    expect(err.details).toEqual({ path: '/missing' });
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults exitCode to 1 when omitted', () => {
    const err = new CliError({ message: 'oops', code: 'OOPS' });
    expect(err.exitCode).toBe(1);
  });

  it('stores details verbatim — no spread, no key collision', () => {
    const err = new CliError({
      message: 'real message',
      code: 'REAL_CODE',
      details: { error: 'kept', success: true, code: 'kept', other: 'kept' },
    });
    expect(err.details).toEqual({
      error: 'kept',
      success: true,
      code: 'kept',
      other: 'kept',
    });
  });
});

describe('runAction', () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('returns the runner result on success', async () => {
    const { out } = makeOut();
    const result = await runAction(out, async () => 42);
    expect(result).toBe(42);
    expect(process.exitCode).toBe(0);
  });

  it('translates CliError to exit code + stderr text', async () => {
    const { out, stderr } = makeOut('text');
    await runAction(out, async () => {
      throw new CliError({ message: 'bad path', code: 'PATH_REQUIRED' });
    });
    expect(process.exitCode).toBe(1);
    expect(stderr.text()).toBe('bad path\n');
  });

  it('translates CliError to JSON payload in JSON mode', async () => {
    const { out, stdout } = makeOut('json');
    await runAction(out, async () => {
      throw new CliError({
        message: 'no device',
        code: 'NO_DEVICE',
        details: { searched: '/Volumes' },
      });
    });
    expect(process.exitCode).toBe(1);
    expect(stdout.json<Record<string, unknown>>()).toEqual({
      success: false,
      error: 'no device',
      code: 'NO_DEVICE',
      details: { searched: '/Volumes' },
    });
  });

  it('emits details: {} when CliError has no details', async () => {
    const { out, stdout } = makeOut('json');
    await runAction(out, async () => {
      throw new CliError({ message: 'plain', code: 'PLAIN' });
    });
    expect(stdout.json<Record<string, unknown>>()).toEqual({
      success: false,
      error: 'plain',
      code: 'PLAIN',
      details: {},
    });
  });

  it('preserves reserved-key names inside nested details (no spread)', async () => {
    const { out, stdout } = makeOut('json');
    await runAction(out, async () => {
      throw new CliError({
        message: 'real',
        code: 'REAL',
        details: { error: 'kept', success: true, code: 'kept', extra: 1 },
      });
    });
    expect(stdout.json<Record<string, unknown>>()).toEqual({
      success: false,
      error: 'real',
      code: 'REAL',
      details: { error: 'kept', success: true, code: 'kept', extra: 1 },
    });
  });

  it('uses custom exitCode from CliError', async () => {
    const { out } = makeOut();
    await runAction(out, async () => {
      throw new CliError({ message: 'x', code: 'X', exitCode: 7 });
    });
    expect(process.exitCode).toBe(7);
  });

  it('uses CliError.printText for multi-line text output', async () => {
    const { out, stderr } = makeOut('text');
    await runAction(out, async () => {
      throw new CliError({
        message: 'mount failed',
        code: 'MOUNT_FAILED',
        printText: (o) => {
          o.error('mount failed');
          o.error('  try: sudo podkit mount');
        },
      });
    });
    expect(stderr.text()).toBe('mount failed\n  try: sudo podkit mount\n');
  });

  it('writes exit code via OutputContext sink, not process.exitCode directly', async () => {
    const stdout = new BufferSink();
    const stderr = new BufferSink();
    const { BufferExitCodeSink } = await import('./output/index.js');
    const sink = new BufferExitCodeSink();
    const out = new OutputContext({
      mode: 'json',
      quiet: false,
      verbose: 0,
      color: false,
      tips: false,
      tty: false,
      stdout,
      stderr,
      exitCode: sink,
    });
    const before = process.exitCode;
    await runAction(out, async () => {
      throw new CliError({ message: 'sink test', code: 'SINK_TEST', exitCode: 42 });
    });
    expect(sink.get()).toBe(42);
    // process.exitCode is untouched when a sink is configured
    expect(process.exitCode).toBe(before);
  });

  it('rethrows non-CliError exceptions', async () => {
    const { out } = makeOut();
    await expect(
      runAction(out, async () => {
        throw new TypeError('not a CliError');
      })
    ).rejects.toThrow(TypeError);
  });
});

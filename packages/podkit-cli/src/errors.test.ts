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

  it('defaults code to UNKNOWN and exitCode to 1', () => {
    const err = new CliError({ message: 'oops' });
    expect(err.code).toBe('UNKNOWN');
    expect(err.exitCode).toBe(1);
  });
});

describe('runAction', () => {
  let originalExitCode: number | undefined;

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
    expect(stdout.json()).toEqual({
      success: false,
      error: 'no device',
      code: 'NO_DEVICE',
      searched: '/Volumes',
    });
  });

  it('uses custom exitCode from CliError', async () => {
    const { out } = makeOut();
    await runAction(out, async () => {
      throw new CliError({ message: 'x', exitCode: 7 });
    });
    expect(process.exitCode).toBe(7);
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

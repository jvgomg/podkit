import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { CliError, runAction } from './errors.js';
import { OutputContext } from './output/index.js';

const makeOut = (mode: 'json' | 'text' = 'text') =>
  new OutputContext({
    mode,
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
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
    const result = await runAction(makeOut(), async () => 42);
    expect(result).toBe(42);
    expect(process.exitCode).toBe(0);
  });

  it('translates CliError to exit code + stderr text', async () => {
    const errSpy = mock(() => {});
    const origErr = console.error;
    console.error = errSpy;
    try {
      await runAction(makeOut(), async () => {
        throw new CliError({ message: 'bad path', code: 'PATH_REQUIRED' });
      });
    } finally {
      console.error = origErr;
    }
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith('bad path');
  });

  it('translates CliError to JSON payload in JSON mode', async () => {
    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy;
    try {
      await runAction(makeOut('json'), async () => {
        throw new CliError({
          message: 'no device',
          code: 'NO_DEVICE',
          details: { searched: '/Volumes' },
        });
      });
    } finally {
      console.log = origLog;
    }
    expect(process.exitCode).toBe(1);
    const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(payload).toEqual({
      success: false,
      error: 'no device',
      code: 'NO_DEVICE',
      searched: '/Volumes',
    });
  });

  it('uses custom exitCode from CliError', async () => {
    await runAction(makeOut(), async () => {
      throw new CliError({ message: 'x', exitCode: 7 });
    });
    expect(process.exitCode).toBe(7);
  });

  it('rethrows non-CliError exceptions', async () => {
    await expect(
      runAction(makeOut(), async () => {
        throw new TypeError('not a CliError');
      })
    ).rejects.toThrow(TypeError);
  });
});

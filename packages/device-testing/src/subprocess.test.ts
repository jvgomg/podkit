/**
 * Unit tests for the subprocess capture/replay framework.
 *
 * Covers:
 * - `defaultSubprocessRunner` actually runs a binary and captures output.
 * - `hashSubprocessCall` is stable for equivalent calls and differs for
 *   different inputs (including env-key reordering).
 * - `CapturingSubprocessRunner` writes a fixture JSON keyed by the hash and
 *   forwards the live result.
 * - `ReplaySubprocessRunner` returns a recorded fixture for a matching call
 *   and throws an actionable error on miss.
 * - `createSubprocessRunner` selects the right runner per env vars.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  defaultSubprocessRunner,
  hashSubprocessCall,
  CapturingSubprocessRunner,
  ReplaySubprocessRunner,
  createSubprocessRunner,
  type SubprocessFixture,
  type SubprocessRunner,
  type SubprocessRunOpts,
  type SubprocessRunResult,
} from './subprocess.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-subprocess-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// defaultSubprocessRunner
// ---------------------------------------------------------------------------

describe('defaultSubprocessRunner', () => {
  it.skipIf(process.platform === 'win32')(
    'runs a real binary and captures stdout + exit code',
    async () => {
      const result = await defaultSubprocessRunner.run('echo', ['hello']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
      expect(result.stderr).toBe('');
    }
  );

  it.skipIf(process.platform === 'win32')(
    'resolves with non-zero exit code rather than rejecting',
    async () => {
      // `sh -c "exit 3"` is reliable on macOS and Linux.
      const result = await defaultSubprocessRunner.run('sh', ['-c', 'exit 3']);
      expect(result.exitCode).toBe(3);
    }
  );

  it('rejects for an unknown binary (transport failure)', async () => {
    await expect(
      defaultSubprocessRunner.run('podkit-nonexistent-binary-zzz', [])
    ).rejects.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// hashSubprocessCall
// ---------------------------------------------------------------------------

describe('hashSubprocessCall', () => {
  it('produces the same hash for identical inputs', () => {
    const a = hashSubprocessCall('lsblk', ['-J']);
    const b = hashSubprocessCall('lsblk', ['-J']);
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it('produces a different hash when args differ', () => {
    expect(hashSubprocessCall('lsblk', ['-J'])).not.toBe(hashSubprocessCall('lsblk', ['-J', '-b']));
  });

  it('produces a different hash when the command differs', () => {
    expect(hashSubprocessCall('lsblk', ['-J'])).not.toBe(hashSubprocessCall('lsusb', ['-J']));
  });

  it('produces a different hash when cwd differs', () => {
    expect(hashSubprocessCall('ls', [], { cwd: '/a' })).not.toBe(
      hashSubprocessCall('ls', [], { cwd: '/b' })
    );
  });

  it('is insensitive to env-key insertion order', () => {
    const a = hashSubprocessCall('ffmpeg', [], { env: { A: '1', B: '2' } });
    const b = hashSubprocessCall('ffmpeg', [], { env: { B: '2', A: '1' } });
    expect(a).toBe(b);
  });

  it('treats absent cwd/env the same as null cwd/env', () => {
    const a = hashSubprocessCall('ffmpeg', ['-encoders']);
    const b = hashSubprocessCall('ffmpeg', ['-encoders'], {});
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// CapturingSubprocessRunner
// ---------------------------------------------------------------------------

function makeFakeRunner(result: SubprocessRunResult): {
  runner: SubprocessRunner;
  calls: Array<{ command: string; args: string[]; opts?: SubprocessRunOpts }>;
} {
  const calls: Array<{ command: string; args: string[]; opts?: SubprocessRunOpts }> = [];
  return {
    calls,
    runner: {
      async run(command, args, opts) {
        calls.push({ command, args, opts });
        return result;
      },
    },
  };
}

describe('CapturingSubprocessRunner', () => {
  it('forwards the inner result and writes a fixture file keyed by hash', async () => {
    const { runner: inner } = makeFakeRunner({
      stdout: 'sample-stdout',
      stderr: 'sample-stderr',
      exitCode: 0,
    });
    const capturing = new CapturingSubprocessRunner(inner, tmpRoot);

    const result = await capturing.run('lsblk', ['-J']);
    expect(result.stdout).toBe('sample-stdout');
    expect(result.exitCode).toBe(0);

    const hash = hashSubprocessCall('lsblk', ['-J']);
    const fixturePath = path.join(tmpRoot, `${hash}.json`);
    expect(fs.existsSync(fixturePath)).toBe(true);

    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as SubprocessFixture;
    expect(fixture.command).toBe('lsblk');
    expect(fixture.args).toEqual(['-J']);
    expect(fixture.stdout).toBe('sample-stdout');
    expect(fixture.stderr).toBe('sample-stderr');
    expect(fixture.exitCode).toBe(0);
    expect(typeof fixture.capturedAt).toBe('string');
  });

  it('records cwd + env in the fixture when present', async () => {
    const { runner: inner } = makeFakeRunner({ stdout: '', stderr: '', exitCode: 0 });
    const capturing = new CapturingSubprocessRunner(inner, tmpRoot);

    await capturing.run('ffmpeg', ['-encoders'], {
      cwd: '/tmp',
      env: { FFMPEG_PATH: 'ffmpeg' },
    });

    const hash = hashSubprocessCall('ffmpeg', ['-encoders'], {
      cwd: '/tmp',
      env: { FFMPEG_PATH: 'ffmpeg' },
    });
    const fixture = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, `${hash}.json`), 'utf8')
    ) as SubprocessFixture;

    expect(fixture.opts.cwd).toBe('/tmp');
    expect(fixture.opts.env).toEqual({ FFMPEG_PATH: 'ffmpeg' });
  });

  it('creates the fixture directory if missing', async () => {
    const nested = path.join(tmpRoot, 'a', 'b', 'c');
    const { runner: inner } = makeFakeRunner({ stdout: 'x', stderr: '', exitCode: 0 });
    const capturing = new CapturingSubprocessRunner(inner, nested);

    await capturing.run('echo', ['x']);
    expect(fs.existsSync(nested)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ReplaySubprocessRunner
// ---------------------------------------------------------------------------

describe('ReplaySubprocessRunner', () => {
  it('returns the recorded result for a matching call', async () => {
    const hash = hashSubprocessCall('lsblk', ['-J']);
    const fixture: SubprocessFixture = {
      command: 'lsblk',
      args: ['-J'],
      opts: {},
      stdout: '{"blockdevices":[]}',
      stderr: '',
      exitCode: 0,
      capturedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(tmpRoot, `${hash}.json`), JSON.stringify(fixture));

    const replay = new ReplaySubprocessRunner(tmpRoot);
    const result = await replay.run('lsblk', ['-J']);
    expect(result.stdout).toBe('{"blockdevices":[]}');
    expect(result.exitCode).toBe(0);
  });

  it('throws an actionable error on miss', async () => {
    const replay = new ReplaySubprocessRunner(tmpRoot);
    let caught: Error | undefined;
    try {
      await replay.run('lsblk', ['-J']);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain("command='lsblk'");
    expect(caught!.message).toContain('args=["-J"]');
    expect(caught!.message).toContain('PODKIT_SNAPSHOT_CAPTURE=1');
    expect(caught!.message).toContain(`PODKIT_SNAPSHOT_DIR=${tmpRoot}`);
  });

  it('round-trips a captured fixture through replay', async () => {
    const { runner: inner } = makeFakeRunner({
      stdout: 'captured',
      stderr: 'warn',
      exitCode: 2,
    });
    const capturing = new CapturingSubprocessRunner(inner, tmpRoot);
    await capturing.run('diskutil', ['info', 'disk5'], { cwd: '/tmp' });

    const replay = new ReplaySubprocessRunner(tmpRoot);
    const result = await replay.run('diskutil', ['info', 'disk5'], { cwd: '/tmp' });
    expect(result).toEqual({ stdout: 'captured', stderr: 'warn', exitCode: 2 });
  });
});

// ---------------------------------------------------------------------------
// createSubprocessRunner
// ---------------------------------------------------------------------------

describe('createSubprocessRunner', () => {
  it('returns the default runner when no env vars are set', () => {
    const runner = createSubprocessRunner({});
    expect(runner).toBe(defaultSubprocessRunner);
  });

  it('returns a CapturingSubprocessRunner when PODKIT_SNAPSHOT_CAPTURE=1', () => {
    const runner = createSubprocessRunner({
      PODKIT_SNAPSHOT_CAPTURE: '1',
      PODKIT_SNAPSHOT_DIR: tmpRoot,
    });
    expect(runner).toBeInstanceOf(CapturingSubprocessRunner);
  });

  it('returns a ReplaySubprocessRunner when PODKIT_SNAPSHOT_REPLAY=1', () => {
    const runner = createSubprocessRunner({
      PODKIT_SNAPSHOT_REPLAY: '1',
      PODKIT_SNAPSHOT_DIR: tmpRoot,
    });
    expect(runner).toBeInstanceOf(ReplaySubprocessRunner);
  });

  it('throws when both capture and replay are requested', () => {
    expect(() =>
      createSubprocessRunner({
        PODKIT_SNAPSHOT_CAPTURE: '1',
        PODKIT_SNAPSHOT_REPLAY: '1',
        PODKIT_SNAPSHOT_DIR: tmpRoot,
      })
    ).toThrow(/choose one/);
  });

  it('throws when capture is requested without PODKIT_SNAPSHOT_DIR', () => {
    expect(() => createSubprocessRunner({ PODKIT_SNAPSHOT_CAPTURE: '1' })).toThrow(
      /PODKIT_SNAPSHOT_DIR/
    );
  });

  it('throws when replay is requested without PODKIT_SNAPSHOT_DIR', () => {
    expect(() => createSubprocessRunner({ PODKIT_SNAPSHOT_REPLAY: '1' })).toThrow(
      /PODKIT_SNAPSHOT_DIR/
    );
  });
});

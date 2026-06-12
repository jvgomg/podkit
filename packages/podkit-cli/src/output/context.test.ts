import { describe, expect, it, beforeEach, afterEach, spyOn } from 'bun:test';
import { OutputContext } from './context.js';
import { nullSpinner } from './types.js';

// =============================================================================
// TTY-aware interactive output
// =============================================================================

describe('OutputContext TTY detection', () => {
  let stderrWrite: ReturnType<typeof spyOn>;
  let stdoutWrite: ReturnType<typeof spyOn>;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    stderrWrite = spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutWrite = spyOn(process.stdout, 'write').mockImplementation(() => true);
    originalIsTTY = process.stdout.isTTY;
  });

  afterEach(() => {
    stderrWrite.mockRestore();
    stdoutWrite.mockRestore();
    // @ts-expect-error — restore isTTY
    process.stdout.isTTY = originalIsTTY;
  });

  describe('spinner suppression', () => {
    it('returns nullSpinner when tty=false (--no-tty flag)', () => {
      const out = new OutputContext({
        mode: 'text',
        quiet: false,
        verbose: 0,
        color: false,
        tips: false,
        tty: false,
      });
      const spinner = out.spinner('Loading...');
      expect(spinner).toBe(nullSpinner);
    });

    it('returns nullSpinner when quiet=true (--quiet superset)', () => {
      const out = new OutputContext({
        mode: 'text',
        quiet: true,
        verbose: 0,
        color: false,
        tips: false,
        tty: true,
      });
      const spinner = out.spinner('Loading...');
      expect(spinner).toBe(nullSpinner);
    });

    it('returns nullSpinner in JSON mode', () => {
      const out = new OutputContext({
        mode: 'json',
        quiet: false,
        verbose: 0,
        color: false,
        tips: false,
        tty: true,
      });
      const spinner = out.spinner('Loading...');
      expect(spinner).toBe(nullSpinner);
    });

    it('returns real spinner when tty=true and text mode and not quiet', () => {
      const out = new OutputContext({
        mode: 'text',
        quiet: false,
        verbose: 0,
        color: false,
        tips: false,
        tty: true,
      });
      const spinner = out.spinner('Loading...');
      // Real spinner is not nullSpinner — it has a stop that actually writes
      expect(spinner).not.toBe(nullSpinner);
      spinner.stop();
      // stop() clears the line via stderr
      expect(stderrWrite).toHaveBeenCalled();
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it('real spinner stop() with final message writes to stderr', () => {
      const out = new OutputContext({
        mode: 'text',
        quiet: false,
        verbose: 0,
        color: false,
        tips: false,
        tty: true,
      });
      const spinner = out.spinner('Loading...');
      spinner.stop('Done!');
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Done!'));
      expect(stdoutWrite).not.toHaveBeenCalled();
    });
  });

  describe('clearLine() routes to stderr', () => {
    it('writes to stderr when tty=true', () => {
      const out = new OutputContext({
        mode: 'text',
        quiet: false,
        verbose: 0,
        color: false,
        tips: false,
        tty: true,
      });
      out.clearLine();
      expect(stderrWrite).toHaveBeenCalledWith('\x1b[2K\r');
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it('suppresses output when tty=false', () => {
      const out = new OutputContext({
        mode: 'text',
        quiet: false,
        verbose: 0,
        color: false,
        tips: false,
        tty: false,
      });
      out.clearLine();
      expect(stderrWrite).not.toHaveBeenCalled();
    });
  });

  describe('raw() routes to stderr', () => {
    it('writes to stderr (not stdout) when tty=true', () => {
      const out = new OutputContext({
        mode: 'text',
        quiet: false,
        verbose: 0,
        color: false,
        tips: false,
        tty: true,
      });
      out.raw('progress content');
      expect(stderrWrite).toHaveBeenCalledWith('progress content');
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it('suppresses output when tty=false', () => {
      const out = new OutputContext({
        mode: 'text',
        quiet: false,
        verbose: 0,
        color: false,
        tips: false,
        tty: false,
      });
      out.raw('progress content');
      expect(stderrWrite).not.toHaveBeenCalled();
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it('suppresses output when quiet=true', () => {
      const out = new OutputContext({
        mode: 'text',
        quiet: true,
        verbose: 0,
        color: false,
        tips: false,
        tty: true,
      });
      out.raw('progress content');
      expect(stderrWrite).not.toHaveBeenCalled();
    });
  });

  describe('fromGlobalOpts TTY auto-detection', () => {
    it('sets tty=false when process.stdout.isTTY is undefined (piped)', () => {
      // @ts-expect-error — simulate piped stdout
      process.stdout.isTTY = undefined;
      const out = OutputContext.fromGlobalOpts({
        json: false,
        quiet: false,
        verbose: 0,
        color: false,
        tty: true, // --no-tty not set
      });
      // raw() should be suppressed (no write to stderr)
      out.raw('test');
      expect(stderrWrite).not.toHaveBeenCalled();
    });

    it('sets tty=false when --no-tty flag is passed (even if stdout is TTY)', () => {
      process.stdout.isTTY = true;
      const out = OutputContext.fromGlobalOpts({
        json: false,
        quiet: false,
        verbose: 0,
        color: false,
        tty: false, // --no-tty passed
      });
      out.raw('test');
      expect(stderrWrite).not.toHaveBeenCalled();
    });

    it('enables interactive output when stdout is TTY and --no-tty not set', () => {
      process.stdout.isTTY = true;
      const out = OutputContext.fromGlobalOpts({
        json: false,
        quiet: false,
        verbose: 0,
        color: false,
        tty: true, // --no-tty not set
      });
      out.raw('test');
      expect(stderrWrite).toHaveBeenCalledWith('test');
    });
  });

  describe('--quiet is a superset of --no-tty', () => {
    it('quiet suppresses spinner even when tty=true', () => {
      const out = new OutputContext({
        mode: 'text',
        quiet: true,
        verbose: 0,
        color: false,
        tips: false,
        tty: true,
      });
      expect(out.spinner('test')).toBe(nullSpinner);
    });

    it('quiet suppresses raw() even when tty=true', () => {
      const out = new OutputContext({
        mode: 'text',
        quiet: true,
        verbose: 0,
        color: false,
        tips: false,
        tty: true,
      });
      out.raw('test');
      expect(stderrWrite).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// progress() / clearProgress()
// =============================================================================

describe('OutputContext.progress / clearProgress', () => {
  // Import BufferSink inside the describe so tests can construct fresh sinks
  // per-case without polluting the TTY-suite's global mocks.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BufferSink } =
    require('../test-utils/buffer-sink.js') as typeof import('../test-utils/buffer-sink.js');

  function makeOut(
    opts: {
      mode?: 'json' | 'text';
      quiet?: boolean;
      tty?: boolean;
    } = {}
  ): {
    out: OutputContext;
    stdout: InstanceType<typeof BufferSink>;
    stderr: InstanceType<typeof BufferSink>;
  } {
    const stdout = new BufferSink();
    const stderr = new BufferSink();
    const out = new OutputContext({
      mode: opts.mode ?? 'text',
      quiet: opts.quiet ?? false,
      verbose: 0,
      color: false,
      tips: false,
      tty: opts.tty ?? true,
      stdout,
      stderr,
    });
    return { out, stdout, stderr };
  }

  describe('TTY text mode', () => {
    it('writes "\\r<line>" to stderr', () => {
      const { out, stderr } = makeOut({ tty: true });
      out.progress('  1 / 10  (10%)');
      expect(stderr.text()).toBe('\r  1 / 10  (10%)');
    });

    it('overwrites the previous progress line on subsequent calls', () => {
      const { out, stderr } = makeOut({ tty: true });
      out.progress('aaa');
      out.progress('bbb');
      // Each progress write prepends \r and the new line; the terminal
      // overwrites visually. The sink just records both writes verbatim.
      expect(stderr.text()).toBe('\raaa\rbbb');
    });

    it('clearProgress writes \\r + spaces sized to the widest line + \\r', () => {
      const { out, stderr } = makeOut({ tty: true });
      out.progress('short');
      out.progress('a much longer progress line here');
      out.clearProgress();
      expect(stderr.text()).toBe(
        '\rshort' +
          '\ra much longer progress line here' +
          '\r' +
          ' '.repeat('a much longer progress line here'.length) +
          '\r'
      );
    });

    it('clearProgress is a no-op when no progress has been emitted', () => {
      const { out, stderr } = makeOut({ tty: true });
      out.clearProgress();
      expect(stderr.text()).toBe('');
    });

    it('clearProgress is idempotent (second call is a no-op)', () => {
      const { out, stderr } = makeOut({ tty: true });
      out.progress('line');
      out.clearProgress();
      const after = stderr.text();
      out.clearProgress();
      expect(stderr.text()).toBe(after);
    });
  });

  describe('non-TTY text mode', () => {
    it('writes "<line>\\n" to stderr (history-preserving)', () => {
      const { out, stderr } = makeOut({ tty: false });
      out.progress('1 / 10');
      out.progress('2 / 10');
      expect(stderr.text()).toBe('1 / 10\n2 / 10\n');
    });

    it('clearProgress is a no-op (nothing to clear in scroll history)', () => {
      const { out, stderr } = makeOut({ tty: false });
      out.progress('line');
      const before = stderr.text();
      out.clearProgress();
      expect(stderr.text()).toBe(before);
    });
  });

  describe('JSON mode', () => {
    it('progress is a no-op', () => {
      const { out, stdout, stderr } = makeOut({ mode: 'json' });
      out.progress('1 / 10');
      expect(stdout.text()).toBe('');
      expect(stderr.text()).toBe('');
    });

    it('clearProgress is a no-op', () => {
      const { out, stdout, stderr } = makeOut({ mode: 'json' });
      out.progress('1 / 10');
      out.clearProgress();
      expect(stdout.text()).toBe('');
      expect(stderr.text()).toBe('');
    });
  });

  describe('quiet mode', () => {
    it('progress is a no-op even in TTY text mode', () => {
      const { out, stderr } = makeOut({ quiet: true, tty: true });
      out.progress('1 / 10');
      expect(stderr.text()).toBe('');
    });

    it('clearProgress is a no-op', () => {
      const { out, stderr } = makeOut({ quiet: true, tty: true });
      out.clearProgress();
      expect(stderr.text()).toBe('');
    });
  });

  describe('sink capture (test harness)', () => {
    it('routes through the stderr OutputSink, not process.stderr', () => {
      // Pins the convention §2 fix: progress lines flow through the
      // configured sink so buffer-sink test harnesses capture them.
      const { out, stderr } = makeOut({ tty: true });
      out.progress('captured');
      expect(stderr.text()).toContain('captured');
    });
  });
});

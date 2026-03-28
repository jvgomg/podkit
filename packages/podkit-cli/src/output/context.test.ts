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

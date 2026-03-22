import { describe, expect, it } from 'bun:test';
import { createShutdownController } from './shutdown.js';

describe('createShutdownController', () => {
  it('returns a controller with the expected interface', () => {
    const controller = createShutdownController();
    expect(controller).toHaveProperty('signal');
    expect(controller).toHaveProperty('install');
    expect(controller).toHaveProperty('uninstall');
    expect(controller).toHaveProperty('isShuttingDown');
    expect(controller).toHaveProperty('protect');
    expect(controller).toHaveProperty('unprotect');
  });

  it('isShuttingDown is false initially', () => {
    const controller = createShutdownController();
    expect(controller.isShuttingDown).toBe(false);
  });

  it('signal is not aborted initially', () => {
    const controller = createShutdownController();
    expect(controller.signal.aborted).toBe(false);
  });

  it('signal is an AbortSignal instance', () => {
    const controller = createShutdownController();
    expect(controller.signal).toBeInstanceOf(AbortSignal);
  });

  it('uninstall is idempotent', () => {
    const controller = createShutdownController();
    controller.install();
    // Calling uninstall multiple times should not throw
    controller.uninstall();
    controller.uninstall();
    controller.uninstall();
  });

  it('install is idempotent', () => {
    const controller = createShutdownController();
    // Calling install multiple times should not throw or register duplicate handlers
    controller.install();
    controller.install();
    controller.uninstall();
  });

  it('accepts custom message option', () => {
    const controller = createShutdownController({ message: 'Stopping...' });
    // Should create without error
    expect(controller.isShuttingDown).toBe(false);
  });

  it('accepts onShutdown callback option', () => {
    const controller = createShutdownController({ onShutdown: () => {} });
    expect(controller.isShuttingDown).toBe(false);
  });

  it('uninstall before install is safe', () => {
    const controller = createShutdownController();
    // Should not throw even though install was never called
    controller.uninstall();
  });
});

describe('shutdown signal handling', () => {
  /**
   * Helper: create a shutdown controller with stubbed exit/stderr and
   * deliver signals by emitting SIGINT on the process.
   */
  function setup(opts: { now?: () => number } = {}) {
    const calls: string[] = [];
    let exitCode: number | undefined;

    const controller = createShutdownController({
      _exit: (code) => {
        exitCode = code;
        calls.push(`exit(${code})`);
      },
      _writeStderr: (msg) => {
        calls.push(`stderr:${msg.trim()}`);
      },
      _now: opts.now,
    });

    controller.install();

    const sendSigint = () => process.emit('SIGINT', 'SIGINT');

    const cleanup = () => controller.uninstall();

    return { controller, calls, getExitCode: () => exitCode, sendSigint, cleanup };
  }

  it('exits immediately when unprotected', () => {
    const { calls, getExitCode, sendSigint, cleanup } = setup();
    try {
      sendSigint();

      expect(getExitCode()).toBe(130);
      expect(calls).toEqual(['exit(130)']);
    } finally {
      cleanup();
    }
  });

  it('does not set isShuttingDown when unprotected', () => {
    const { controller, sendSigint, cleanup } = setup();
    try {
      sendSigint();

      // Unprotected exit doesn't enter graceful shutdown mode
      expect(controller.isShuttingDown).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('does not abort signal when unprotected', () => {
    const { controller, sendSigint, cleanup } = setup();
    try {
      sendSigint();

      expect(controller.signal.aborted).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('triggers graceful shutdown when protected', () => {
    const { controller, calls, getExitCode, sendSigint, cleanup } = setup();
    try {
      controller.protect();
      sendSigint();

      expect(controller.isShuttingDown).toBe(true);
      expect(controller.signal.aborted).toBe(true);
      expect(getExitCode()).toBeUndefined(); // did NOT exit
      expect(calls).toEqual(['stderr:Graceful shutdown requested. Finishing current operation...']);
    } finally {
      cleanup();
    }
  });

  it('calls onShutdown callback when protected', () => {
    let called = false;
    const controller = createShutdownController({
      onShutdown: () => {
        called = true;
      },
      _exit: () => {},
      _writeStderr: () => {},
    });
    controller.install();
    try {
      controller.protect();
      process.emit('SIGINT', 'SIGINT');

      expect(called).toBe(true);
    } finally {
      controller.uninstall();
    }
  });

  it('force-quits on second signal when protected', () => {
    let time = 0;
    const { calls, getExitCode, sendSigint, controller, cleanup } = setup({
      now: () => time,
    });
    try {
      controller.protect();

      // First signal — graceful shutdown
      time = 1000;
      sendSigint();
      expect(getExitCode()).toBeUndefined();

      // Second signal after debounce window — force quit
      time = 2000;
      sendSigint();
      expect(getExitCode()).toBe(130);
      expect(calls).toContain('stderr:Force quit.');
    } finally {
      cleanup();
    }
  });

  it('debounces duplicate signals within 500ms window', () => {
    let time = 0;
    const { calls, getExitCode, sendSigint, controller, cleanup } = setup({
      now: () => time,
    });
    try {
      controller.protect();

      // First signal
      time = 1000;
      sendSigint();
      expect(controller.isShuttingDown).toBe(true);

      // Duplicate within debounce window — should be ignored
      time = 1200;
      sendSigint();
      expect(getExitCode()).toBeUndefined(); // did NOT force-quit

      // Only the graceful shutdown message, no force quit
      expect(calls).toEqual(['stderr:Graceful shutdown requested. Finishing current operation...']);
    } finally {
      cleanup();
    }
  });

  it('reverts to immediate exit after unprotect', () => {
    const { controller, calls, getExitCode, sendSigint, cleanup } = setup();
    try {
      controller.protect();
      controller.unprotect();
      sendSigint();

      // Should exit immediately, not graceful shutdown
      expect(getExitCode()).toBe(130);
      expect(controller.isShuttingDown).toBe(false);
      expect(calls).toEqual(['exit(130)']);
    } finally {
      cleanup();
    }
  });

  it('uses custom message when protected', () => {
    const calls: string[] = [];
    const controller = createShutdownController({
      message: 'Stopping now...',
      _exit: () => {},
      _writeStderr: (msg) => calls.push(msg.trim()),
    });
    controller.install();
    try {
      controller.protect();
      process.emit('SIGINT', 'SIGINT');

      expect(calls).toEqual(['Stopping now...']);
    } finally {
      controller.uninstall();
    }
  });
});

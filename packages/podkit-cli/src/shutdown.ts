/**
 * Graceful shutdown controller for CLI commands.
 *
 * Manages SIGINT/SIGTERM signal handling via AbortController.
 *
 * Has two modes:
 * - **Unprotected** (default): Ctrl+C exits immediately — safe during
 *   read-only work like scanning sources or computing diffs.
 * - **Protected**: Ctrl+C triggers graceful shutdown, allowing the current
 *   write operation to finish and the database to be saved. A second Ctrl+C
 *   force-quits. Use `protect()`/`unprotect()` to bracket iPod write phases.
 */

export interface ShutdownController {
  /** AbortSignal that consumers can pass to executors */
  signal: AbortSignal;
  /** Register signal handlers. Call once per command invocation. */
  install(): void;
  /** Unregister signal handlers. Call in finally block. */
  uninstall(): void;
  /** True after first signal received during a protected section */
  readonly isShuttingDown: boolean;
  /**
   * Enter a protected section — Ctrl+C will trigger graceful shutdown
   * instead of immediate exit. Call before iPod write operations.
   */
  protect(): void;
  /**
   * Leave a protected section — Ctrl+C will exit immediately again.
   * Call after iPod write operations complete.
   */
  unprotect(): void;
}

const DEFAULT_MESSAGE = 'Graceful shutdown requested. Finishing current operation...';

/** @internal Options exposed for testing — not part of the public API */
export interface ShutdownControllerInternalOptions {
  message?: string;
  onShutdown?: () => void;
  /** Override process.exit for testing */
  _exit?: (code: number) => void;
  /** Override process.stderr.write for testing */
  _writeStderr?: (msg: string) => void;
  /** Override Date.now for testing */
  _now?: () => number;
}

export function createShutdownController(
  options?: ShutdownControllerInternalOptions
): ShutdownController {
  const message = options?.message ?? DEFAULT_MESSAGE;
  const onShutdown = options?.onShutdown;
  const exit = options?._exit ?? ((code: number) => process.exit(code));
  const writeStderr = options?._writeStderr ?? ((msg: string) => process.stderr.write(msg));
  const now = options?._now ?? (() => Date.now());

  const ac = new AbortController();
  let shuttingDown = false;
  let installed = false;
  let protected_ = false;
  let firstSignalTime = 0;

  // Debounce window: bun run (and other process managers) can deliver
  // SIGINT twice for a single Ctrl+C — once from the process group and
  // once forwarded by the parent.  Ignore a second signal within 500ms.
  const DEBOUNCE_MS = 500;

  const handler = () => {
    const timestamp = now();

    if (shuttingDown) {
      if (timestamp - firstSignalTime < DEBOUNCE_MS) {
        // Duplicate signal from same Ctrl+C — ignore
        return;
      }
      // Genuine second signal — force quit
      writeStderr('\nForce quit.\n');
      exit(130);
      return;
    }

    if (!protected_) {
      // Not in a write phase — exit immediately
      exit(130);
      return;
    }

    // Protected section — graceful shutdown
    shuttingDown = true;
    firstSignalTime = timestamp;
    ac.abort();
    writeStderr('\n' + message + '\n');
    onShutdown?.();
  };

  return {
    get signal() {
      return ac.signal;
    },

    get isShuttingDown() {
      return shuttingDown;
    },

    install() {
      if (installed) return;
      installed = true;
      process.on('SIGINT', handler);
      process.on('SIGTERM', handler);
    },

    uninstall() {
      if (!installed) return;
      installed = false;
      process.removeListener('SIGINT', handler);
      process.removeListener('SIGTERM', handler);
    },

    protect() {
      protected_ = true;
    },

    unprotect() {
      protected_ = false;
    },
  };
}

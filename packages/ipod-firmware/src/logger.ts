/**
 * Diagnostic log surface for `@podkit/ipod-firmware`.
 *
 * The library does not write to stderr/stdout directly. Instead, callers
 * (typically a CLI) install a logger via {@link setLogger}; library
 * internals emit events that the caller formats and routes wherever it
 * likes. Default is no-op — silent.
 *
 * @module
 */

/** A single diagnostic event emitted by the library. */
export interface FirmwareLogEvent {
  /** Severity. Only `'debug'` exists today; widen as needed. */
  level: 'debug';
  /** Human-readable single-line message. */
  message: string;
}

/** Receiver function for diagnostic events. */
export type FirmwareLogger = (event: FirmwareLogEvent) => void;

// Stored on globalThis so all bundled copies of this module share one slot.
// Bun --compile and `bun build --target node` may bundle `@podkit/ipod-firmware`
// into multiple dist/ files; module-local state would otherwise diverge.
const SLOT = Symbol.for('@podkit/ipod-firmware:activeLogger');
type Globals = typeof globalThis & { [SLOT]?: FirmwareLogger | null };

/**
 * Install a logger to receive diagnostic events from this package. Pass
 * `null` to detach. Default is no logger (silent).
 *
 * Library code reaches the logger via {@link emit}; consumers never call
 * `emit` directly.
 */
export function setLogger(logger: FirmwareLogger | null): void {
  (globalThis as Globals)[SLOT] = logger;
}

/** Library-internal: forward an event to the active logger, if any. */
export function emit(event: FirmwareLogEvent): void {
  const logger = (globalThis as Globals)[SLOT];
  if (logger) logger(event);
}

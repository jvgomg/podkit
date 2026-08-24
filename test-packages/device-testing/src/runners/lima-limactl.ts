/**
 * `limactl` invocation helpers. The implementation now lives in the Lima
 * substrate package (`@podkit/lima`); this module re-exports it so the existing
 * `./lima-limactl.js` import sites across the device-testing harness keep
 * resolving unchanged.
 *
 * @module
 */

export type { LimactlResult, RunLimactlOpts } from '@podkit/lima';
export { runLimactl, limactlError, shellQuote } from '@podkit/lima';

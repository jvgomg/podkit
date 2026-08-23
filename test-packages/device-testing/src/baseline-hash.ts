/**
 * Device-harness VM baseline hash. The implementation now lives in the Lima
 * substrate package (`@podkit/lima`); this module re-exports it so the existing
 * `../src/baseline-hash.js` import sites (harness + drift check scripts) keep
 * resolving unchanged.
 *
 * @module
 */

export type { BaselineFileEntry, BaselineHashResult } from '@podkit/lima';
export { computeBaselineHash, BASELINE_VM_HASH_PATH } from '@podkit/lima';

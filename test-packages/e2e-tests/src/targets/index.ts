/**
 * iPod target abstractions for E2E tests.
 *
 * @example
 * ```typescript
 * import { withTarget } from './targets';
 *
 * // Uses IPOD_TARGET env var (dummy by default)
 * await withTarget(async (target) => {
 *   console.log(`Testing against: ${target.name}`);
 *   const result = await runCli(['status', target.path]);
 * });
 * ```
 */

export { createTarget, withTarget, createTargetFactory, getTargetType } from './factory';
export { DummyIpodTarget, DummyIpodTargetFactory } from './dummy';
export { RealIpodTarget, RealIpodTargetFactory } from './real';
export type { IpodTarget, IpodTargetFactory, TargetType, TargetOptions } from './types';

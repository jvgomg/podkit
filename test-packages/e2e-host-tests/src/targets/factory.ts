/**
 * Target factory for creating iPod test targets.
 *
 * Selects between dummy and real targets based on IPOD_TARGET environment:
 * - IPOD_TARGET=dummy (default): Creates temporary iPod via gpod-testing
 * - IPOD_TARGET=real: Uses real iPod at IPOD_MOUNT path
 */

import type { IpodTarget, IpodTargetFactory, TargetType, TargetOptions } from './types';
import { DummyIpodTargetFactory } from './dummy';
import { RealIpodTargetFactory } from './real';

/**
 * Get the target type from environment.
 *
 * @returns 'dummy' (default) or 'real'
 */
export function getTargetType(): TargetType {
  const value = process.env['IPOD_TARGET']?.toLowerCase();
  if (value === 'real') {
    return 'real';
  }
  return 'dummy';
}

/**
 * Create a target factory based on environment.
 */
export function createTargetFactory(): IpodTargetFactory {
  const type = getTargetType();
  if (type === 'real') {
    return new RealIpodTargetFactory();
  }
  return new DummyIpodTargetFactory();
}

// Singleton factory instance
let factoryInstance: IpodTargetFactory | null = null;

/**
 * Get or create the singleton factory instance.
 */
function getFactory(): IpodTargetFactory {
  if (!factoryInstance) {
    factoryInstance = createTargetFactory();
  }
  return factoryInstance;
}

/**
 * Create a new iPod target.
 *
 * Uses IPOD_TARGET env var to determine type:
 * - 'dummy' (default): Creates temp iPod via gpod-testing
 * - 'real': Uses IPOD_MOUNT path
 */
export async function createTarget(options?: TargetOptions): Promise<IpodTarget> {
  return getFactory().create(options);
}

/**
 * Run a test function with an iPod target.
 *
 * Creates a target, runs the function, and ensures cleanup even on error.
 *
 * @example
 * ```typescript
 * await withTarget(async (target) => {
 *   const result = await runCli(['status', target.path]);
 *   expect(result.exitCode).toBe(0);
 * });
 * ```
 */
export async function withTarget<T>(
  fn: (target: IpodTarget) => Promise<T>,
  options?: TargetOptions
): Promise<T> {
  const target = await createTarget(options);
  try {
    return await fn(target);
  } finally {
    await target.cleanup();
  }
}

// Re-export types
export type { IpodTarget, IpodTargetFactory, TargetType, TargetOptions } from './types';

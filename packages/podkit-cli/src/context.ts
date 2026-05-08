/**
 * CLI context — holds configuration and global state for commands.
 *
 * Two layers:
 *  - Module-level fallback (`setContext` / `clearContext`) used by `main.ts` for
 *    the production CLI process where a single context spans the whole run.
 *  - AsyncLocalStorage scope (`runWithContext`) used by tests so concurrent
 *    invocations each see their own context with no cross-talk.
 *
 * `getContext()` prefers the ALS scope and falls back to the module-level value,
 * so production call sites are unchanged.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { PodkitConfig, GlobalOptions, LoadConfigResult } from './config/index.js';

export interface CliContext {
  config: PodkitConfig;
  globalOpts: GlobalOptions;
  configResult: LoadConfigResult;
}

const als = new AsyncLocalStorage<CliContext>();
let moduleContext: CliContext | undefined;

export function setContext(ctx: CliContext): void {
  moduleContext = ctx;
}

export function runWithContext<T>(ctx: CliContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getContext(): CliContext {
  const ctx = als.getStore() ?? moduleContext;
  if (!ctx) {
    throw new Error(
      'CLI context not initialized. This is a bug — context should be set before commands run.'
    );
  }
  return ctx;
}

export function getConfig(): PodkitConfig {
  return getContext().config;
}

export function getGlobalOpts(): GlobalOptions {
  return getContext().globalOpts;
}

export function clearContext(): void {
  moduleContext = undefined;
}

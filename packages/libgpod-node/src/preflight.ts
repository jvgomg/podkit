/**
 * Module-load preflight for libgpod-node-dependent test code.
 *
 * Lives in this package (rather than in `@podkit/test-fixtures`) so the
 * check sits next to the thing it checks — and so that libgpod-node's own
 * integration tests can import it without creating a workspace dependency
 * cycle through `@podkit/test-fixtures`.
 *
 * @module
 */

import { isNativeAvailable } from './binding.js';

/**
 * Throw at module load if the libgpod-node native bindings cannot be loaded.
 *
 * Tests that exercise the native side should call this at the top of the file
 * so missing/unbuilt bindings surface as a focused error instead of a
 * confusing runtime failure deep inside `Database.open()` or similar.
 *
 * @example
 * ```ts
 * import { requireLibgpodNode } from '@podkit/libgpod-node';
 *
 * requireLibgpodNode();
 * ```
 */
export function requireLibgpodNode(): void {
  if (!isNativeAvailable()) {
    throw new Error(
      `libgpod-node native bindings are not loadable.\n` +
        `Build the bindings:\n` +
        `  bun run --filter @podkit/libgpod-node build:native\n` +
        `Or build everything from the repo root:\n` +
        `  bun run build`
    );
  }
}

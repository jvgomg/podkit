/**
 * Preloaded by `bun test --preload` for podkit-core integration tests.
 * Throws (not skips) on missing deps so a broken test environment fails fast.
 */
import { requireFFmpeg, requireGpodTool, failMissingDep } from '@podkit/gpod-testing';
import { isNativeAvailable } from '@podkit/libgpod-node';

requireFFmpeg();
requireGpodTool();
if (!isNativeAvailable()) {
  failMissingDep(
    'libgpod-node native bindings',
    'Build the native bindings:\n     cd packages/libgpod-node && bun run build:native\n\n Or from the repo root:\n     bun run build'
  );
}

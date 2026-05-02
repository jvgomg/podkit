/**
 * Preloaded by `bun test --preload` for podkit-cli integration tests.
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

/**
 * Path anchoring for the substrate layer. Locates this package on disk — and
 * the repo above it — without assuming whether the caller is running from
 * TypeScript source (`src/*.ts`) or the bundled output (`dist/index.js`).
 *
 * `import.meta.url` walking with a fixed number of `..` segments works in src
 * mode but breaks in dist mode because `bun build` flattens the tree. Anchoring
 * on the `test-packages/substrate/` marker substring works either way.
 *
 * `repoRoot()` lives here rather than in `@podkit/lima` because nothing about
 * "where is the repo" is Lima-specific, and the registry — which now lives in
 * this package — needs it. `@podkit/lima` re-exports it so its existing callers
 * are unaffected, and keeps its own `limaPackageRoot()`, which genuinely is
 * Lima-specific (it points at the `vms/` directory).
 *
 * @module
 */

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

/**
 * Absolute path of `<repo>/test-packages/substrate/`. Throws if the module is
 * loaded from somewhere unexpected (e.g. copied outside the workspace, or
 * bundled into a single-file binary) — there is no fallback, so the failure
 * surfaces immediately rather than resolving to a plausible wrong directory.
 *
 * The single-file-binary case is not hypothetical: see the note on
 * `defineLimaVm` in `./registry.js` for why nothing in this package may call
 * this function at module-evaluation time.
 */
export function substratePackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const marker = `${path.sep}test-packages${path.sep}substrate${path.sep}`;
  const idx = thisFile.lastIndexOf(marker);
  if (idx < 0) {
    throw new Error(
      `substratePackageRoot: could not anchor on '${marker}' in ${thisFile}. ` +
        'If the package layout moved, update this helper to match.'
    );
  }
  return thisFile.slice(0, idx + marker.length - 1);
}

/** Absolute path of the repo root (the parent of `packages/`). */
export function repoRoot(): string {
  return path.resolve(substratePackageRoot(), '..', '..');
}

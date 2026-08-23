/**
 * Path-resolution helpers for the Lima substrate. Locate this package on disk
 * — and the repo above it — without assuming whether the caller is running
 * from TypeScript source (`src/*.ts`) or the bundled output (`dist/index.js`).
 *
 * `import.meta.url` walking with a fixed number of `..` segments works in src
 * mode but breaks in dist mode because `bun build` flattens the tree. Anchoring
 * on the `test-packages/lima/` marker substring works either way.
 *
 * @module
 */

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

/**
 * Absolute path of `<repo>/test-packages/lima/`. Throws if the module is loaded
 * from somewhere unexpected (e.g. copied outside the workspace) — there is no
 * fallback so the failure surfaces immediately.
 */
export function limaPackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const marker = `${path.sep}test-packages${path.sep}lima${path.sep}`;
  const idx = thisFile.lastIndexOf(marker);
  if (idx < 0) {
    throw new Error(
      `limaPackageRoot: could not anchor on '${marker}' in ${thisFile}. ` +
        'If the package layout moved, update this helper to match.'
    );
  }
  return thisFile.slice(0, idx + marker.length - 1);
}

/** Absolute path of the repo root (the parent of `packages/`). */
export function repoRoot(): string {
  return path.resolve(limaPackageRoot(), '..', '..');
}

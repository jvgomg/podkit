/**
 * Path-resolution helpers shared by every runner. Locate this package on disk
 * — and the repo above it — without making assumptions about whether the
 * caller is running from TypeScript source (`src/runners/X.ts`) or from the
 * bundled output (`dist/index.js`).
 *
 * `import.meta.url` walking with a fixed number of `..` segments works in src
 * mode but breaks in dist mode because `bun build` flattens the tree:
 * `src/runners/X.ts` is two dirs deep, `dist/index.js` is one. Anchoring on
 * the `test-packages/device-testing/` marker substring works either way.
 *
 * @module
 */

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

/**
 * Absolute path of `<repo>/test-packages/device-testing/`. Throws if the
 * module is loaded from somewhere unexpected (e.g. copied outside the
 * workspace) — there is no fallback so the failure surfaces immediately.
 */
export function devTestingPackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const marker = `${path.sep}test-packages${path.sep}device-testing${path.sep}`;
  const idx = thisFile.lastIndexOf(marker);
  if (idx < 0) {
    throw new Error(
      `devTestingPackageRoot: could not anchor on '${marker}' in ${thisFile}. ` +
        'If the package layout moved, update this helper to match.'
    );
  }
  return thisFile.slice(0, idx + marker.length - 1);
}

/** Absolute path of the repo root (the parent of `test-packages/`). */
export function repoRoot(): string {
  return path.resolve(devTestingPackageRoot(), '..', '..');
}

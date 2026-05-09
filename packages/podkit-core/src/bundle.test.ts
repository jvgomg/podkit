/**
 * Regression tests for the published `@podkit/core` bundle.
 *
 * `dist/index.js` keeps `koffi`, `usb`, AND `@podkit/ipod-firmware`
 * external. The first two are obvious — koffi's loader uses
 * `eval("require")` and breaks in an ESM bundle. The third is npm
 * hygiene: ipod-firmware owns the koffi/usb dependency, and inlining its
 * source into core/dist/index.js would force `npm install @podkit/core`
 * to also resolve koffi/usb — drift between core's declared deps and
 * what its dist actually imports at runtime.
 *
 * Mirror of `packages/ipod-firmware/src/bundle.test.ts` and
 * `packages/podkit-cli/src/bundle.test.ts`. The CLI bundle DOES inline
 * ipod-firmware (final-output bundle for the binary), so its rules
 * differ — koffi/usb stay external there but firmware source is fine
 * to inline.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_BUNDLE = resolve(__dirname, '..', 'dist', 'index.js');

function readBundle(): string {
  if (!existsSync(CORE_BUNDLE)) {
    throw new Error(
      `core bundle missing: ${CORE_BUNDLE}\n` +
        'Run `bun run build --filter @podkit/core` from the repo root first.'
    );
  }
  return readFileSync(CORE_BUNDLE, 'utf8');
}

describe('@podkit/core bundle (dist/index.js)', () => {
  it('exists at the published path', () => {
    expect(existsSync(CORE_BUNDLE)).toBe(true);
  });

  it('keeps `@podkit/ipod-firmware` external — does not inline koffi imports', () => {
    expect(readBundle()).not.toContain('import("koffi")');
  });

  it('keeps `@podkit/ipod-firmware` external — does not inline usb imports', () => {
    expect(readBundle()).not.toContain('import("usb")');
  });

  it('does not inline koffi’s `eval("require")` native loader', () => {
    const src = readBundle();
    expect(src).not.toContain('eval("require")');
    expect(src).not.toContain("eval('require')");
  });
});

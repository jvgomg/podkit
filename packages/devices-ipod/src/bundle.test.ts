/**
 * Regression tests for the published `@podkit/devices-ipod` bundle.
 *
 * `dist/index.js` keeps `@podkit/ipod-firmware` (and its koffi/usb
 * deps) external — the firmware package owns the native deps and its
 * source must not leak into devices-ipod/dist, otherwise consumers of
 * devices-ipod would have to install koffi+usb themselves to satisfy
 * runtime imports embedded in this bundle.
 *
 * Mirror of `packages/podkit-core/src/bundle.test.ts`.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEVICES_BUNDLE = resolve(__dirname, '..', 'dist', 'index.js');

function readBundle(): string {
  if (!existsSync(DEVICES_BUNDLE)) {
    throw new Error(
      `devices-ipod bundle missing: ${DEVICES_BUNDLE}\n` +
        'Run `bun run build --filter @podkit/devices-ipod` from the repo root first.'
    );
  }
  return readFileSync(DEVICES_BUNDLE, 'utf8');
}

describe('@podkit/devices-ipod bundle (dist/index.js)', () => {
  it('exists at the published path', () => {
    expect(existsSync(DEVICES_BUNDLE)).toBe(true);
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

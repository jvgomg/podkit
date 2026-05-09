/**
 * Regression tests for the published `@podkit/ipod-firmware` bundle.
 *
 * `dist/index.js` is consumed by other workspace packages (and may be
 * published directly in the future). It must keep its native deps
 * (`koffi`, `usb`) external — otherwise koffi's `eval("require")` based
 * native loader gets inlined and throws `ReferenceError: require is not
 * defined` the moment SCSI inquiry runs from a downstream consumer.
 *
 * Mirror of `packages/podkit-cli/src/bundle.test.ts` — both packages
 * produce ESM `--target node` bundles and both have to stay external
 * for native deps. If the ipod-firmware bundle regresses, every
 * downstream rebundle inherits the bug.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRMWARE_BUNDLE = resolve(__dirname, '..', 'dist', 'index.js');
const FIRMWARE_DIST_DIR = dirname(FIRMWARE_BUNDLE);

function readBundle(): string {
  if (!existsSync(FIRMWARE_BUNDLE)) {
    throw new Error(
      `ipod-firmware bundle missing: ${FIRMWARE_BUNDLE}\n` +
        'Run `bun run build --filter @podkit/ipod-firmware` from the repo root first.'
    );
  }
  return readFileSync(FIRMWARE_BUNDLE, 'utf8');
}

describe('ipod-firmware bundle (dist/index.js)', () => {
  it('exists at the published path', () => {
    expect(existsSync(FIRMWARE_BUNDLE)).toBe(true);
  });

  it('keeps `koffi` external', () => {
    expect(readBundle()).toContain('import("koffi")');
  });

  it('keeps `usb` external', () => {
    expect(readBundle()).toContain('import("usb")');
  });

  it('does not inline koffi’s `eval("require")` native loader', () => {
    const src = readBundle();
    expect(src).not.toContain('eval("require")');
    expect(src).not.toContain("eval('require')");
  });

  it('does not stage native binding files alongside the bundle', () => {
    const stray = readdirSync(FIRMWARE_DIST_DIR).filter(
      (f) => f.endsWith('.node') || f.startsWith('koffi-')
    );
    expect(stray).toEqual([]);
  });
});

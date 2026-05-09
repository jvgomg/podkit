/**
 * Regression tests for the published CLI bundle.
 *
 * The CLI ships as a single ESM file (`dist/main.js`) produced by
 * `bun build --target node`. Native modules (`koffi`, `usb`) MUST stay
 * external — bundling them inlines per-platform binary loaders that
 * either pin the wrong .node file for non-build platforms (npm install
 * use-case) or break entirely (koffi's loader uses `eval("require")`,
 * which references the bare `require` identifier that doesn't exist in
 * an ESM bundle scope, throwing `ReferenceError: require is not defined`
 * the first time SCSI fallback runs on a real device).
 *
 * These tests require `bun run build --filter podkit` to have run first.
 * The "exists" test fails loudly if the bundle is missing, telling you
 * what to do.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BUNDLE = resolve(__dirname, '..', 'dist', 'main.js');
const CLI_DIST_DIR = dirname(CLI_BUNDLE);

function readBundle(): string {
  if (!existsSync(CLI_BUNDLE)) {
    throw new Error(
      `CLI bundle missing: ${CLI_BUNDLE}\n` +
        'Run `bun run build --filter podkit` from the repo root first.'
    );
  }
  return readFileSync(CLI_BUNDLE, 'utf8');
}

describe('CLI bundle (dist/main.js)', () => {
  it('exists at the published path', () => {
    expect(existsSync(CLI_BUNDLE)).toBe(true);
  });

  it('keeps `koffi` external — preserves a runtime `import("koffi")` call', () => {
    expect(readBundle()).toContain('import("koffi")');
  });

  it('keeps `usb` external — preserves a runtime `import("usb")` call', () => {
    expect(readBundle()).toContain('import("usb")');
  });

  it('does not inline koffi’s native loader (no `eval("require")` survives)', () => {
    // koffi's index.js loads its native .node binding via
    // `eval("require")(filename)` when the build-time static require
    // misses. In a Bun ESM bundle the bare `require` identifier doesn't
    // exist, so this throws `ReferenceError: require is not defined` at
    // runtime — only on the SCSI path, only on devices that need SCSI
    // fallback. Catching it statically is much cheaper than the field.
    const src = readBundle();
    expect(src).not.toContain('eval("require")');
    expect(src).not.toContain("eval('require')");
  });

  it('does not stage native binding files alongside the bundle', () => {
    // If koffi/usb were inlined, Bun would copy their `.node` files into
    // dist/ next to main.js. The compiled standalone binary stages files
    // in the CLI package root (not dist/), so this dist-level absence is
    // unambiguous.
    const stray = readdirSync(CLI_DIST_DIR).filter(
      (f) => f.endsWith('.node') || f.startsWith('koffi-')
    );
    expect(stray).toEqual([]);
  });
});

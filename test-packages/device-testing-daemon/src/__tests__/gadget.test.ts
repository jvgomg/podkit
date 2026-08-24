/**
 * Unit tests for the configfs gadget helpers that do not need a kernel.
 *
 * `reapStaleGadget` is the crash-safety mechanism: it runs on the way *in*,
 * because the failure it exists for is a daemon that never ran its way out.
 * These tests drive it against an ordinary temp directory shaped like the
 * configfs tree — every operation it performs is a plain unlink/rmdir/write,
 * so a real gadget filesystem is not required to pin the behaviour.
 *
 * What a kernel would add, and what the VM tests cover instead, is that
 * clearing the `UDC` file actually releases the controller, and that removing
 * the gadget directory succeeds at all — under configfs `configs/` and
 * `functions/` are synthetic and vanish with their parent, where on a real
 * filesystem they are ordinary directories that keep the parent non-empty. So
 * these tests assert the parts that carry the meaning: the binding is cleared
 * and the function/config wiring is taken apart, neither of them conditional
 * on the previous daemon having exited cleanly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isBound, reapStaleGadget } from '../gadget.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'podkit-gadget-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Build a directory tree with the same shape `createGadget` produces, bound to
 * `udc` unless it is empty.
 */
function makeGadgetTree(name: string, udc: string): string {
  const gadgetPath = join(root, name);
  mkdirSync(join(gadgetPath, 'configs', 'c.1', 'strings', '0x409'), { recursive: true });
  mkdirSync(join(gadgetPath, 'strings', '0x409'), { recursive: true });
  mkdirSync(join(gadgetPath, 'functions', `ffs.${name}`), { recursive: true });
  writeFileSync(join(gadgetPath, 'UDC'), udc);
  symlinkSync(
    join(gadgetPath, 'functions', `ffs.${name}`),
    join(gadgetPath, 'configs', 'c.1', `ffs.${name}`)
  );
  return gadgetPath;
}

describe('reapStaleGadget', () => {
  it('does nothing when there is no leftover tree', () => {
    const warnings: string[] = [];
    const reaped = reapStaleGadget(join(root, 'podkit-absent'), 'podkit-absent', (m) =>
      warnings.push(m)
    );
    expect(reaped).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('releases a controller still held by a gadget whose daemon is gone', () => {
    const gadgetPath = makeGadgetTree('podkit-ipod-nano-7g-blue', 'dummy_udc.1');
    expect(isBound(gadgetPath)).toBe(true);

    const warnings: string[] = [];
    const reaped = reapStaleGadget(gadgetPath, 'podkit-ipod-nano-7g-blue', (m) => warnings.push(m));

    expect(reaped).toBe(true);
    expect(isBound(gadgetPath)).toBe(false);
    expect(existsSync(join(gadgetPath, 'functions', 'ffs.podkit-ipod-nano-7g-blue'))).toBe(false);
    expect(existsSync(join(gadgetPath, 'configs', 'c.1', 'ffs.podkit-ipod-nano-7g-blue'))).toBe(
      false
    );
    expect(warnings.join('\n')).toContain('dummy_udc.1');
    expect(warnings.join('\n')).toContain('exited without tearing down');
  });

  it('clears the UDC binding even when the tree cannot be fully removed', () => {
    // A leftover FunctionFS mount pins `functions/ffs.<name>`, so the rmdir
    // walk cannot finish. Releasing the controller must not be contingent on
    // that: the binding is the scarce resource, the empty directory is not.
    const gadgetPath = makeGadgetTree('podkit-pinned', 'dummy_udc.2');
    writeFileSync(join(gadgetPath, 'functions', 'ffs.podkit-pinned', 'ep0'), '');

    const reaped = reapStaleGadget(gadgetPath, 'podkit-pinned', () => {});

    expect(reaped).toBe(true);
    expect(readFileSync(join(gadgetPath, 'UDC'), 'utf-8')).toBe('');
    expect(isBound(gadgetPath)).toBe(false);
  });

  it('is idempotent — a second pass over a half-reaped tree still succeeds', () => {
    const gadgetPath = makeGadgetTree('podkit-pinned', 'dummy_udc.0');
    writeFileSync(join(gadgetPath, 'functions', 'ffs.podkit-pinned', 'ep0'), '');
    reapStaleGadget(gadgetPath, 'podkit-pinned', () => {});

    // Whatever survived the first pass is reaped again without throwing.
    expect(() => reapStaleGadget(gadgetPath, 'podkit-pinned', () => {})).not.toThrow();
    expect(isBound(gadgetPath)).toBe(false);
  });

  it('reports an unbound leftover tree distinctly from a bound one', () => {
    const gadgetPath = makeGadgetTree('podkit-unbound', '');
    const warnings: string[] = [];
    reapStaleGadget(gadgetPath, 'podkit-unbound', (m) => warnings.push(m));
    expect(warnings[0]).toContain('(unbound)');
  });

  it('touches only the named gadget, leaving a concurrent persona alone', () => {
    const mine = makeGadgetTree('podkit-mine', 'dummy_udc.0');
    const theirs = makeGadgetTree('podkit-theirs', 'dummy_udc.1');

    reapStaleGadget(mine, 'podkit-mine', () => {});

    expect(isBound(mine)).toBe(false);
    expect(isBound(theirs)).toBe(true);
    expect(existsSync(join(theirs, 'functions', 'ffs.podkit-theirs'))).toBe(true);
    expect(existsSync(join(theirs, 'configs', 'c.1', 'ffs.podkit-theirs'))).toBe(true);
  });
});

describe('isBound', () => {
  it('is false for a gadget path that does not exist', () => {
    expect(isBound(join(root, 'nope'))).toBe(false);
  });

  it('ignores trailing whitespace in the UDC file', () => {
    const gadgetPath = makeGadgetTree('podkit-ws', 'dummy_udc.3\n');
    expect(isBound(gadgetPath)).toBe(true);
  });
});

/**
 * Unit tests for the staging-area registry. The contract that matters is
 * disjointness: no two callers may rsync into the same VM-local tree, because
 * `rsync -a --delete` from two writers corrupts the destination (rsync exit 23)
 * rather than merely slowing it down.
 *
 * The collision rule is exercised against synthetic registries so the failure
 * modes are pinned independently of whatever the real registry happens to hold
 * today, and then applied to the real registry as the regression guard.
 */

import { describe, it, expect } from 'bun:test';

import {
  listStagingAreas,
  getStagingArea,
  stagingDestFor,
  findStagingCollision,
  type StagingArea,
} from './staging.js';
import { getVm } from './registry.js';

const area = (id: string, vm: string, dest: string): StagingArea => ({
  id,
  vm,
  dest,
  owner: `owner-of-${id}`,
});

describe('staging area registry', () => {
  it('gives every area a clean id, a real VM and an absolute destination', () => {
    for (const entry of listStagingAreas()) {
      expect(entry.id).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
      expect(entry.dest.startsWith('/')).toBe(true);
      expect(entry.owner.length).toBeGreaterThan(0);
      // Throws if the VM id is not in the VM registry.
      expect(getVm(entry.vm).instanceName).toMatch(/^podkit-/);
    }
  });

  it('has unique ids', () => {
    const ids = listStagingAreas().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('looks an area up by id', () => {
    const entry = getStagingArea('glibcBinary');
    expect(entry.vm).toBe('builderGlibc');
    expect(entry.dest).toBe('/tmp/podkit-builder-src');
  });

  it('fails loudly on an unknown id rather than falling back to a default', () => {
    expect(() => getStagingArea('nope')).toThrow(/no staging area registered for 'nope'/);
    expect(() => getStagingArea('nope')).toThrow(/Known areas:/);
  });

  it('gives the CLI binary build and the gpod-tool build separate trees', () => {
    const binary = getStagingArea('glibcBinary');
    const gpodTool = getStagingArea('glibcGpodTool');
    expect(binary.vm).toBe(gpodTool.vm);
    expect(binary.dest).not.toBe(gpodTool.dest);
  });
});

describe('stagingDestFor', () => {
  it('resolves the destination when the area belongs to the named VM', () => {
    expect(stagingDestFor('builderGlibc', 'glibcBinary')).toBe('/tmp/podkit-builder-src');
  });

  it('accepts the concrete instance name as well as the registry id', () => {
    expect(stagingDestFor('podkit-builder-glibc', 'glibcBinary')).toBe('/tmp/podkit-builder-src');
  });

  it('refuses an area that belongs to a different VM', () => {
    expect(() => stagingDestFor('builderMusl', 'glibcBinary')).toThrow(
      /belongs to podkit-builder-glibc, not podkit-builder-musl/
    );
  });
});

describe('findStagingCollision', () => {
  it('accepts distinct directories in the same VM', () => {
    expect(
      findStagingCollision([area('a', 'vm1', '/tmp/one'), area('b', 'vm1', '/tmp/two')])
    ).toBeUndefined();
  });

  it('accepts the same path in different VMs', () => {
    expect(
      findStagingCollision([area('a', 'vm1', '/tmp/same'), area('b', 'vm2', '/tmp/same')])
    ).toBeUndefined();
  });

  it('rejects two areas sharing one directory', () => {
    expect(
      findStagingCollision([area('a', 'vm1', '/tmp/same'), area('b', 'vm1', '/tmp/same')])
    ).toContain("'a' and 'b' both stage into vm1:/tmp/same");
  });

  it('rejects a nested directory, which a parent --delete would wipe', () => {
    expect(
      findStagingCollision([
        area('parent', 'vm1', '/tmp/one'),
        area('child', 'vm1', '/tmp/one/sub'),
      ])
    ).toContain('nests inside');
  });

  it('detects nesting regardless of declaration order', () => {
    expect(
      findStagingCollision([
        area('child', 'vm1', '/tmp/one/sub'),
        area('parent', 'vm1', '/tmp/one'),
      ])
    ).toContain('nests inside');
  });

  it('does not mistake a shared path prefix for nesting', () => {
    expect(
      findStagingCollision([area('a', 'vm1', '/tmp/build'), area('b', 'vm1', '/tmp/build-src')])
    ).toBeUndefined();
  });

  it('holds for the real registry', () => {
    expect(findStagingCollision(listStagingAreas())).toBeUndefined();
  });
});

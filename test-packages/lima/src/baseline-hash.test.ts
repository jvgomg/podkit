/**
 * Unit tests for the baseline-hash primitive. Assert the external contract:
 * a deterministic combined hash over an explicit list of tracked files, per-file
 * digests in the caller's declaration order, sensitivity to content, label and
 * order changes, and a loud throw when a tracked file is missing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { computeBaselineHash, type TrackedBaselineFile } from './baseline-hash.js';

/**
 * Two roots, mirroring production: the VM yaml lives in one package, the
 * apply-state script in another. The primitive must not assume a shared root.
 */
let limaRoot: string;
let deviceTestingRoot: string;

/** Write `content` to `<root>/<relPath>`, creating parents, and return the absolute path. */
function write(root: string, relPath: string, content: string): string {
  const absPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
  return absPath;
}

/** The device harness's real shape: a yaml in one package, a script in another. */
function seedCrossPackage(
  yamlContent: string,
  applyStateContent: string
): { yaml: TrackedBaselineFile; applyState: TrackedBaselineFile; inOrder: TrackedBaselineFile[] } {
  const yaml: TrackedBaselineFile = {
    label: 'podkit-device.yaml',
    absPath: write(limaRoot, 'vms/podkit-device.yaml', yamlContent),
  };
  const applyState: TrackedBaselineFile = {
    label: 'apply-state.sh',
    absPath: write(deviceTestingRoot, 'scripts/apply-state.sh', applyStateContent),
  };
  return { yaml, applyState, inOrder: [yaml, applyState] };
}

beforeEach(() => {
  limaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-baseline-lima-'));
  deviceTestingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-baseline-devtest-'));
});

afterEach(() => {
  fs.rmSync(limaRoot, { recursive: true, force: true });
  fs.rmSync(deviceTestingRoot, { recursive: true, force: true });
});

describe('computeBaselineHash', () => {
  it('hashes tracked files that live under different package roots', () => {
    const { inOrder } = seedCrossPackage('yaml-a', 'sh-a');
    const result = computeBaselineHash(inOrder);

    expect(result.files).toHaveLength(2);
    expect(result.files[0]!.label).toBe('podkit-device.yaml');
    expect(result.files[1]!.label).toBe('apply-state.sh');
    // The two absolute paths genuinely come from different roots.
    expect(path.dirname(result.files[0]!.absPath)).not.toBe(path.dirname(result.files[1]!.absPath));
    expect(result.files[0]!.sha256).toBe(createHash('sha256').update('yaml-a').digest('hex'));
    expect(result.files[1]!.sha256).toBe(createHash('sha256').update('sh-a').digest('hex'));
    expect(result.combinedSha).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports per-file entries in the caller-declared order', () => {
    const { yaml, applyState } = seedCrossPackage('yaml-a', 'sh-a');
    const reversed = computeBaselineHash([applyState, yaml]);
    expect(reversed.files.map((f) => f.label)).toEqual(['apply-state.sh', 'podkit-device.yaml']);
  });

  it('is deterministic for identical content', () => {
    const { inOrder } = seedCrossPackage('yaml-a', 'sh-a');
    expect(computeBaselineHash(inOrder).combinedSha).toBe(computeBaselineHash(inOrder).combinedSha);
  });

  it('changes the combined hash when either tracked file changes', () => {
    const base = computeBaselineHash(seedCrossPackage('yaml-a', 'sh-a').inOrder).combinedSha;

    expect(
      computeBaselineHash(seedCrossPackage('yaml-CHANGED', 'sh-a').inOrder).combinedSha
    ).not.toBe(base);
    expect(
      computeBaselineHash(seedCrossPackage('yaml-a', 'sh-CHANGED').inOrder).combinedSha
    ).not.toBe(base);
  });

  it('changes the combined hash when the tracked files are reordered', () => {
    const { yaml, applyState, inOrder } = seedCrossPackage('yaml-a', 'sh-a');
    expect(computeBaselineHash([applyState, yaml]).combinedSha).not.toBe(
      computeBaselineHash(inOrder).combinedSha
    );
  });

  it('changes the combined hash when a label changes but content does not', () => {
    const { yaml, applyState, inOrder } = seedCrossPackage('yaml-a', 'sh-a');
    const relabelled = computeBaselineHash([{ ...yaml, label: 'renamed.yaml' }, applyState]);
    expect(relabelled.combinedSha).not.toBe(computeBaselineHash(inOrder).combinedSha);
  });

  it('throws loudly, naming the file, when a tracked file is missing', () => {
    const { applyState, inOrder } = seedCrossPackage('yaml-a', 'sh-a');
    fs.rmSync(applyState.absPath);

    expect(() => computeBaselineHash(inOrder)).toThrow(/cannot read tracked baseline file/);
    expect(() => computeBaselineHash(inOrder)).toThrow(/apply-state\.sh/);
    expect(() => computeBaselineHash(inOrder)).toThrow(/host source is incomplete/);
  });

  it('throws rather than hashing nothing when given an empty list', () => {
    expect(() => computeBaselineHash([])).toThrow(/no tracked baseline files/);
  });
});

/**
 * Unit tests for the device-harness baseline composition. The hashing itself
 * is covered in `@podkit/lima`; what matters here is that this package names
 * the right files, in the right order, and that both really exist on disk —
 * the primitive throws on a missing input, so a stale path would break
 * `harness:setup` and `vm:doctor` rather than merely report drift.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { deviceBaselineFiles, computeBaselineHash } from './baseline-hash.js';

describe('deviceBaselineFiles', () => {
  it('tracks the device VM yaml first, then apply-state.sh', () => {
    expect(deviceBaselineFiles().map((f) => f.label)).toEqual([
      'podkit-device.yaml',
      'apply-state.sh',
    ]);
  });

  it('points at files that exist, spanning both owning packages', () => {
    const [yaml, applyState] = deviceBaselineFiles();

    expect(fs.existsSync(yaml!.absPath)).toBe(true);
    expect(fs.existsSync(applyState!.absPath)).toBe(true);
    expect(path.basename(yaml!.absPath)).toBe('podkit-device.yaml');
    expect(path.basename(applyState!.absPath)).toBe('apply-state.sh');
    // The two inputs are owned by different packages — the reason this
    // composer exists rather than a single package root.
    expect(yaml!.absPath.includes(`${path.sep}lima${path.sep}`)).toBe(true);
    expect(applyState!.absPath.includes(`${path.sep}device-testing${path.sep}`)).toBe(true);
  });

  it('feeds the hashing primitive without throwing on a missing input', () => {
    const { combinedSha, files } = computeBaselineHash(deviceBaselineFiles());
    expect(combinedSha).toMatch(/^[0-9a-f]{64}$/);
    expect(files).toHaveLength(2);
  });
});

/**
 * Unit tests for the baseline-hash primitive. Assert the external contract:
 * a deterministic combined hash over the tracked files, per-file digests in
 * declaration order, sensitivity to content changes, and a loud throw when a
 * tracked file is missing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { computeBaselineHash } from './baseline-hash.js';

let root: string;

/** Lay down a fake package root with the two tracked baseline files. */
function seed(yamlContent: string, applyStateContent: string): void {
  fs.mkdirSync(path.join(root, 'lima'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lima', 'podkit-device-harness.yaml'), yamlContent);
  fs.writeFileSync(path.join(root, 'scripts', 'apply-state.sh'), applyStateContent);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-baseline-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('computeBaselineHash', () => {
  it('hashes both tracked files in declaration order', () => {
    seed('yaml-a', 'sh-a');
    const result = computeBaselineHash(root);

    expect(result.files).toHaveLength(2);
    expect(result.files[0]!.relPath).toBe('lima/podkit-device-harness.yaml');
    expect(result.files[1]!.relPath).toBe('scripts/apply-state.sh');
    expect(result.files[0]!.sha256).toBe(createHash('sha256').update('yaml-a').digest('hex'));
    expect(result.combinedSha).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical content', () => {
    seed('yaml-a', 'sh-a');
    const a = computeBaselineHash(root).combinedSha;
    const b = computeBaselineHash(root).combinedSha;
    expect(a).toBe(b);
  });

  it('changes the combined hash when either tracked file changes', () => {
    seed('yaml-a', 'sh-a');
    const base = computeBaselineHash(root).combinedSha;

    seed('yaml-a', 'sh-CHANGED');
    const drifted = computeBaselineHash(root).combinedSha;
    expect(drifted).not.toBe(base);
  });

  it('throws loudly when a tracked file is missing', () => {
    // Only the yaml exists; apply-state.sh is absent.
    fs.mkdirSync(path.join(root, 'lima'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lima', 'podkit-device-harness.yaml'), 'yaml-a');
    expect(() => computeBaselineHash(root)).toThrow(/cannot read tracked baseline file/);
    expect(() => computeBaselineHash(root)).toThrow(/apply-state\.sh/);
  });
});

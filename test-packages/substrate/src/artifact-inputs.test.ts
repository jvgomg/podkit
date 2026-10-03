/**
 * Unit tests for the build-inputs stamp an artifact carries next to it.
 *
 * The case that matters is a correctly-named, correct-arch binary built from
 * sources that have since changed: every other check passes it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  StaleArtifactError,
  artifactInputsStampPath,
  assertArtifactInputsCurrent,
  stampArtifactInputs,
} from './artifact-inputs.js';

let root: string;
let artifactPath: string;
let inputA: string;
let inputB: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-inputs-'));
  fs.mkdirSync(path.join(root, 'pkg', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pkg', 'dist'), { recursive: true });
  inputA = path.join(root, 'pkg', 'src', 'a.ts');
  inputB = path.join(root, 'pkg', 'src', 'b.ts');
  fs.writeFileSync(inputA, 'export const a = 1;\n');
  fs.writeFileSync(inputB, 'export const b = 2;\n');
  artifactPath = path.join(root, 'pkg', 'dist', 'thing-linux-x64');
  fs.writeFileSync(artifactPath, 'binary');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const HINT = 'rebuild with `do-the-build`';

function assertCurrent(): void {
  assertArtifactInputsCurrent({ artifactPath, root, rebuildHint: HINT });
}

describe('artifact inputs stamp', () => {
  it('passes an artifact whose inputs are unchanged since it was built', () => {
    stampArtifactInputs({ artifactPath, inputs: [inputA, inputB], root });
    expect(() => assertCurrent()).not.toThrow();
  });

  it('records inputs relative to the root, so the stamp survives a move of the checkout', () => {
    stampArtifactInputs({ artifactPath, inputs: [inputB, inputA], root });
    const stamp = JSON.parse(fs.readFileSync(artifactInputsStampPath(artifactPath), 'utf8'));
    expect(Object.keys(stamp.inputs)).toEqual(['pkg/src/a.ts', 'pkg/src/b.ts']);
  });

  it('names the input that changed after the build', () => {
    stampArtifactInputs({ artifactPath, inputs: [inputA, inputB], root });
    fs.writeFileSync(inputB, 'export const b = 3;\n');
    expect(() => assertCurrent()).toThrow(StaleArtifactError);
    expect(() => assertCurrent()).toThrow(/pkg\/src\/b\.ts/);
  });

  it('treats a deleted input as stale', () => {
    stampArtifactInputs({ artifactPath, inputs: [inputA, inputB], root });
    fs.rmSync(inputA);
    expect(() => assertCurrent()).toThrow(/pkg\/src\/a\.ts/);
  });

  it('refuses an artifact with no stamp: nothing says what it was built from', () => {
    expect(() => assertCurrent()).toThrow(StaleArtifactError);
    expect(() => assertCurrent()).toThrow(/no build-inputs stamp/);
  });

  it('refuses a corrupt stamp with the same typed error', () => {
    fs.writeFileSync(artifactInputsStampPath(artifactPath), '{"inputs": {"pkg/sr');
    expect(() => assertCurrent()).toThrow(StaleArtifactError);
    expect(() => assertCurrent()).toThrow(/unreadable build-inputs stamp/);
  });

  it('tells the reader how to rebuild', () => {
    expect(() => assertCurrent()).toThrow(HINT);
  });
});

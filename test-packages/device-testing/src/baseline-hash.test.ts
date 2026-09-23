/**
 * Unit tests for the baseline composition. The hashing itself is covered in
 * `@podkit/lima`; what matters here is that this package names the right
 * inputs, in the right order, per substrate — and that every file really
 * exists, since the primitive throws on a missing one.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getVm, SUBSTRATE_IMAGE_PIN } from '@podkit/substrate';

import {
  deviceBaselineFiles,
  substrateBaselineInputs,
  computeBaselineHash,
  type TrackedBaselineInput,
} from './baseline-hash.js';

/** Absolute paths only; a tracked value has none. */
function filesOf(inputs: readonly TrackedBaselineInput[]): string[] {
  return inputs.flatMap((i) => ('absPath' in i ? [i.absPath] : []));
}

describe('substrateBaselineInputs', () => {
  // The contract scripts matter more to drift than the declaration does: the
  // declaration produces a plain Debian box, while these three are what make
  // it a substrate. Dropping one would leave the box provisionable from
  // something the repo no longer says, with no drift reported.
  it('tracks the Lima yaml, apply-state.sh, the contract and the image pin', () => {
    expect(deviceBaselineFiles().map((f) => f.label)).toEqual([
      'podkit-device.yaml',
      'apply-state.sh',
      'substrate-contract.sh',
      'provision-substrate.sh',
      'substrate-doctor.sh',
      'debian-image-pin',
    ]);
  });

  it('swaps the Lima yaml for the cloud-init template on an ssh substrate', () => {
    const remote = substrateBaselineInputs(getVm('deviceRemote'));
    expect(remote.map((f) => f.label)).toEqual([
      'cloud-init.user-data.yaml',
      'apply-state.sh',
      'substrate-contract.sh',
      'provision-substrate.sh',
      'substrate-doctor.sh',
      'debian-image-pin',
    ]);
  });

  it('gives the two substrates different hashes, since their inputs differ', () => {
    expect(
      computeBaselineHash(substrateBaselineInputs(getVm('deviceRemote'))).combinedSha
    ).not.toBe(computeBaselineHash(deviceBaselineFiles()).combinedSha);
  });

  it('tracks the image pin by value, not by the module declaring it', () => {
    const pin = deviceBaselineFiles().at(-1)!;
    expect(pin).toEqual({ label: 'debian-image-pin', value: SUBSTRATE_IMAGE_PIN });
    expect(SUBSTRATE_IMAGE_PIN).toContain('serial=');
  });

  it('points at files that exist, spanning both owning packages', () => {
    for (const substrate of [getVm('device'), getVm('deviceRemote')]) {
      const paths = filesOf(substrateBaselineInputs(substrate));
      for (const absPath of paths) expect(fs.existsSync(absPath)).toBe(true);
    }

    const [declaration, applyState] = filesOf(deviceBaselineFiles());
    // The two are owned by different packages — the reason this composer
    // exists rather than a single package root.
    expect(declaration!.includes(`${path.sep}lima${path.sep}`)).toBe(true);
    expect(applyState!.includes(`${path.sep}device-testing${path.sep}`)).toBe(true);
  });

  it('feeds the hashing primitive without throwing on a missing input', () => {
    const { combinedSha, files } = computeBaselineHash(deviceBaselineFiles());
    expect(combinedSha).toMatch(/^[0-9a-f]{64}$/);
    expect(files).toHaveLength(6);
  });
});

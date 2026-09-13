/**
 * The pinned-image agreement test.
 *
 * This is the mechanism that replaced four "bump these together" comments. It
 * reads the Lima YAMLs and the shell half of the substrate contract off disk
 * and asserts they say what `debian-image.ts` says. A YAML cannot import a
 * TypeScript constant and a Debian box has no TypeScript on it, so the literal
 * duplication is unavoidable — what is avoidable is the duplication going
 * unnoticed, which is what this file removes.
 *
 * It also asserts the negative half: the substrates that deliberately float on
 * the distro's `latest` image must NOT acquire a pin, because a pin nobody
 * chose is as much drift as a missing one.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { repoRoot } from './paths.js';
import { getVm, isLimaVm, listVms, type LimaVmId } from './registry.js';
import {
  substrateDebianImageUrl,
  DEBIAN_IMAGE_ARCHES,
  LIMA_ARCH_BY_DEBIAN_ARCH,
  PINNED_DEBIAN_IMAGE_VM_IDS,
  SUBSTRATE_CONTRACT_REL_PATH,
  SUBSTRATE_DEBIAN_IMAGE_SERIAL,
  SUBSTRATE_DEBIAN_MAJOR,
  SUBSTRATE_DEBIAN_POINT_RELEASE,
} from './debian-image.js';

function readVmYaml(id: LimaVmId): string {
  return fs.readFileSync(getVm(id).yamlPath, 'utf8');
}

/** One `- location: '…'` entry plus the `arch:` line that follows it. */
interface ImageEntry {
  location: string;
  arch: string;
}

/**
 * Parse the `images:` block without a YAML dependency. The shape is fixed and
 * two lines long per entry; pulling in a parser to read it would be a
 * dependency for a regex.
 *
 * Scoped to the `images:` block rather than run over the whole file: `mounts:`
 * uses `- location:` too, and a naive scan silently counts the host-home mount
 * as a third image.
 */
function parseImages(yaml: string): ImageEntry[] {
  const entries: ImageEntry[] = [];
  const lines = yaml.split('\n');
  let inImages = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^images:\s*$/.test(line)) {
      inImages = true;
      continue;
    }
    // Any other column-zero key ends the block. Blank and indented lines
    // (including the comments the YAMLs carry inside the block) do not.
    if (inImages && /^\S/.test(line)) break;
    if (!inImages) continue;
    const location = /^\s*-\s*location:\s*'([^']+)'\s*$/.exec(line);
    if (!location) continue;
    const arch = /^\s*arch:\s*'([^']+)'\s*$/.exec(lines[i + 1] ?? '');
    entries.push({ location: location[1]!, arch: arch?.[1] ?? '' });
  }
  return entries;
}

/** The `NAME="value"` assignment for one shell-contract variable. */
function shellContractValue(name: string): string | undefined {
  const contract = fs.readFileSync(path.join(repoRoot(), SUBSTRATE_CONTRACT_REL_PATH), 'utf8');
  return new RegExp(`^${name}="([^"]*)"$`, 'm').exec(contract)?.[1];
}

describe('pinned Debian image', () => {
  it('builds the published cloud-image URL for each architecture', () => {
    expect(substrateDebianImageUrl('amd64')).toBe(
      `https://cloud.debian.org/images/cloud/bookworm/${SUBSTRATE_DEBIAN_IMAGE_SERIAL}/` +
        `debian-12-generic-amd64-${SUBSTRATE_DEBIAN_IMAGE_SERIAL}.qcow2`
    );
    expect(substrateDebianImageUrl('arm64')).toBe(
      `https://cloud.debian.org/images/cloud/bookworm/${SUBSTRATE_DEBIAN_IMAGE_SERIAL}/` +
        `debian-12-generic-arm64-${SUBSTRATE_DEBIAN_IMAGE_SERIAL}.qcow2`
    );
  });

  it('pins a dated serial rather than a floating tag', () => {
    expect(SUBSTRATE_DEBIAN_IMAGE_SERIAL).toMatch(/^\d{8}-\d{4}$/);
    expect(SUBSTRATE_DEBIAN_POINT_RELEASE.startsWith(`${SUBSTRATE_DEBIAN_MAJOR}.`)).toBe(true);
  });
});

describe('pinned Debian image — agreement with the Lima YAMLs', () => {
  for (const id of PINNED_DEBIAN_IMAGE_VM_IDS) {
    it(`${id} declares exactly the pinned image for every architecture`, () => {
      const images = parseImages(readVmYaml(id));
      expect(images).toHaveLength(DEBIAN_IMAGE_ARCHES.length);
      for (const arch of DEBIAN_IMAGE_ARCHES) {
        const expectedUrl = substrateDebianImageUrl(arch);
        const entry = images.find((image) => image.location === expectedUrl);
        // The failure message matters more than usual here: whoever reads it is
        // mid-bump and needs to know which file still says the old thing.
        expect(entry, `${getVm(id).yamlPath} does not pin ${arch} to ${expectedUrl}`).toBeDefined();
        expect(entry!.arch).toBe(LIMA_ARCH_BY_DEBIAN_ARCH[arch]);
      }
    });
  }

  it('leaves the deliberately-floating substrates floating', () => {
    const floating = listVms()
      .filter(isLimaVm)
      .filter((vm) => !(PINNED_DEBIAN_IMAGE_VM_IDS as readonly string[]).includes(vm.id));
    expect(floating.length).toBeGreaterThan(0);
    for (const vm of floating) {
      for (const image of parseImages(fs.readFileSync(vm.yamlPath, 'utf8'))) {
        expect(
          image.location,
          `${vm.yamlPath} pins a serial; either add ${vm.id} to PINNED_DEBIAN_IMAGE_VM_IDS or float it`
        ).not.toContain(SUBSTRATE_DEBIAN_IMAGE_SERIAL);
      }
    }
  });
});

describe('pinned Debian image — agreement with the shell contract', () => {
  it('declares the same Debian major version', () => {
    expect(shellContractValue('SUBSTRATE_DEBIAN_MAJOR')).toBe(SUBSTRATE_DEBIAN_MAJOR);
  });

  it('declares the same point release', () => {
    expect(shellContractValue('SUBSTRATE_DEBIAN_POINT_RELEASE')).toBe(
      SUBSTRATE_DEBIAN_POINT_RELEASE
    );
  });
});

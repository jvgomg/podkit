/**
 * The builder-contract agreement test.
 *
 * Two jobs, and the second is the important one.
 *
 * **Agreement.** `builder-contract.sh` restates the pinned Debian release, the
 * glibc toolchain package list, the Node major and the Alpine base image —
 * because a builder is provisioned before it has a repo checkout on it, a Lima
 * YAML cannot read a Containerfile, and a Containerfile cannot read a
 * TypeScript constant. Every one of those duplications is unavoidable. Each of
 * them going unnoticed is not, so this file reads the other copy off disk and
 * fails if the two disagree.
 *
 * **Non-agreement.** `substrate-contract.sh` and `builder-contract.sh`
 * contradict each other by design: the substrate forbids exactly the toolchain
 * the builder requires, which is what lets a substrate catch a static-linkage
 * regression in a binary claiming to need none (ADR-029 §4). That property is
 * invisible in review — merging the two contracts, or factoring out a shared
 * base of "common" packages, looks like tidying and silently defeats the
 * substrate. The assertions below make it fail red instead.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { repoRoot } from './paths.js';
import { getVm } from './registry.js';
import { shellContractList, shellContractValue } from './shell-contract.js';
import {
  BUILDER_CONTRACT_REL_PATH,
  SUBSTRATE_CONTRACT_REL_PATH,
  SUBSTRATE_DEBIAN_MAJOR,
  SUBSTRATE_DEBIAN_POINT_RELEASE,
} from './debian-image.js';

const SCRIPTS_DIR = path.join(repoRoot(), 'test-packages', 'device-testing', 'scripts');

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot(), relPath), 'utf8');
}

/** This file's two contracts, curried so the call sites read as assertions. */
const builder = (name: string): string => shellContractValue(BUILDER_CONTRACT_REL_PATH, name);
const builderList = (name: string): Set<string> =>
  shellContractList(BUILDER_CONTRACT_REL_PATH, name);

/**
 * The arguments of a line-continued package-install command, as a set.
 *
 * Handles both `apt-get install -y --no-install-recommends \` in a Lima YAML
 * and `apk add --no-cache \` in a Containerfile: one leading command line, then
 * one package per continued line until a line that does not end in a backslash.
 * Flags are dropped so `--no-install-recommends` is not read as a package.
 */
function packagesFromInstallBlock(text: string, commandPattern: RegExp): Set<string> {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => commandPattern.test(line));
  if (start === -1) throw new Error(`no install command matching ${commandPattern} found`);

  const packages = new Set<string>();
  // The command line itself may already carry packages (before the backslash).
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const continues = /\\\s*$/.test(raw);
    const body = raw
      .replace(/\\\s*$/, '')
      .replace(/^\s*(RUN\s+)?/, '')
      .trim();
    // Only the FIRST line can carry command words; every continued line is
    // nothing but package names. Scoping the drop-list that way means a package
    // named `install` on a later line survives, which a blanket filter would
    // have eaten silently.
    const commandWords = i === start ? ['apt-get', 'apk', 'install', 'add'] : [];
    for (const token of body.split(/\s+/)) {
      if (!token || token.startsWith('-')) continue;
      if (commandWords.includes(token)) continue;
      packages.add(token);
    }
    if (!continues) break;
  }
  return packages;
}

describe('builder contract — agreement with the repo it was copied out of', () => {
  it('pins the same Debian release the substrate does', () => {
    // Builder and substrate must move together: the ABI chain is "the builder
    // produces a binary, abi-verify vouches for it, the substrate runs it", and
    // a release skew turns that into three unrelated observations. The builder
    // side is the sharper of the two — its glibc becomes the artifact's floor.
    expect(builder('BUILDER_DEBIAN_MAJOR')).toBe(SUBSTRATE_DEBIAN_MAJOR);
    expect(builder('BUILDER_DEBIAN_POINT_RELEASE')).toBe(SUBSTRATE_DEBIAN_POINT_RELEASE);
  });

  it('declares the same apt toolchain the Lima glibc builder installs', () => {
    const yaml = fs.readFileSync(getVm('builderGlibc').yamlPath, 'utf8');
    const fromYaml = packagesFromInstallBlock(yaml, /apt-get install -y --no-install-recommends/);
    const fromContract = builderList('BUILDER_TOOLCHAIN_PACKAGES');
    expect([...fromContract].sort()).toEqual([...fromYaml].sort());
  });

  it('keeps the container runtime out of that shared list', () => {
    // Deliberately a second variable rather than an entry in the first. The
    // Lima path has a whole second VM for musl and needs no runtime, so folding
    // podman into BUILDER_TOOLCHAIN_PACKAGES would make the agreement test
    // above unstatable — and the exception would then live in this file rather
    // than in the contract, where the next reader looks.
    const runtime = builderList('BUILDER_CONTAINER_PACKAGES');
    const toolchain = builderList('BUILDER_TOOLCHAIN_PACKAGES');
    expect(runtime.size).toBeGreaterThan(0);
    for (const pkg of runtime) expect(toolchain.has(pkg)).toBe(false);
    expect(runtime.has(builder('BUILDER_CONTAINER_RUNTIME'))).toBe(true);
  });

  it('asserts a meson floor the Lima glibc builder also clears', () => {
    // Two different numbers that must stay consistent rather than equal. The
    // contract's floor is what glib actually REQUIRES (2.82.4 wants >= 1.2.0)
    // and is what the doctor asserts; the YAML's is what its pip line INSTALLS,
    // which may be higher. The bug this catches is the floor drifting ABOVE
    // what the Lima builder installs — the doctor would then reject a box the
    // macOS path builds on perfectly well.
    const yaml = fs.readFileSync(getVm('builderGlibc').yamlPath, 'utf8');
    const installed = /"meson>=([\d.]+)"/.exec(yaml)?.[1];
    expect(installed).toBeDefined();

    const asVersion = (raw: string): number[] => raw.split('.').map(Number);
    const [floorMajor = 0, floorMinor = 0] = asVersion(builder('BUILDER_MESON_MIN_VERSION'));
    const [installedMajor = 0, installedMinor = 0] = asVersion(installed!);
    expect(
      installedMajor > floorMajor || (installedMajor === floorMajor && installedMinor >= floorMinor)
    ).toBe(true);
  });

  it('builds the Node major the Lima glibc builder builds against', () => {
    // node-gyp bakes the building Node's ABI into the addon, so this is a
    // property of the artifact rather than a preference.
    const yaml = fs.readFileSync(getVm('builderGlibc').yamlPath, 'utf8');
    const fromYaml = /deb\.nodesource\.com\/setup_(\d+)\.x/.exec(yaml)?.[1];
    expect(fromYaml).toBeDefined();
    expect(builder('BUILDER_NODE_MAJOR')).toBe(fromYaml!);
  });
});

describe('builder contract — the musl container replaces the musl VM', () => {
  const containerfileRelPath = builder('BUILDER_MUSL_CONTAINERFILE_REL_PATH');

  it('points at a Containerfile that exists', () => {
    // Load-bearing that this resolves at all: the contract composes it from
    // BUILDER_MUSL_CONTAINERFILE_SUBPATH, which provision-builder.sh resolves
    // against its own directory instead. Two questions, one tail — and this is
    // what catches the two coming apart.
    expect(fs.existsSync(path.join(repoRoot(), containerfileRelPath))).toBe(true);
  });

  it('pins the Alpine the published Docker image is FROM', () => {
    // The binaries built in this container ship in that image, so the parity is
    // exact rather than approximate.
    const dockerfile = readRepoFile('packages/podkit-docker/Dockerfile');
    const base = /^FROM (alpine:[\d.]+)$/m.exec(dockerfile)?.[1];
    expect(base).toBeDefined();
    expect(builder('BUILDER_MUSL_BASE_IMAGE')).toBe(base!);
  });

  it('pins the Containerfile ARG default to the same Alpine', () => {
    // The ARG default is the value a bare `podman build` of this file uses —
    // the path provisioning does NOT take, since it passes --build-arg. A
    // default nobody passes is a default nobody notices going stale, and it
    // would produce a musl toolchain from a different Alpine than the one the
    // shipped image is built on.
    const containerfile = readRepoFile(containerfileRelPath);
    const argDefault = /^ARG BASE_IMAGE=(alpine:[\d.]+)$/m.exec(containerfile)?.[1];
    expect(argDefault).toBeDefined();
    expect(argDefault).toBe(builder('BUILDER_MUSL_BASE_IMAGE'));
  });

  it('installs the same apk toolchain the Lima musl builder installs', () => {
    const containerfile = readRepoFile(containerfileRelPath);
    const fromContainer = packagesFromInstallBlock(containerfile, /^RUN apk add /);
    const fromYaml = packagesFromInstallBlock(
      fs.readFileSync(getVm('builderMusl').yamlPath, 'utf8'),
      /^\s*apk add \\\s*$/
    );
    expect([...fromContainer].sort()).toEqual([...fromYaml].sort());
  });
});

describe('builder contract — the inverse of the substrate contract', () => {
  it('requires every command the substrate forbids', () => {
    const forbidden = shellContractList(
      SUBSTRATE_CONTRACT_REL_PATH,
      'SUBSTRATE_FORBIDDEN_COMMANDS'
    );
    const required = builderList('BUILDER_COMMANDS');
    expect(forbidden.size).toBeGreaterThan(0);
    for (const cmd of forbidden) {
      expect(required.has(cmd), `builder must require '${cmd}', which the substrate forbids`).toBe(
        true
      );
    }
  });

  it('installs every package the substrate forbids, and plenty of -dev besides', () => {
    const forbidden = shellContractList(
      SUBSTRATE_CONTRACT_REL_PATH,
      'SUBSTRATE_FORBIDDEN_PACKAGES'
    );
    const required = builderList('BUILDER_TOOLCHAIN_PACKAGES');
    expect(forbidden.size).toBeGreaterThan(0);
    for (const pkg of forbidden) {
      expect(required.has(pkg), `builder must install '${pkg}', which the substrate forbids`).toBe(
        true
      );
    }
    // The substrate's other negative assertion is "nothing whose name ends in
    // -dev". It is a pattern rather than a list, so it is asserted as one.
    expect([...required].filter((pkg) => pkg.endsWith('-dev')).length).toBeGreaterThan(0);
  });

  it('shares no contract file between the two profiles', () => {
    // Shared MECHANISM is the thing to reuse — three files, values/apply/assert,
    // copied in and run as root. Shared VALUES are what must never happen, and
    // the first step towards them is one script sourcing the other's contract.
    const builderScripts = ['provision-builder.sh', 'builder-doctor.sh'];
    const substrateScripts = ['provision-substrate.sh', 'substrate-doctor.sh'];

    for (const script of builderScripts) {
      const body = fs.readFileSync(path.join(SCRIPTS_DIR, script), 'utf8');
      expect(
        /^\s*\.\s.*substrate-contract\.sh/m.test(body),
        `${script} sources the substrate contract`
      ).toBe(false);
    }
    for (const script of substrateScripts) {
      const body = fs.readFileSync(path.join(SCRIPTS_DIR, script), 'utf8');
      expect(
        /^\s*\.\s.*builder-contract\.sh/m.test(body),
        `${script} sources the builder contract`
      ).toBe(false);
    }
  });

  it('leaves the no-toolchain assertions out of the builder doctor', () => {
    // Copying substrate-doctor.sh's negative block over would fail a builder on
    // every positive assertion it just passed. Asserted because the block is
    // the most copy-pasteable thing in the sibling file, and its absence here
    // reads as an omission rather than a decision.
    const doctor = fs.readFileSync(path.join(SCRIPTS_DIR, 'builder-doctor.sh'), 'utf8');
    expect(doctor).not.toMatch(/\$SUBSTRATE_FORBIDDEN_COMMANDS/);
    expect(doctor).not.toMatch(/\$SUBSTRATE_FORBIDDEN_PACKAGES/);
  });
});

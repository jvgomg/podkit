/**
 * The registry of guest-local staging destinations — one declared owner per
 * directory, so no two callers can rsync into the same tree.
 *
 * A stage is `rsync -a --delete`. Two of those pointed at the same destination
 * is not a slow path, it is a corrupt one: each side's `--delete` and temp-file
 * renames race the other's, and the loser aborts with rsync exit 23 ("some
 * files/attrs were not transferred"). That is a genuinely different failure
 * from the exit 24 a stage tolerates — 24 is a file vanishing on the SENDING
 * side and leaves the destination consistent; 23 here means two writers in the
 * destination and leaves it inconsistent, so it must stay fatal.
 *
 * The destination was previously spelled as a bare string in each build
 * wrapper, which made a collision invisible: two turbo tasks with no ordering
 * edge between them both wrote `/tmp/podkit-builder-src`, and it only failed
 * when the trees were cold enough for the transfers to overlap. Declaring every
 * destination here makes the collision a property of ONE file that a test can
 * check, rather than something you find by grepping five shell scripts.
 *
 * The invariant is stronger than "no duplicate paths": two areas on the same
 * box must not NEST either, because `--delete` in a parent wipes the child.
 *
 * ## Why this is not in `@podkit/lima`
 *
 * It was, and the areas below now include directories on a Proxmox guest Lima
 * has never heard of. A registry keyed on substrate ids, describing paths on
 * boxes any provisioner may have produced, belongs beside the substrate
 * registry it keys on — the same argument that moved the registry and the
 * binary paths here (ADR-029 §1). `@podkit/lima` re-exports it, so existing
 * import sites resolve unchanged.
 *
 * Adding a staging area:
 *   1. Add an entry below with a clean `id`, the registry substrate `id`, the
 *      absolute guest-local `dest`, and the `owner` that writes it.
 *   2. `staging-areas.test.ts` pins disjointness — a colliding entry fails there.
 *   3. Have the caller read its path via the registry rather than restating the
 *      literal.
 *
 * @module
 */

import { getVm } from './registry.js';

/** One guest-local staging destination with exactly one writer. */
export interface StagingArea {
  /** Clean identifier callers look the area up by. */
  id: string;
  /** Registry `id` of the substrate the directory lives on (never an instance name). */
  vm: string;
  /** Absolute guest-local destination path. */
  dest: string;
  /**
   * The single caller that stages here. Prose, not a key — its job is to make
   * a second claimant obvious to a human reading the registry.
   */
  owner: string;
  /**
   * The build job this area serves, when it serves one.
   *
   * The lookup a build driver needs is `(build host, job) → directory`, not
   * `id → directory`: the same job stages to `/tmp/podkit-builder-src` on a
   * Lima builder and to `/var/tmp/podkit-build/glibc-binary` on a remote one,
   * and the driver knows which job it is running rather than which id someone
   * gave that job's directory on the box it happens to be pointed at.
   *
   * Absent on the areas that serve no build — the two Linux test runners and
   * the virtual iPod.
   */
  job?: BuildJobId;
}

/**
 * The build jobs that stage a tree. One per artifact group, and the reason
 * they are named here rather than in the driver is that a directory has to be
 * declared for each one on every build host before the driver can run.
 */
export const BUILD_JOB_IDS = [
  'glibcPrebuild',
  'glibcBinary',
  'glibcGpodTool',
  'muslPrebuild',
  'muslBinary',
] as const;

/** Id of a build job that stages a source tree. */
export type BuildJobId = (typeof BUILD_JOB_IDS)[number];

/**
 * Every declared staging destination.
 *
 * The Lima builder areas keep the paths they have always used, with one
 * exception: the gpod-tool build used to share `/tmp/podkit-builder-src` with
 * the CLI binary build, and now has its own. Renaming the others would buy
 * nothing and would strand a multi-gigabyte orphan tree in each builder VM.
 *
 * The remote builder's are subdirectories of the one root its contract
 * declares (`BUILDER_STAGING_DIR`), rather than five siblings in `/var/tmp`:
 * the contract creates and the doctor asserts that root, so nesting inside it
 * means a job directory inherits a writability guarantee somebody checked
 * instead of one the driver assumed. `/var/tmp` and not `/tmp` because a cloud
 * image clears `/tmp` on boot and may back it with RAM, and a repo checkout
 * plus a static-dep closure belongs in neither.
 *
 * All five sit on the same box: the remote builder is a glibc box that reaches
 * musl through an Alpine container (doc-060), so its musl trees are siblings
 * of its glibc ones rather than residents of a second guest.
 */
const REGISTRY: readonly StagingArea[] = [
  {
    id: 'glibcPrebuild',
    job: 'glibcPrebuild',
    vm: 'builderGlibc',
    dest: '/tmp/podkit-libgpod-build',
    owner: '@podkit/device-testing#build:linux-prebuild',
  },
  {
    id: 'glibcBinary',
    job: 'glibcBinary',
    vm: 'builderGlibc',
    dest: '/tmp/podkit-builder-src',
    owner: '@podkit/device-testing#build:linux-binary',
  },
  {
    // Previously shared `glibcBinary`'s directory. The two tasks have no
    // ordering edge in turbo, so they staged concurrently and collided.
    id: 'glibcGpodTool',
    job: 'glibcGpodTool',
    vm: 'builderGlibc',
    dest: '/tmp/podkit-gpod-tool-src',
    owner: '@podkit/gpod-testing#build:linux-binary',
  },
  {
    id: 'muslPrebuild',
    job: 'muslPrebuild',
    vm: 'builderMusl',
    dest: '/tmp/podkit-musl-libgpod-build',
    owner: '@podkit/device-testing#build:musl-prebuild',
  },
  {
    id: 'muslBinary',
    job: 'muslBinary',
    vm: 'builderMusl',
    dest: '/tmp/podkit-musl-builder-src',
    owner: '@podkit/device-testing#build:musl-binary',
  },
  {
    id: 'remoteGlibcPrebuild',
    job: 'glibcPrebuild',
    vm: 'builderRemote',
    dest: '/var/tmp/podkit-build/glibc-prebuild',
    owner: '@podkit/device-testing#build:linux-prebuild',
  },
  {
    id: 'remoteGlibcBinary',
    job: 'glibcBinary',
    vm: 'builderRemote',
    dest: '/var/tmp/podkit-build/glibc-binary',
    owner: '@podkit/device-testing#build:linux-binary',
  },
  {
    id: 'remoteGlibcGpodTool',
    job: 'glibcGpodTool',
    vm: 'builderRemote',
    dest: '/var/tmp/podkit-build/glibc-gpod-tool',
    owner: '@podkit/gpod-testing#build:linux-binary',
  },
  {
    id: 'remoteMuslPrebuild',
    job: 'muslPrebuild',
    vm: 'builderRemote',
    dest: '/var/tmp/podkit-build/musl-prebuild',
    owner: '@podkit/device-testing#build:musl-prebuild',
  },
  {
    id: 'remoteMuslBinary',
    job: 'muslBinary',
    vm: 'builderRemote',
    dest: '/var/tmp/podkit-build/musl-binary',
    owner: '@podkit/device-testing#build:musl-binary',
  },
  {
    id: 'testGlibc',
    vm: 'testGlibc',
    dest: '/tmp/podkit-test',
    owner: 'tools/lima/run-tests.sh',
  },
  {
    // Same path as `testGlibc`, different VM — which is exactly why the
    // disjointness check is keyed on (vm, dest) and not on dest alone.
    id: 'testMusl',
    vm: 'testMusl',
    dest: '/tmp/podkit-test',
    owner: 'tools/lima/run-tests.sh',
  },
  {
    id: 'virtualIpod',
    vm: 'virtualIpod',
    dest: '/opt/podkit',
    owner: 'mise vipod:install',
  },
];

/** Every registered staging area, in declaration order. */
export function listStagingAreas(): readonly StagingArea[] {
  return REGISTRY;
}

/**
 * Look a staging area up by `id`. Throws with the known ids when nothing
 * matches — a mistyped id must fail loudly rather than fall back to some
 * default directory that another caller already owns.
 */
export function getStagingArea(id: string): StagingArea {
  const found = REGISTRY.find((area) => area.id === id);
  if (!found) {
    const known = REGISTRY.map((area) => `${area.id} (${area.vm}:${area.dest})`).join(', ');
    throw new Error(
      `getStagingArea: no staging area registered for '${id}'. Known areas: ${known}.`
    );
  }
  return found;
}

/**
 * Resolve the staging directory a `job` uses on a given build host.
 *
 * The lookup the build driver performs, and the one that makes a build host a
 * *role*: the driver knows which job it is running and which box it was
 * pointed at, and never which id somebody gave that pair's directory.
 *
 * @throws when the build host declares no area for the job, naming the ones it
 * does declare. A builder that cannot host a job must say so here rather than
 * have the driver invent a directory nothing owns.
 */
export function stagingDestForJob(vmIdOrInstance: string, job: BuildJobId): string {
  const vm = getVm(vmIdOrInstance);
  const found = REGISTRY.find((area) => area.job === job && getVm(area.vm).id === vm.id);
  if (!found) {
    const declared = REGISTRY.filter((area) => area.vm === vm.id && area.job)
      .map((area) => area.job)
      .join(', ');
    throw new Error(
      `stagingDestForJob: build host '${vm.id}' declares no staging area for job '${job}'. ` +
        `It declares: ${declared || '(none)'}.`
    );
  }
  return found.dest;
}

/**
 * Resolve the guest-local destination for `areaId`, asserting the area really
 * belongs to `vmIdOrInstance`.
 *
 * The VM is re-stated by the caller on purpose: a wrapper that points its musl
 * build at a glibc area has a bug that is otherwise silent until the artefact
 * comes out linked against the wrong libc.
 */
export function stagingDestFor(vmIdOrInstance: string, areaId: string): string {
  const area = getStagingArea(areaId);
  const requested = getVm(vmIdOrInstance);
  const owning = getVm(area.vm);
  if (requested.instanceName !== owning.instanceName) {
    throw new Error(
      `stagingDestFor: staging area '${area.id}' belongs to ${owning.instanceName}, ` +
        `not ${requested.instanceName}.`
    );
  }
  return area.dest;
}

/**
 * The disjointness rule, as a pure function so it can be tested against
 * synthetic registries rather than only against the real one.
 *
 * Returns a human-readable description of the FIRST offending pair, or
 * `undefined` when every area in the same VM occupies its own subtree. Nesting
 * counts as a collision: `rsync --delete` into `/tmp/a` removes `/tmp/a/b`
 * wholesale, so a parent and a child are two writers of the same tree.
 */
export function findStagingCollision(areas: readonly StagingArea[]): string | undefined {
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const a = areas[i]!;
      const b = areas[j]!;
      if (a.vm !== b.vm) continue;
      if (a.dest === b.dest) {
        return `'${a.id}' and '${b.id}' both stage into ${a.vm}:${a.dest}`;
      }
      const [outer, inner] = a.dest.length <= b.dest.length ? [a, b] : [b, a];
      if (inner.dest.startsWith(`${outer.dest}/`)) {
        return (
          `'${inner.id}' (${inner.dest}) nests inside '${outer.id}' (${outer.dest}) ` +
          `in ${a.vm}; a --delete in the parent would wipe the child`
        );
      }
    }
  }
  return undefined;
}

/**
 * The build jobs — what gets built, where it is staged, and what comes back.
 *
 * ## Why this is a table and not five scripts
 *
 * It was five scripts: `build-linux-prebuild.sh`, `build-linux-binary.sh`,
 * `build-gpod-tool-linux.sh` and their two musl siblings. Each opened by
 * checking for `limactl`, starting a Lima instance, reading `uname -m` out of
 * it, looking up a staging directory, rsyncing, running a guest script, and
 * copying artifacts back — the same six steps, written six times, differing in
 * the guest script and in three filenames.
 *
 * That shape is what made "builder is a role" impossible: every one of the six
 * steps named `limactl`, so pointing a build at an SSH-reachable box meant
 * five more scripts rather than one decision. Here, the six steps are the
 * driver's (`scripts/build-artifacts.ts`) and run over a {@link SubstrateLink};
 * this file is only the part that genuinely differs per job.
 *
 * The guest scripts below are the previous ones, near-verbatim, including
 * their verification steps and the reasons attached to them. They were
 * hard-won — the `ldd` allow-list, "do not execute the daemon, it is a poller
 * with no fast-exit path", `--ignore-scripts` on every install — and none of
 * that is what this slice is changing.
 *
 * ## The one thing the scripts did that the driver deliberately does not
 *
 * The old prebuild wrappers ended by `cp`-ing the finished `.node` back through
 * Lima's host mount, from inside the guest. That works only where there IS a
 * host mount, which is precisely what a device substrate must not have and a
 * remote builder does not have either. Artifacts now come back over the link's
 * `copyOut`, so every job collects the same way regardless of who provisioned
 * the box.
 *
 * @module
 */

import * as path from 'node:path';

import {
  envForTargetArch,
  repoRoot,
  resolveDefaultDaemonLinuxBinary,
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultGpodToolBinary,
  resolveDefaultPodkitBinary,
  resolveDefaultPodkitDebugBinary,
  resolveDefaultPodkitDebugMuslBinary,
  resolveDefaultPodkitMuslBinary,
  type BuildJobId,
  type BuildLibc,
  type TargetArch,
} from '@podkit/substrate';

/** What the driver knows by the time it renders a job's script. */
export interface BuildJobContext {
  /**
   * Architecture the artifacts are for.
   *
   * Per-*pass*, not per-run: a musl job runs once per architecture the run
   * needs (`required-arches.ts` in `@podkit/substrate`), so this is the one
   * value every path in a pass — staging directory, script, artifact
   * destinations — has to agree on. {@link BuildJob.artifacts} resolves its
   * host paths through {@link envForTargetArch} for exactly that reason.
   */
  readonly arch: TargetArch;
  /** Absolute staging directory on the build host. */
  readonly stageDir: string;
  /**
   * Absolute directory on the build host holding the static-dep closure and
   * the prebuild work tree.
   *
   * Outside {@link stageDir} on purpose: a stage is `rsync --delete`, and a
   * cold static-deps build is the expensive part of a build host's first run
   * while nothing in it changes between source revisions.
   */
  readonly cacheDir: string;
  /**
   * Whether the script will be run inside the build host's Alpine container
   * rather than in its own userland.
   *
   * The script itself barely cares — the difference is a userland, which is the
   * point — but the container runs as root with a different `$HOME`, so the
   * cache paths it is handed differ and it must not assume a `sudo` exists.
   */
  readonly containerised: boolean;
}

/** One artifact a job produces and the driver brings home. */
export type BuildArtifact =
  | {
      readonly kind: 'file';
      /** Path relative to the staging directory on the build host. */
      readonly guestRel: string;
      /** Absolute host path to write. */
      readonly hostPath: string;
      /** Short name for log lines and error messages. */
      readonly label: string;
      /**
       * Whether to assert the collected bytes are an ELF for {@link
       * BuildJobContext.arch}.
       *
       * Every executable artifact says yes. It is cheap, it reads the ELF
       * header rather than trusting the filename, and every failure mode in
       * this area produces a correctly-*named* file with the wrong bytes in
       * it. The one artifact that says no is the `.node` addon, which is an
       * ELF shared object the same check would accept anyway — it is collected
       * by directory, so there is no single declared path to attach the
       * assertion to.
       */
      readonly assertArch: boolean;
      /** Whether to make it executable on the host after collection. */
      readonly executable: boolean;
    }
  | {
      readonly kind: 'dir';
      /** Directory relative to the staging directory, whose files all come back. */
      readonly guestRel: string;
      /** Absolute host directory to write them into. */
      readonly hostDir: string;
      readonly label: string;
    };

/** Everything the driver needs to run one job. */
export interface BuildJob {
  readonly id: BuildJobId;
  /** The libc the artifacts link against — half of the build host's role. */
  readonly libc: BuildLibc;
  /** The turbo task this job is the body of, named in diagnostics. */
  readonly task: string;
  /**
   * Absolute host path of the tree to stage, given the repo root.
   *
   * Only the gpod-tool job narrows it. Its Makefile compiles a single `.c`
   * against apt's libgpod-1.0/glib-2.0 via pkg-config and reaches outside its
   * own directory for nothing a build needs, so staging the whole repo would
   * copy a gigabyte to run one `make`.
   */
  stageSrc(root: string): string;
  /**
   * Extra rsync excludes on top of the shared floor.
   *
   * `packages/libgpod-node/prebuilds` is the whole story here: the prebuild
   * jobs prune it because they are producing it and want a clean tree, and the
   * binary jobs must NOT, because `compile.sh` embeds the `.node` the prebuild
   * job just produced.
   */
  readonly stageExcludes?: readonly string[];
  /** The script to run in the staged tree, as `bash` sees it. */
  script(ctx: BuildJobContext): string;
  /** What to bring back afterwards. */
  artifacts(ctx: BuildJobContext): readonly BuildArtifact[];
}

/**
 * The preamble every job's script opens with.
 *
 * `/usr/local/bin` first and `$HOME/.bun/bin` second because the two families
 * of build host install bun differently and both are legitimate: a Lima
 * builder's provisioning puts it under the VM user's home, while
 * `provision-builder.sh` and the Alpine Containerfile put it in `/usr/local` so
 * it is on PATH for whichever user a build or a container runs as.
 */
function preamble(ctx: BuildJobContext, cacheSuffix: string): string {
  return [
    'set -euo pipefail',
    'export PATH="/usr/local/bin:$HOME/.bun/bin:$PATH"',
    `export STATIC_DEPS_DIR="${ctx.cacheDir}/static-deps${cacheSuffix}"`,
    `export WORK_DIR="${ctx.cacheDir}/prebuild-work${cacheSuffix}"`,
    'mkdir -p "$STATIC_DEPS_DIR" "$WORK_DIR"',
  ].join('\n');
}

/**
 * `bun install` as every job runs it.
 *
 * In-place on the build host rather than carried in from the host, so the
 * content-addressed `node_modules/.bun/node-gyp@<hash>` and node-addon-api
 * paths baked into a native build belong to the realm the compile happens in.
 * `--ignore-scripts` skips libgpod-node's postinstall: the native build is done
 * explicitly, by the prebuild job, and letting the postinstall race it is how a
 * tree ends up with two different `.node`s.
 */
const BUN_INSTALL = 'bun install --frozen-lockfile --ignore-scripts';

/**
 * The workspace `build` every binary job runs before `compile.sh`.
 *
 * Easy to leave out and it fails late and confusingly: `compile.sh` reports
 * `Could not resolve: "@podkit/ipod-firmware". Maybe you need to "bun install"?`
 * — which it does not. The filters drop the four workspaces a Linux binary
 * never contains and whose toolchains (Astro, Tauri, a browser bundler) a
 * builder is not required to satisfy.
 */
const TS_BUILD =
  'bunx turbo run build --filter=!@podkit/docs-site --filter=!@podkit/virtual-ipod-app ' +
  '--filter=!@podkit/ipod-web --filter=!@podkit/demo';

/**
 * The shared `compile.sh` + daemon block, identical for glibc and musl.
 *
 * `compile.sh` already selects the `${platform}-${arch}-musl` prebuild first
 * where one exists, and the daemon's own `bun run compile` needs no change
 * either — which is why the two binary jobs differ in their staging and their
 * output filenames and in nothing else.
 */
function compileBinaries(): string {
  return `
echo "==> building TS packages..."
${TS_BUILD}

echo "==> compiling podkit binary (production)..."
bash packages/podkit-cli/scripts/compile.sh

echo "==> verifying podkit binary..."
packages/podkit-cli/bin/podkit --version
ldd packages/podkit-cli/bin/podkit || true
if ldd packages/podkit-cli/bin/podkit 2>/dev/null | grep -E "libgpod|libgdk_pixbuf|libglib|libgobject|libgio|libgmodule|libffi|libplist|libxml2|libsqlite|libpcre2|libpng|libjpeg|libtiff"; then
  echo "ERROR: podkit binary has unexpected dynamic dependencies." >&2
  exit 1
fi

# Debug binary — same source, dev hooks active. Tests that need the
# devPause(key) primitive (see docs/architecture/dev-builds.md) opt into
# bin/podkit-debug via the e2e cli runner. The production binary above is
# unaffected: compile.sh's \`--define __PODKIT_DEV_HOOKS__=false\` tree-shakes
# the hook bodies away there.
echo "==> compiling podkit binary (debug)..."
PODKIT_DEV_HOOKS=1 bash packages/podkit-cli/scripts/compile.sh

echo "==> verifying podkit-debug binary..."
packages/podkit-cli/bin/podkit-debug --version

# Daemon binary — compiled here so its bundled koffi native assets are the
# correct Linux prebuild. A plain \`bun build --compile\` is correct: the daemon
# never reaches loadUsb at runtime (it shells out to the podkit CLI), so the usb
# bundler-plugin is deliberately NOT applied.
echo "==> compiling podkit-daemon binary..."
( cd packages/podkit-daemon && bun run compile )

echo "==> verifying podkit-daemon binary is a linux ELF..."
# Do NOT execute the daemon — it is a poller with no --version/--help fast-exit
# path and would hang. Inspect the ELF header only.
test -s packages/podkit-daemon/bin/podkit-daemon
file packages/podkit-daemon/bin/podkit-daemon
if ! file packages/podkit-daemon/bin/podkit-daemon | grep -q "ELF"; then
  echo "ERROR: podkit-daemon binary is not an ELF." >&2
  exit 1
fi
`.trim();
}

/** Where a prebuild job leaves its `.node`, relative to the staged tree. */
function prebuildDir(arch: TargetArch, libc: BuildLibc): string {
  return `packages/libgpod-node/prebuilds/linux-${arch}${libc === 'musl' ? '-musl' : ''}`;
}

const JOBS: readonly BuildJob[] = [
  {
    id: 'glibcPrebuild',
    libc: 'glibc',
    task: '@podkit/device-testing#build:linux-prebuild',
    stageSrc: (root) => root,
    stageExcludes: ['packages/libgpod-node/prebuilds'],
    script: (ctx) =>
      [
        preamble(ctx, ''),
        BUN_INSTALL,
        'bash tools/prebuild/build-linux-glibc.sh',
        `ls -l ${prebuildDir(ctx.arch, 'glibc')}`,
      ].join('\n'),
    artifacts: (ctx) => [
      {
        kind: 'dir',
        guestRel: prebuildDir(ctx.arch, 'glibc'),
        hostDir: path.resolve(repoRoot(), prebuildDir(ctx.arch, 'glibc')),
        label: 'libgpod-node glibc prebuild',
      },
    ],
  },
  {
    id: 'glibcBinary',
    libc: 'glibc',
    task: '@podkit/device-testing#build:linux-binary',
    stageSrc: (root) => root,
    // prebuilds/ is deliberately NOT excluded: the glibc `.node` the prebuild
    // job produced must ride along for compile.sh to embed it.
    script: (ctx) => [preamble(ctx, ''), BUN_INSTALL, compileBinaries()].join('\n'),
    artifacts: (ctx) => [
      {
        kind: 'file',
        guestRel: 'packages/podkit-cli/bin/podkit',
        hostPath: resolveDefaultPodkitBinary(envForTargetArch(ctx.arch)),
        label: 'podkit',
        assertArch: true,
        executable: true,
      },
      {
        kind: 'file',
        guestRel: 'packages/podkit-cli/bin/podkit-debug',
        hostPath: resolveDefaultPodkitDebugBinary(envForTargetArch(ctx.arch)),
        label: 'podkit-debug',
        assertArch: true,
        executable: true,
      },
      {
        kind: 'file',
        guestRel: 'packages/podkit-daemon/bin/podkit-daemon',
        hostPath: resolveDefaultDaemonLinuxBinary(envForTargetArch(ctx.arch)),
        label: 'podkit-daemon',
        assertArch: true,
        executable: true,
      },
    ],
  },
  {
    id: 'glibcGpodTool',
    libc: 'glibc',
    task: '@podkit/gpod-testing#build:linux-binary',
    stageSrc: (root) => path.join(root, 'tools', 'gpod-tool'),
    script: () =>
      [
        'set -euo pipefail',
        // `make clean` first: a host-built binary arriving with an mtime newer
        // than its source makes make report "Nothing to be done for 'all'" and
        // leaves the wrong architecture in place, which is a wrong result
        // rather than an error. The stage excludes it too — belt and braces,
        // because only one of the two survives someone editing the other.
        'make clean',
        'make',
        // Bare help is the only smoke available: gpod-tool has no --version,
        // and invoking it with no arguments prints usage to stderr and exits 1.
        './gpod-tool --help 2>&1 | head -1 || true',
        'ldd ./gpod-tool || true',
      ].join('\n'),
    artifacts: (ctx) => [
      {
        kind: 'file',
        guestRel: 'gpod-tool',
        hostPath: resolveDefaultGpodToolBinary(envForTargetArch(ctx.arch)),
        label: 'gpod-tool',
        assertArch: true,
        executable: true,
      },
    ],
  },
  {
    id: 'muslPrebuild',
    libc: 'musl',
    task: '@podkit/device-testing#build:musl-prebuild',
    stageSrc: (root) => root,
    stageExcludes: ['packages/libgpod-node/prebuilds'],
    script: (ctx) =>
      [
        preamble(ctx, '-musl'),
        BUN_INSTALL,
        'bash tools/prebuild/build-linux-musl.sh',
        `ls -l ${prebuildDir(ctx.arch, 'musl')}`,
      ].join('\n'),
    artifacts: (ctx) => [
      {
        kind: 'dir',
        guestRel: prebuildDir(ctx.arch, 'musl'),
        hostDir: path.resolve(repoRoot(), prebuildDir(ctx.arch, 'musl')),
        label: 'libgpod-node musl prebuild',
      },
    ],
  },
  {
    id: 'muslBinary',
    libc: 'musl',
    task: '@podkit/device-testing#build:musl-binary',
    stageSrc: (root) => root,
    script: (ctx) => [preamble(ctx, '-musl'), BUN_INSTALL, compileBinaries()].join('\n'),
    artifacts: (ctx) => [
      {
        kind: 'file',
        guestRel: 'packages/podkit-cli/bin/podkit',
        hostPath: resolveDefaultPodkitMuslBinary(envForTargetArch(ctx.arch)),
        label: 'podkit (musl)',
        assertArch: true,
        executable: true,
      },
      {
        kind: 'file',
        guestRel: 'packages/podkit-cli/bin/podkit-debug',
        hostPath: resolveDefaultPodkitDebugMuslBinary(envForTargetArch(ctx.arch)),
        label: 'podkit-debug (musl)',
        assertArch: true,
        executable: true,
      },
      {
        kind: 'file',
        guestRel: 'packages/podkit-daemon/bin/podkit-daemon',
        hostPath: resolveDefaultDaemonLinuxMuslBinary(envForTargetArch(ctx.arch)),
        label: 'podkit-daemon (musl)',
        assertArch: true,
        executable: true,
      },
    ],
  },
];

/** Where on the host one artifact lands, whichever kind it is. */
function artifactDest(artifact: BuildArtifact): string {
  return artifact.kind === 'file' ? artifact.hostPath : artifact.hostDir;
}

/**
 * Refuse a multi-architecture run whose passes would write to the same host
 * path.
 *
 * The architecture is in every default filename, so this holds by construction
 * — until a `PODKIT_LINUX_MUSL_BINARY`-style override names one absolute path,
 * which every resolver honours ahead of the architecture. Two passes then
 * collect into one file and the second silently overwrites the first, leaving
 * a correctly-named artifact of the wrong architecture at the path the loopback
 * surface reads. That is precisely the failure this whole area exists to make
 * impossible, so it is an error rather than a warning.
 *
 * Cheap and total: it compares the paths the job itself declares, so a future
 * artifact added without an architecture in its name is caught the first time
 * a cross-architecture run touches it.
 *
 * @throws {Error} naming the colliding path and both architectures.
 */
export function assertDistinctArtifactPaths(
  job: BuildJob,
  contexts: readonly BuildJobContext[]
): void {
  const claimedBy = new Map<string, TargetArch>();
  for (const ctx of contexts) {
    for (const artifact of job.artifacts(ctx)) {
      const dest = artifactDest(artifact);
      const owner = claimedBy.get(dest);
      if (owner !== undefined && owner !== ctx.arch) {
        throw new Error(
          `${job.task} must produce both linux-${owner} and linux-${ctx.arch} artifacts this ` +
            `run, but ${artifact.label} resolves to ${dest} for both. The second pass would ` +
            `overwrite the first and leave the wrong architecture under that name. Unset the ` +
            `PODKIT_*_BINARY override that pins it, or select a substrate of this host's ` +
            `architecture so only one set is needed.`
        );
      }
      claimedBy.set(dest, ctx.arch);
    }
  }
}

/** Every build job, in declaration order. */
export function listBuildJobs(): readonly BuildJob[] {
  return JOBS;
}

/**
 * Look a build job up by id. Throws with the known ids when nothing matches —
 * a mistyped id in a turbo task must fail loudly rather than build nothing and
 * report success.
 */
export function getBuildJob(id: string): BuildJob {
  const found = JOBS.find((job) => job.id === id);
  if (!found) {
    throw new Error(
      `getBuildJob: no build job registered for '${id}'. ` +
        `Known jobs: ${JOBS.map((job) => job.id).join(', ')}.`
    );
  }
  return found;
}

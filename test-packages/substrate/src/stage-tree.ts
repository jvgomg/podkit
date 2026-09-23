/**
 * Staging a source tree onto a substrate — the exclude floor and the rsync
 * command, in the one place both links can reach.
 *
 * ## Why this is not in `@podkit/lima` any more
 *
 * It used to be, and the reason it moved is the reason the registry and the
 * binary paths moved before it: *what* gets copied is a fact about this repo's
 * source tree, not about whoever provisioned the box receiving it. A remote
 * builder needs the identical exclude floor, and a second copy of that list is
 * exactly the drift the floor exists to prevent — the per-script copies it
 * replaced had already diverged, so one wrapper shipped host build
 * intermediates its sibling did not.
 *
 * ## Two forms of one command, and why the split is real
 *
 * The rsync *arguments* are shared. Where it runs is not:
 *
 * - **Lima** mounts the host's home directory into the guest, so the host
 *   source path is readable from inside. Staging is therefore an in-guest
 *   `rsync` from that mount to a guest-local directory, and nothing crosses
 *   the link except the command.
 * - **Every other substrate** has no host mount — and for a device substrate
 *   must not have one (ADR-028 §3). Staging is a host-side
 *   `rsync -e ssh src/ alias:dest/`, which pushes the bytes over the link
 *   itself.
 *
 * That is one genuine provisioner difference, which is why `stageTree` is a
 * method on {@link SubstrateLink} rather than a free function above it. Both
 * forms are built here so the excludes, the `--delete`, the `--omit-dir-times`
 * and the tolerated exit code cannot drift apart.
 *
 * @module
 */

import { shellQuote } from './link.js';

/**
 * The host artefacts that must never ride along into a staged source tree.
 *
 * Every caller that stages the repo shares this set; a caller that needs more
 * prunes passes them as `excludes`, which EXTEND (never replace) these.
 *
 * Each entry earns its place:
 *   - `node_modules` — host-arch native bindings plus Bun's content-addressed
 *     `.bun/node-gyp@<hash>` directories. Every build host reinstalls so the
 *     node-gyp paths baked into a build belong to the build host's realm.
 *   - `.turbo` — task hashes computed for the host arch mean nothing there.
 *   - `dist` — rebuilt on the build host.
 *   - `.git` — weight without value to a build.
 *   - `packages/libgpod-node/build` — node-gyp intermediates with absolute
 *     host paths baked into `*.d` dep files; reusing them produces
 *     stale-state link failures.
 *   - `packages/podkit-cli/bin`, `packages/podkit-daemon/bin`,
 *     `packages/demo/bin`, `tools/gpod-tool/gpod-tool` — host binaries that
 *     would shadow the ones the build host is about to produce. The last two
 *     are not cosmetic: a macOS `gpod-tool` arriving with an mtime newer than
 *     its source makes `make` report `Nothing to be done for 'all'` and leaves
 *     a Mach-O file on an amd64 builder, which is a wrong result rather than
 *     an error.
 *   - `packages/ipod-db/fixtures/databases` — large generated fixtures.
 *   - `graphify-out` — the host-local knowledge-graph output. Gitignored, read
 *     by no build, and the single largest thing in the tree (hundreds of MB),
 *     so it dominated the transfer window of every cold stage.
 *   - `tools/libgpod-macos/build` — macOS-only build output.
 *   - `*.bun-build`, `*.img` — transient artefacts; `*.bun-build` in particular
 *     is the file most likely to vanish mid-rsync (see the exit-24 tolerance).
 *   - `src-tauri/target` — Rust build output, large and host-specific.
 *
 * Deliberately NOT here: `packages/libgpod-node/prebuilds`. The prebuild jobs
 * exclude it (they are producing it and want a clean tree); the binary jobs
 * must carry it in so `compile.sh` can embed it. Callers state which they are.
 */
export const DEFAULT_STAGE_EXCLUDES: readonly string[] = [
  'node_modules',
  '.turbo',
  'dist',
  '.git',
  'packages/libgpod-node/build',
  'packages/podkit-cli/bin',
  'packages/podkit-daemon/bin',
  'packages/demo/bin',
  'packages/ipod-db/fixtures/databases',
  'graphify-out',
  'tools/libgpod-macos/build',
  'tools/gpod-tool/gpod-tool',
  '*.bun-build',
  '*.img',
  'src-tauri/target',
];

/**
 * The rsync exit code meaning "some files vanished before they could be
 * transferred". A benign race with host-side processes touching files during
 * the sync window (a `bun build --compile` dropping a `*.bun-build` temp file
 * is the classic offender), so every staging caller tolerates it — centralised
 * here rather than restated at each site.
 */
export const RSYNC_VANISHED_EXIT = 24;

/** What a caller can vary about a stage. */
export interface StageTreeOpts {
  /**
   * Extra rsync `--exclude` patterns, applied ON TOP OF
   * {@link DEFAULT_STAGE_EXCLUDES} rather than replacing them.
   */
  excludes?: readonly string[];
  /**
   * Write as root at the destination. Needed when the destination lives
   * outside the substrate user's home — `/opt` for the virtual iPod, and the
   * builder's `/var/tmp` staging root.
   */
  sudo?: boolean;
  /**
   * Host-side wall-clock bound in milliseconds. Omitted means "wait forever",
   * which is the right default here: a cold stage of this repo copies a
   * multi-gigabyte tree and its duration is set by how much the host has
   * changed since the last `--delete` sync — a figure nothing can predict and
   * a user can make arbitrarily large.
   */
  timeoutMs?: number;
}

/**
 * The rsync flags every stage carries, in both forms.
 *
 * `--omit-dir-times` is the one that looks optional and is not. A staging
 * directory created by the builder contract is root-owned and world-writable,
 * so an unprivileged `rsync -a` transfers the whole payload and then fails
 * with `failed to set times on "."` — exit 23, which is fatal here and must
 * stay fatal, because 23 otherwise means two writers in one destination.
 * Omitting directory times costs a build nothing: `make` and every other
 * incremental tool compare *file* mtimes, which `-a` still preserves.
 */
const RSYNC_BASE_FLAGS: readonly string[] = ['-a', '--delete', '--omit-dir-times'];

/** The full exclude list for a stage: the shared floor plus the caller's. */
export function stageExcludes(extra: readonly string[] = []): readonly string[] {
  return [...DEFAULT_STAGE_EXCLUDES, ...extra];
}

/**
 * rsync argv (without the source and destination) for a stage.
 *
 * Shared by both forms so a flag added for one link is added for both.
 */
export function rsyncStageArgs(opts: StageTreeOpts = {}): readonly string[] {
  return [
    ...RSYNC_BASE_FLAGS,
    ...stageExcludes(opts.excludes).flatMap((pattern) => ['--exclude', pattern]),
  ];
}

/**
 * The `/bin/sh` script that performs a stage **inside** a guest, from a
 * host-mounted source path to a guest-local destination.
 *
 * Trailing slashes matter: `src/` → the contents of src are copied INTO dest.
 *
 * `sh` here is the guest's `/bin/sh` — dash on Debian, busybox ash on Alpine —
 * so `set -o pipefail` is NOT available (dash rejects it outright). The script
 * contains no pipeline, so `set -u` alone is the portable equivalent.
 */
export function guestStageScript(
  hostSrc: string,
  guestDest: string,
  opts: StageTreeOpts = {}
): string {
  const maybeSudo = opts.sudo ? 'sudo ' : '';
  // Flags are rendered bare and only the values are quoted. Blanket-quoting
  // every word would be equally correct and reads as noise in a log line that
  // a human is expected to paste into a shell when a stage goes wrong.
  const flags = RSYNC_BASE_FLAGS.join(' ');
  const excludeArgs = stageExcludes(opts.excludes)
    .map((pattern) => `--exclude ${shellQuote(pattern)}`)
    .join(' ');
  return (
    `set -u; ` +
    `${maybeSudo}mkdir -p ${shellQuote(guestDest)}; ` +
    `${maybeSudo}rsync ${flags} ${excludeArgs} ` +
    `${shellQuote(`${hostSrc}/`)} ${shellQuote(`${guestDest}/`)}; ` +
    `rc=$?; if [ "$rc" -ne 0 ] && [ "$rc" -ne ${RSYNC_VANISHED_EXIT} ]; then exit "$rc"; fi`
  );
}

/**
 * Host-side `rsync` argv that pushes a tree to `<destSpec>` over an ssh
 * command line.
 *
 * `--rsync-path='sudo rsync'` is how the far end runs privileged: there is no
 * host-side `sudo` to apply, and wrapping the LOCAL rsync would ask for root
 * on the wrong machine.
 */
export function hostRsyncArgs(
  sshCommand: string,
  hostSrc: string,
  destSpec: string,
  opts: StageTreeOpts = {}
): readonly string[] {
  return [
    '-e',
    sshCommand,
    ...(opts.sudo ? ['--rsync-path', 'sudo rsync'] : []),
    ...rsyncStageArgs(opts),
    `${hostSrc}/`,
    `${destSpec}/`,
  ];
}

/**
 * Whether an rsync exit code means the stage succeeded.
 *
 * Exit {@link RSYNC_VANISHED_EXIT} is tolerated; everything else non-zero is
 * not. In particular exit 23 stays fatal — it is what two concurrent
 * `--delete` runs into one destination produce, and that leaves the
 * destination inconsistent rather than merely incomplete.
 */
export function stageExitIsOk(exitCode: number): boolean {
  return exitCode === 0 || exitCode === RSYNC_VANISHED_EXIT;
}

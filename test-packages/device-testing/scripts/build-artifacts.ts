#!/usr/bin/env bun
/**
 * The build driver — one body for every turbo task that produces a Linux
 * artifact.
 *
 * ```
 *   bun scripts/build-artifacts.ts <job-id>
 * ```
 *
 * ## What it replaced, and why that mattered
 *
 * Five shell wrappers, one per job, each ~150 lines and each opening the same
 * way: check for `limactl`, start a Lima instance, read `uname -m` out of it,
 * look up a staging directory, rsync, run a guest script, copy artifacts back.
 * Six steps written six times, differing only in the guest script.
 *
 * Every one of those six steps named `limactl`, which is why an amd64 substrate
 * could not be built for from an arm64 Mac: "use a different build host" meant
 * writing five more scripts. Here the six steps happen once, over a
 * {@link SubstrateLink}, and which box is on the other end is
 * {@link selectBuildHost}'s decision (ADR-029 §4). The per-job part — the guest
 * script and the artifact list — lives in `../src/build-jobs/jobs.ts`.
 *
 * ## One job, every architecture the run needs
 *
 * A job is not one build. `requiredArches()` answers which architectures this
 * run has to produce for the job's libc, and the driver makes a pass per
 * architecture — each selecting its own build host, because a build host
 * produces exactly one. That is one pass in every setup that has ever existed
 * and two for a musl job whose host and substrate differ, where the shipped
 * image is built twice: once inside the substrate and once on this machine's
 * Docker. See `required-arches.ts` in `@podkit/substrate`.
 *
 * ## The order of the checks is load-bearing
 *
 * 1. **Plan every pass** before touching anything — build-host selection for
 *    all of them, then the artifact paths they will write. A run that cannot
 *    be built for should say so in a second, not after a multi-gigabyte stage,
 *    and certainly not after the FIRST architecture has already compiled.
 * 2. **Probe the build host's real `uname -m`** and refuse a mismatch. The
 *    registry's declared `targetArch` and a Lima instance's host-derived one
 *    are both claims; this is the measurement. Every failure this guards
 *    against produces a correctly-*named* artifact with the wrong bytes in it.
 * 3. **Stage, build, collect.**
 * 4. **Assert each collected artifact's ELF header** before it lands at the
 *    path turbo will cache. A wrong-arch binary written to the cache-output
 *    path is a wrong binary every later run replays.
 *
 * @module
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  ArtifactArchMismatchError,
  BUILD_HOST_ENV_VAR,
  BUILDER_CONTRACT_REL_PATH,
  FILE_COPY_TIMEOUT_MS,
  guestCommandError,
  isLimaVm,
  isSshVm,
  probeSubstrateMachine,
  readElfTargetArch,
  repoRoot,
  requiredArches,
  selectBuildHost,
  selectSubstrate,
  shellContractValue,
  stagingDestForJob,
  normalizeTargetArch,
  type ArchRequirement,
  type BuildHostSelection,
  type SubstrateLink,
  type VmDefinition,
  type VmProvisioner,
} from '@podkit/substrate';
import { createVmProvisioningRunner, ensureRunning } from '@podkit/lima';

import { createSubstrateLink } from '../src/runners/substrate.js';
import {
  assertDistinctArtifactPaths,
  getBuildJob,
  type BuildArtifact,
  type BuildJob,
  type BuildJobContext,
} from '../src/build-jobs/jobs.js';

/**
 * Where the job's script is written inside the staged tree.
 *
 * A file rather than a `bash -c '…'` argument, and the reason is the
 * containerised path: that command is already `sudo podman run … bash -c '…'`,
 * and nesting a multi-hundred-line script through two levels of shell quoting
 * is a defect generator. A file has no quoting at all — and it leaves the exact
 * script that ran sitting on the build host for whoever has to debug it.
 */
const JOB_SCRIPT_NAME = '.podkit-build-job.sh';

const log = (message: string): void => void process.stderr.write(`[build] ${message}\n`);

/**
 * How the selected device substrate is provisioned, or `undefined` when there
 * is no substrate in play.
 *
 * Only the *provisioner* is wanted: it breaks the tie when two build hosts can
 * both produce what this run needs (see `build-host.ts`). The selection's
 * announcement is deliberately discarded — it is about which box the TESTS run
 * on, and printing "falling back to the Lima substrate" in the middle of a
 * build would attribute a decision to the wrong step. Whoever runs the suite
 * announces it there.
 */
function substrateProvisioner(): VmProvisioner | undefined {
  try {
    return selectSubstrate().substrate.provisioner;
  } catch {
    // An unconfigured machine with no Lima is a perfectly good build host for
    // a release artifact. Capability alone decides in that case.
    return undefined;
  }
}

/** Bring the build host up, as far as this repo is able to. */
async function ensureBuildHostReady(buildHost: VmDefinition, link: SubstrateLink): Promise<void> {
  if (isLimaVm(buildHost)) {
    // Create-or-start under the shared advisory lock. It must CREATE and not
    // merely start: turbo schedules the build jobs with no ordering edge
    // between some of them, so on a cold host any one of them may legitimately
    // be the first to need the instance.
    await ensureRunning(buildHost, {
      subprocess: createVmProvisioningRunner({ report: (line) => log(line) }),
    });
    return;
  }
  // Nothing in this repo can start an SSH build host yet — that is TASK-515's
  // pool-scoped API token. So the check is a probe, and the remedy is printed
  // rather than performed.
  const probe = await link.exec(['true'], { timeoutMs: 30_000 });
  if (probe.exitCode !== 0) {
    throw new Error(
      `build host '${buildHost.id}' answered ${probe.exitCode} to a trivial command over ` +
        `${link.description}. Check the alias resolves and the guest is up.`
    );
  }
}

/**
 * Refuse a build host that cannot produce what this run targets.
 *
 * The measurement behind two claims. A Lima builder's architecture is inferred
 * from the host that created it; an ssh builder's is declared in the registry.
 * Both are right until a machine is replaced, and neither is checked anywhere
 * else before a binary exists.
 */
async function assertBuildHostArch(
  selection: BuildHostSelection,
  link: SubstrateLink
): Promise<void> {
  const machine = await probeSubstrateMachine(link);
  const actual = normalizeTargetArch(machine, 'build host machine type');
  if (actual === selection.arch) return;
  throw new Error(
    `This pass targets linux-${selection.arch}, but build host '${selection.buildHost.id}' ` +
      `reports '${machine}' (${actual}). Building anyway would write ${actual} bytes under a ` +
      `linux-${selection.arch} name, which nothing downstream would notice. ` +
      `Point ${BUILD_HOST_ENV_VAR} at a ${selection.arch} build host, or correct the registry ` +
      `entry if this machine was replaced.`
  );
}

/**
 * The build-host-local directory holding the static-dep and prebuild caches.
 *
 * The Lima answer contains a literal `$HOME`, which is correct where the value
 * is only ever interpolated into a bash script and expanded there — and wrong
 * anywhere it is passed to something that does not run a shell. Only an ssh
 * build host is ever containerised, and its answer is an absolute path from
 * the contract, so the two never meet; {@link runJobScript} asserts that rather
 * than leaving it to hold by coincidence.
 */
function cacheDirFor(buildHost: VmDefinition): string {
  // An ssh build host's contract declares one and its doctor asserts it is
  // writable; a Lima builder has no contract, so its cache lives where every
  // other per-user cache on a Linux box does.
  return isSshVm(buildHost)
    ? shellContractValue(BUILDER_CONTRACT_REL_PATH, 'BUILDER_CACHE_DIR')
    : '$HOME/.cache/podkit-build';
}

/** Run the job's script on the build host, streaming its output as it goes. */
async function runJobScript(
  job: BuildJob,
  ctx: BuildJobContext,
  selection: BuildHostSelection,
  link: SubstrateLink
): Promise<void> {
  const scriptPath = path.join(ctx.stageDir, JOB_SCRIPT_NAME);
  const hostTemp = path.join(os.tmpdir(), `podkit-build-${job.id}-${process.pid}.sh`);
  fs.writeFileSync(hostTemp, `${job.script(ctx)}\n`, { mode: 0o755 });
  // Land in /tmp, then `sudo install` into place — not a direct `copyIn` to
  // the staging directory. A containerised job stages as root, and whether the
  // resulting tree is then writable by the build user depends on rsync's uid
  // mapping happening to line up between two machines. It does on the
  // reference builder and it is not something to depend on: /tmp is writable
  // on every box by definition, and `install` sets the mode explicitly rather
  // than inheriting whatever the host's umask produced.
  const stagedTemp = `/tmp/${path.basename(hostTemp)}`;
  try {
    await link.copyIn(hostTemp, stagedTemp, { timeoutMs: 60_000 });
  } finally {
    fs.rmSync(hostTemp, { force: true });
  }
  const installed = await link.exec(['sudo', 'install', '-m', '0755', stagedTemp, scriptPath], {
    timeoutMs: 60_000,
  });
  await link.exec(['rm', '-f', stagedTemp], { timeoutMs: 60_000 });
  if (installed.exitCode !== 0) {
    throw guestCommandError(`failed to install the job script at ${scriptPath}`, installed);
  }

  if (selection.containerised && ctx.cacheDir.includes('$')) {
    // A `-v` argument is not a shell word: `$HOME` would be mounted literally,
    // as a directory named `$HOME`, and the cache would silently be cold on
    // every run. See `cacheDirFor`.
    throw new Error(
      `build host '${selection.buildHost.id}' resolves its cache to '${ctx.cacheDir}', which ` +
        `contains a shell variable and cannot be a container mount. A containerised build host ` +
        `must declare an absolute cache directory.`
    );
  }

  const command = selection.containerised
    ? [
        'sudo',
        shellContractValue(BUILDER_CONTRACT_REL_PATH, 'BUILDER_CONTAINER_RUNTIME'),
        'run',
        '--rm',
        '-v',
        `${ctx.stageDir}:/src`,
        // The caches, at the SAME path inside the container as outside. Without
        // this the container is handed `cacheDir` by the job's preamble, finds
        // nothing there, rebuilds the whole static-dep closure, and `--rm`
        // throws it away — five minutes per musl run, every run, with nothing
        // reporting that anything was wasted. Same path on both sides so the
        // one value in `BuildJobContext.cacheDir` stays true wherever it is
        // read.
        '-v',
        `${ctx.cacheDir}:${ctx.cacheDir}`,
        '-w',
        '/src',
        shellContractValue(BUILDER_CONTRACT_REL_PATH, 'BUILDER_MUSL_IMAGE'),
        'bash',
        `/src/${JOB_SCRIPT_NAME}`,
      ]
    : ['bash', scriptPath];

  // `spawn`, not `exec`: these runs take minutes, and a buffered call would
  // print a compiler's entire output in one burst after the fact — or nothing
  // at all if it wedged. No wall-clock bound, for the same reason staging has
  // none: the duration is the compiler's, not the link's.
  const proc = link.spawn(command, { cwd: selection.containerised ? undefined : ctx.stageDir });
  proc.stdout?.on('data', (chunk: Buffer) => void process.stdout.write(chunk));
  proc.stderr?.on('data', (chunk: Buffer) => void process.stderr.write(chunk));
  const status = await proc.exited;
  if (status.exitCode !== 0) {
    throw new Error(
      `${job.task} failed on build host '${selection.buildHost.id}' ` +
        `(exit=${status.exitCode ?? `signal ${status.signal}`}). ` +
        `The script that ran is at ${link.description}'s ${scriptPath}.`
    );
  }
}

/**
 * Collect one artifact, checking its architecture before it lands where turbo
 * will cache it.
 *
 * The temp-then-rename is the whole point of the order. Writing straight to the
 * output path and validating afterwards leaves a wrong-arch binary at exactly
 * the path the next run's cache hit replays — the failure this task exists to
 * make impossible, re-created one step later.
 */
async function collectFile(
  artifact: Extract<BuildArtifact, { kind: 'file' }>,
  ctx: BuildJobContext,
  selection: BuildHostSelection,
  link: SubstrateLink
): Promise<void> {
  const guestPath = path.posix.join(ctx.stageDir, artifact.guestRel);
  fs.mkdirSync(path.dirname(artifact.hostPath), { recursive: true });
  // The temp name is DOT-PREFIXED, not suffixed. `<name>.incoming` would still
  // match the task's own `podkit-linux-*` output glob, so a run killed mid-copy
  // would strand a half-written file that the next successful run then cached
  // as an output — the wrong-artifact failure again, arriving through turbo.
  const temp = path.join(
    path.dirname(artifact.hostPath),
    `.podkit-incoming-${path.basename(artifact.hostPath)}`
  );
  fs.rmSync(temp, { force: true });
  await link.copyOut(guestPath, temp, { timeoutMs: FILE_COPY_TIMEOUT_MS });

  if (artifact.assertArch) {
    const actual = readElfTargetArch(fs.readFileSync(temp));
    if (actual !== selection.arch) {
      fs.rmSync(temp, { force: true });
      throw new ArtifactArchMismatchError(
        `${artifact.label} came off build host '${selection.buildHost.id}' as ` +
          `${actual === null ? 'something that is not a Linux ELF for a supported architecture' : `a linux-${actual} binary`}, ` +
          `but this run targets linux-${selection.arch}. Refusing to write ${artifact.hostPath} — ` +
          `installing it would produce 'exec format error' partway through a test run instead ` +
          `of here.`
      );
    }
  }

  fs.renameSync(temp, artifact.hostPath);
  if (artifact.executable) fs.chmodSync(artifact.hostPath, 0o755);
  log(`collected ${artifact.label} → ${path.relative(repoRoot(), artifact.hostPath)}`);
}

/**
 * Collect every file in a build-host directory.
 *
 * Used by the prebuild jobs, whose output is a `.node` whose exact filename is
 * `prebuildify`'s to choose. Listing it on the build host and copying what is
 * actually there beats encoding a naming convention that belongs to a
 * dependency.
 */
async function collectDir(
  artifact: Extract<BuildArtifact, { kind: 'dir' }>,
  ctx: BuildJobContext,
  link: SubstrateLink
): Promise<void> {
  const guestDir = path.posix.join(ctx.stageDir, artifact.guestRel);
  const listing = await link.exec(['ls', '-1', guestDir], { timeoutMs: 30_000 });
  const names = listing.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (listing.exitCode !== 0 || names.length === 0) {
    throw new Error(
      `${artifact.label} produced nothing at ${guestDir}: ` +
        `\`ls\` exited ${listing.exitCode}${listing.stderr.trim() ? ` (${listing.stderr.trim()})` : ''}.`
    );
  }
  fs.mkdirSync(artifact.hostDir, { recursive: true });
  for (const name of names) {
    const hostPath = path.join(artifact.hostDir, name);
    await link.copyOut(path.posix.join(guestDir, name), hostPath, {
      timeoutMs: FILE_COPY_TIMEOUT_MS,
    });
    log(`collected ${artifact.label} → ${path.relative(repoRoot(), hostPath)}`);
  }
}

/**
 * Everything one architecture's pass needs, resolved before any of them runs.
 *
 * Selection happens for EVERY required architecture up front, so a run that
 * has no build host for its second architecture says so in a second rather
 * than after the first one has finished compiling.
 */
interface BuildPass {
  readonly requirement: ArchRequirement;
  readonly selection: BuildHostSelection;
  readonly ctx: BuildJobContext;
}

/** Resolve one architecture's build host and job context. */
function planPass(
  job: BuildJob,
  requirement: ArchRequirement,
  provisioner: VmProvisioner | undefined
): BuildPass {
  const selection = selectBuildHost({
    libc: job.libc,
    arch: requirement.arch,
    substrateProvisioner: provisioner,
  });
  return {
    requirement,
    selection,
    ctx: {
      arch: selection.arch,
      stageDir: stagingDestForJob(selection.buildHost.id, job.id),
      cacheDir: cacheDirFor(selection.buildHost),
      containerised: selection.containerised,
    },
  };
}

/**
 * Stage, build and collect one architecture's artifacts.
 *
 * `position` is `{ index, total }` over the run's passes. It only ever reaches
 * a log line, and it is rendered here rather than by the caller so the one
 * place that decides a single-pass run says nothing extra is the place that
 * writes the line.
 */
async function runPass(
  job: BuildJob,
  pass: BuildPass,
  position: { readonly index: number; readonly total: number }
): Promise<void> {
  const ordinal = position.total > 1 ? ` [${position.index + 1}/${position.total}]` : '';
  const { ctx, selection } = pass;
  const { buildHost } = selection;
  // The announcement fires when the build host is not the selected substrate's
  // sibling — which is the NORMAL state of a second pass, whose whole job is to
  // build for this machine rather than for the substrate. Surfacing it there
  // would report the expected as an anomaly, and its remedy (pin
  // `PODKIT_BUILD_HOST`) is advice that would break the other pass. The
  // requirement's own reason, logged below, is the accurate line for that case.
  if (selection.announcement && pass.requirement.consumer === 'substrate') {
    log(selection.announcement);
  }

  const link = createSubstrateLink(buildHost, {
    subprocess: createVmProvisioningRunner({ report: (line) => log(line) }),
  });
  log(
    `${job.task}${ordinal}: building linux-${selection.arch} (${selection.libc}) on ` +
      `'${buildHost.id}' via ${link.description}` +
      (selection.containerised ? ' [Alpine container]' : '') +
      ` — ${pass.requirement.reason}`
  );

  await ensureBuildHostReady(buildHost, link);
  await assertBuildHostArch(selection, link);

  const stageSrc = job.stageSrc(repoRoot());
  log(`staging ${path.relative(repoRoot(), stageSrc) || '.'} → ${buildHost.id}:${ctx.stageDir}`);
  await link.stageTree(stageSrc, ctx.stageDir, {
    ...(job.stageExcludes ? { excludes: job.stageExcludes } : {}),
    // A containerised build runs as root and writes root-owned files into the
    // staged tree. Staging as root too is what keeps the NEXT run's
    // `rsync --delete` from hitting permission denied on the files the last one
    // left — a failure that only appears on the second build and reads like a
    // link problem.
    ...(selection.containerised ? { sudo: true } : {}),
  });

  await runJobScript(job, ctx, selection, link);

  for (const artifact of job.artifacts(ctx)) {
    if (artifact.kind === 'file') await collectFile(artifact, ctx, selection, link);
    else await collectDir(artifact, ctx, link);
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const jobId = argv[0];
  if (!jobId) {
    process.stderr.write('usage: build-artifacts.ts <job-id>\n');
    return 2;
  }

  const job = getBuildJob(jobId);
  // Every architecture this run needs, not just the one it targets. Only a
  // musl job ever gets two, and only when the host differs from the substrate
  // — see `required-arches.ts` in `@podkit/substrate`.
  const provisioner = substrateProvisioner();
  const passes = requiredArches(job.libc).map((requirement) =>
    planPass(job, requirement, provisioner)
  );
  assertDistinctArtifactPaths(
    job,
    passes.map((pass) => pass.ctx)
  );

  if (passes.length > 1) {
    log(
      `${job.task}: this run needs ${passes.length} architectures — ` +
        `${passes.map((pass) => `linux-${pass.ctx.arch} (${pass.requirement.consumer})`).join(', ')}.`
    );
  }

  for (const [index, pass] of passes.entries()) {
    await runPass(job, pass, { index, total: passes.length });
  }

  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`[build] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });

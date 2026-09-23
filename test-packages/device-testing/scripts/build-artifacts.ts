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
 * ## The order of the checks is load-bearing
 *
 * 1. **Select the build host** before touching anything. A run that cannot be
 *    built for should say so in a second, not after a multi-gigabyte stage.
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
  isLimaVm,
  isSshVm,
  probeSubstrateMachine,
  readElfTargetArch,
  repoRoot,
  selectBuildHost,
  selectSubstrate,
  shellContractValue,
  stagingDestForJob,
  normalizeTargetArch,
  type BuildHostSelection,
  type SubstrateLink,
  type VmDefinition,
  type VmProvisioner,
} from '@podkit/substrate';
import { createVmProvisioningRunner, ensureRunning } from '@podkit/lima';

import { createSubstrateLink } from '../src/runners/substrate.js';
import {
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
    `This run targets linux-${selection.arch}, but build host '${selection.buildHost.id}' ` +
      `reports '${machine}' (${actual}). Building anyway would write ${actual} bytes under a ` +
      `linux-${selection.arch} name, which nothing downstream would notice. ` +
      `Point ${BUILD_HOST_ENV_VAR} at a ${selection.arch} build host, or correct the registry ` +
      `entry if this machine was replaced.`
  );
}

/** The build-host-local directory holding the static-dep and prebuild caches. */
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
  try {
    await link.copyIn(hostTemp, scriptPath, { timeoutMs: 60_000 });
  } finally {
    fs.rmSync(hostTemp, { force: true });
  }

  const command = selection.containerised
    ? [
        'sudo',
        shellContractValue(BUILDER_CONTRACT_REL_PATH, 'BUILDER_CONTAINER_RUNTIME'),
        'run',
        '--rm',
        '-v',
        `${ctx.stageDir}:/src`,
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
  const temp = `${artifact.hostPath}.incoming`;
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
 * Bound for a single artifact transfer.
 *
 * The payload is one file and the largest is a compiled podkit binary — around
 * 120 MB. Sized off a throughput FLOOR of 1 MB/s rather than anything measured,
 * which is roughly two orders of magnitude below a healthy link and is what a
 * contended host deep in swap looks like. Past that it is a wedged session
 * rather than a slow copy. The same figure `@podkit/lima`'s transport uses, for
 * the same reason.
 */
const FILE_COPY_TIMEOUT_MS = 150_000;

async function main(argv: readonly string[]): Promise<number> {
  const jobId = argv[0];
  if (!jobId) {
    process.stderr.write('usage: build-artifacts.ts <job-id>\n');
    return 2;
  }

  const job = getBuildJob(jobId);
  const selection = selectBuildHost({
    libc: job.libc,
    substrateProvisioner: substrateProvisioner(),
  });
  if (selection.announcement) log(selection.announcement);

  const { buildHost } = selection;
  const link = createSubstrateLink(buildHost, {
    subprocess: createVmProvisioningRunner({ report: (line) => log(line) }),
  });
  log(
    `${job.task}: building linux-${selection.arch} (${selection.libc}) on ` +
      `'${buildHost.id}' via ${link.description}` +
      (selection.containerised ? ' [Alpine container]' : '')
  );

  await ensureBuildHostReady(buildHost, link);
  await assertBuildHostArch(selection, link);

  const ctx: BuildJobContext = {
    arch: selection.arch,
    stageDir: stagingDestForJob(buildHost.id, job.id),
    cacheDir: cacheDirFor(buildHost),
    containerised: selection.containerised,
  };

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

  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`[build] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });

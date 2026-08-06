/**
 * resolve-rc-build — classify the state of the release-candidate build so a
 * pre-release gate can decide whether to proceed, wait, or fail fast.
 *
 * The release-candidate build is the verification workflow triggered by the
 * open "Version Packages" PR (the changesets version bump). That workflow
 * ({@link WORKFLOW_FILE}) builds the full binary matrix and the Docker image
 * and pushes a moving `:rc` image tag. Before gating locally against those
 * assets we need to know: is there a candidate at all, is its build still
 * running, did it fail, or is it green and ready to fetch?
 *
 * This module is the **pure decision** layer. Every `gh` invocation goes
 * through an injected {@link SubprocessRunner} (the same DI seam the Lima
 * runners use), so the classification is unit-tested with scripted outputs and
 * performs no real subprocess, network, or filesystem work. The side-effecting
 * glue that acts on a `ready` state — downloading artefacts, assembling the
 * override environment, running the two-phase suite — lives elsewhere.
 *
 * @module
 */

import type { SubprocessRunner } from '../subprocess.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Classified state of the release-candidate build.
 *
 * - `no-version-pr` — no open "Version Packages" PR; there is nothing to gate.
 * - `build-in-progress` — the verification run is queued or running.
 * - `build-failed` — the verification run completed with a non-success
 *   conclusion (failure, cancelled, timed_out, …).
 * - `ready` — the verification run completed successfully; assets can be
 *   fetched. `prNumber` is the associated "Version Packages" PR number, or
 *   `null` when an explicit run-id override bypassed PR discovery (see
 *   {@link ResolveRcBuildOptions.runId}).
 */
export type RcBuildState =
  | { kind: 'no-version-pr' }
  | { kind: 'build-in-progress'; runId: number; url: string }
  | { kind: 'build-failed'; runId: number; url: string }
  | { kind: 'ready'; runId: number; prNumber: number | null };

/** Options for {@link resolveRcBuildState}. */
export interface ResolveRcBuildOptions {
  /** Injected command runner. Every `gh` call goes through this. */
  subprocess: SubprocessRunner;
  /**
   * Explicit verification-run id. When provided, PR/run discovery is skipped
   * entirely and this run is classified directly; a resulting `ready` state
   * carries `prNumber: null` because no PR is looked up.
   */
  runId?: number;
  /**
   * Block on a `build-in-progress` state, polling until the run completes and
   * re-classifying to `ready`/`build-failed`. Default `false` (fail fast:
   * return the non-ready state immediately). Only ever honoured for
   * `build-in-progress`; every other non-ready state is returned as-is.
   */
  wait?: boolean;
  /** Delay between polls when `wait` is set, in milliseconds. Default 5000. */
  pollIntervalMs?: number;
  /** Injectable delay used between polls. Default: a real `setTimeout` sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/** Thrown when a `gh` invocation fails or returns output we cannot parse. */
export class RcBuildDiscoveryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RcBuildDiscoveryError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The `gh` binary. */
const GH = 'gh';
/** Exact title of the changesets version-bump PR. */
export const VERSION_PR_TITLE = 'Version Packages';
/** Release-verification workflow file (as `gh run list --workflow` accepts). */
export const WORKFLOW_FILE = 'verify-release.yml';
/** Newest N verification runs to inspect for a branch. */
const RUN_LIST_LIMIT = 20;
/** Default poll interval when waiting on an in-progress build. */
const DEFAULT_POLL_INTERVAL_MS = 5000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// gh JSON shapes (only the fields we request)
// ---------------------------------------------------------------------------

interface VersionPr {
  number: number;
  title: string;
  headRefName: string;
}

interface WorkflowRun {
  databaseId: number;
  status: string;
  conclusion: string | null;
  url: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Resolve the release-candidate build state via injected `gh` calls.
 *
 * With no {@link ResolveRcBuildOptions.runId} override the flow is:
 *   1. find the open "Version Packages" PR (`no-version-pr` if none);
 *   2. find that PR's most recent verification run;
 *   3. classify the run.
 *
 * With a `runId` override, discovery is skipped and the given run is classified
 * directly.
 *
 * `wait` polls a `build-in-progress` state to completion; every other non-ready
 * state is returned immediately (fail fast).
 */
export async function resolveRcBuildState(options: ResolveRcBuildOptions): Promise<RcBuildState> {
  if (options.runId !== undefined) {
    const run = await viewRun(options.subprocess, options.runId);
    return classifyRun(run, null, options);
  }

  const pr = await findVersionPr(options.subprocess);
  if (!pr) {
    return { kind: 'no-version-pr' };
  }

  const run = await findLatestVerifyRun(options.subprocess, pr.headRefName);
  if (!run) {
    throw new RcBuildDiscoveryError(
      `Found the "${VERSION_PR_TITLE}" PR #${pr.number} (${pr.headRefName}) but no ` +
        `${WORKFLOW_FILE} run for it yet — the verification build has not started.`
    );
  }

  return classifyRun(run, pr.number, options);
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** The open PR titled exactly "Version Packages", or undefined if none. */
async function findVersionPr(subprocess: SubprocessRunner): Promise<VersionPr | undefined> {
  const stdout = await gh(subprocess, [
    'pr',
    'list',
    '--state',
    'open',
    '--search',
    `${VERSION_PR_TITLE} in:title`,
    '--json',
    'number,title,headRefName',
  ]);
  const prs = parseJson<VersionPr[]>(stdout, 'gh pr list', 'array');
  // `in:title` is a fuzzy search; require an exact title match. Assumes at
  // most one open "Version Packages" PR exists at a time; if several match,
  // the first one returned by `gh` wins.
  return prs.find((pr) => pr.title === VERSION_PR_TITLE);
}

/** The most recent verification run for a branch, or undefined if none. */
async function findLatestVerifyRun(
  subprocess: SubprocessRunner,
  branch: string
): Promise<WorkflowRun | undefined> {
  const stdout = await gh(subprocess, [
    'run',
    'list',
    '--workflow',
    WORKFLOW_FILE,
    '--branch',
    branch,
    '--json',
    'databaseId,status,conclusion,url,createdAt',
    '--limit',
    String(RUN_LIST_LIMIT),
  ]);
  const runs = parseJson<WorkflowRun[]>(stdout, 'gh run list', 'array');
  if (runs.length === 0) return undefined;
  // Do not trust list order — pick the newest by createdAt explicitly.
  return runs.reduce((newest, run) => (run.createdAt > newest.createdAt ? run : newest));
}

/** View a single run by id (the run-id-override and polling path). */
async function viewRun(subprocess: SubprocessRunner, runId: number): Promise<WorkflowRun> {
  const stdout = await gh(subprocess, [
    'run',
    'view',
    String(runId),
    '--json',
    'databaseId,status,conclusion,url,createdAt',
  ]);
  return parseJson<WorkflowRun>(stdout, 'gh run view', 'object');
}

// ---------------------------------------------------------------------------
// Classification + wait
// ---------------------------------------------------------------------------

const isCompleted = (run: WorkflowRun): boolean => run.status === 'completed';
const isSuccess = (run: WorkflowRun): boolean => run.conclusion === 'success';

/**
 * Map a run to a state. A completed run becomes `ready`/`build-failed`; an
 * incomplete run becomes `build-in-progress`, unless `wait` is set, in which
 * case it is polled to completion first.
 */
async function classifyRun(
  run: WorkflowRun,
  prNumber: number | null,
  options: ResolveRcBuildOptions
): Promise<RcBuildState> {
  if (isCompleted(run)) {
    return isSuccess(run)
      ? { kind: 'ready', runId: run.databaseId, prNumber }
      : { kind: 'build-failed', runId: run.databaseId, url: run.url };
  }

  if (!options.wait) {
    return { kind: 'build-in-progress', runId: run.databaseId, url: run.url };
  }

  return pollUntilComplete(run.databaseId, prNumber, options);
}

/** Poll a run until it completes, then classify it as ready/failed. */
async function pollUntilComplete(
  runId: number,
  prNumber: number | null,
  options: ResolveRcBuildOptions
): Promise<RcBuildState> {
  const sleep = options.sleep ?? defaultSleep;
  const intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  for (;;) {
    const run = await viewRun(options.subprocess, runId);
    if (isCompleted(run)) {
      return isSuccess(run)
        ? { kind: 'ready', runId: run.databaseId, prNumber }
        : { kind: 'build-failed', runId: run.databaseId, url: run.url };
    }
    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// gh + JSON helpers
// ---------------------------------------------------------------------------

/** Run `gh <args>`, returning stdout; throws a typed error on failure. */
async function gh(subprocess: SubprocessRunner, args: string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await subprocess.run(GH, args);
  if (exitCode !== 0) {
    throw new RcBuildDiscoveryError(
      `\`${GH} ${args.join(' ')}\` exited ${exitCode}: ${stderr.trim() || '(no stderr)'}`
    );
  }
  return stdout;
}

/**
 * Parse `gh --json` stdout; throws a typed error on malformed output or on a
 * parsed value whose top-level shape doesn't match what `source` promises
 * (an array where an array is expected, a non-null non-array object
 * otherwise). This is a shallow guard, not a schema validator — it only
 * rejects the obviously-wrong top-level shape.
 */
function parseJson<T>(stdout: string, source: string, shape: 'array' | 'object' = 'object'): T {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (cause) {
    throw new RcBuildDiscoveryError(`could not parse ${source} JSON output`, { cause });
  }

  const isValidShape =
    shape === 'array'
      ? Array.isArray(value)
      : typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!isValidShape) {
    throw new RcBuildDiscoveryError(
      `${source} JSON output had an unexpected shape: expected ${shape === 'array' ? 'an array' : 'an object'}, got ${value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value}`
    );
  }

  return value as T;
}

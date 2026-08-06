/**
 * Unit tests for the release-candidate build classifier.
 *
 * Strategy mirrors the scripted-`SubprocessRunner` runner tests
 * (`lima-docker-image.test.ts`, `lima-test-vm-systemd.test.ts`): inject a
 * runner that returns canned `gh` responses in order and records every call,
 * so the classification is asserted with no real `gh`, no network, and no real
 * subprocess. Each scenario reads as a small `gh` transcript.
 */

import { describe, it, expect } from 'bun:test';

import {
  resolveRcBuildState,
  RcBuildDiscoveryError,
  VERSION_PR_TITLE,
  WORKFLOW_FILE,
} from './resolve-rc-build.js';
import type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult } from '../subprocess.js';

// ---------------------------------------------------------------------------
// Scripted SubprocessRunner
// ---------------------------------------------------------------------------

interface ScriptedCall {
  command: string;
  args: string[];
  opts?: SubprocessRunOpts;
}

type Responder = SubprocessRunResult | ((call: ScriptedCall) => SubprocessRunResult);

function makeScriptedRunner(script: Responder[]): {
  runner: SubprocessRunner;
  calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  let i = 0;
  return {
    calls,
    runner: {
      async run(command, args, opts) {
        const call: ScriptedCall = { command, args, opts };
        calls.push(call);
        const responder = script[i++];
        if (responder === undefined) {
          throw new Error(`scripted runner exhausted at call ${i}: ${command} ${args.join(' ')}`);
        }
        return typeof responder === 'function' ? responder(call) : responder;
      },
    },
  };
}

/** A JSON stdout response with a zero exit code — the shape `gh --json` gives. */
const json = (value: unknown): SubprocessRunResult => ({
  stdout: JSON.stringify(value),
  stderr: '',
  exitCode: 0,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HEAD_REF = 'changeset-release/main';

const versionPr = {
  number: 42,
  title: VERSION_PR_TITLE,
  headRefName: HEAD_REF,
};

const run = (
  overrides: Partial<{
    databaseId: number;
    status: string;
    conclusion: string | null;
    url: string;
    createdAt: string;
  }>
) => ({
  databaseId: 1001,
  status: 'completed',
  conclusion: 'success',
  url: 'https://github.com/jvgomg/podkit/actions/runs/1001',
  createdAt: '2026-08-06T12:00:00Z',
  ...overrides,
});

/** Which `gh` subcommand a recorded call represents (`args[0] args[1]`). */
const subcommand = (call: ScriptedCall): string => `${call.args[0]} ${call.args[1]}`;

// ---------------------------------------------------------------------------
// Discovery-driven states
// ---------------------------------------------------------------------------

describe('resolveRcBuildState — discovery', () => {
  it('returns no-version-pr when no open "Version Packages" PR exists', async () => {
    const { runner, calls } = makeScriptedRunner([json([])]);

    const state = await resolveRcBuildState({ subprocess: runner });

    expect(state).toEqual({ kind: 'no-version-pr' });
    // Only the PR search runs; with no PR there is no branch to list runs for.
    expect(calls).toHaveLength(1);
    expect(subcommand(calls[0]!)).toBe('pr list');
  });

  it('ignores fuzzy PR matches whose title is not exactly "Version Packages"', async () => {
    const { runner } = makeScriptedRunner([
      json([{ number: 7, title: 'Revert Version Packages bump', headRefName: 'other' }]),
    ]);

    const state = await resolveRcBuildState({ subprocess: runner });

    expect(state).toEqual({ kind: 'no-version-pr' });
  });

  it('classifies a queued/running verification run as build-in-progress', async () => {
    const inProgress = run({ databaseId: 555, status: 'in_progress', conclusion: null });
    const { runner, calls } = makeScriptedRunner([json([versionPr]), json([inProgress])]);

    const state = await resolveRcBuildState({ subprocess: runner });

    expect(state).toEqual({ kind: 'build-in-progress', runId: 555, url: inProgress.url });
    // Fail-fast default: the run is inspected once, not polled.
    expect(calls.map(subcommand)).toEqual(['pr list', 'run list']);
  });

  it('classifies a completed non-success run as build-failed', async () => {
    const failed = run({ databaseId: 777, status: 'completed', conclusion: 'failure' });
    const { runner } = makeScriptedRunner([json([versionPr]), json([failed])]);

    const state = await resolveRcBuildState({ subprocess: runner });

    expect(state).toEqual({ kind: 'build-failed', runId: 777, url: failed.url });
  });

  it('classifies a completed successful run as ready with the PR number', async () => {
    const success = run({ databaseId: 999, status: 'completed', conclusion: 'success' });
    const { runner, calls } = makeScriptedRunner([json([versionPr]), json([success])]);

    const state = await resolveRcBuildState({ subprocess: runner });

    expect(state).toEqual({ kind: 'ready', runId: 999, prNumber: 42 });
    // The run list is scoped to the workflow file and the PR's head branch.
    const runList = calls[1]!;
    expect(runList.args).toContain(WORKFLOW_FILE);
    expect(runList.args).toContain(HEAD_REF);
  });

  it('selects the most recent run by createdAt regardless of list order', async () => {
    const older = run({ databaseId: 100, createdAt: '2026-08-01T00:00:00Z' });
    const newest = run({
      databaseId: 200,
      createdAt: '2026-08-06T00:00:00Z',
      conclusion: 'failure',
      url: 'https://github.com/jvgomg/podkit/actions/runs/200',
    });
    const middle = run({ databaseId: 150, createdAt: '2026-08-03T00:00:00Z' });
    // Deliberately unsorted so `resolveRcBuildState` cannot rely on order.
    const { runner } = makeScriptedRunner([json([versionPr]), json([older, newest, middle])]);

    const state = await resolveRcBuildState({ subprocess: runner });

    expect(state).toEqual({ kind: 'build-failed', runId: 200, url: newest.url });
  });
});

// ---------------------------------------------------------------------------
// --wait branch
// ---------------------------------------------------------------------------

describe('resolveRcBuildState — wait', () => {
  it('polls an in-progress build to completion and resolves ready', async () => {
    const running = run({ databaseId: 321, status: 'in_progress', conclusion: null });
    const done = run({ databaseId: 321, status: 'completed', conclusion: 'success' });
    // pr list → run list (running) → run view (running) → run view (success)
    const { runner, calls } = makeScriptedRunner([
      json([versionPr]),
      json([running]),
      json(running),
      json(done),
    ]);

    const sleeps: number[] = [];
    const state = await resolveRcBuildState({
      subprocess: runner,
      wait: true,
      pollIntervalMs: 1234,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(state).toEqual({ kind: 'ready', runId: 321, prNumber: 42 });
    // Polling views the run by id until it completes.
    expect(calls.map(subcommand)).toEqual(['pr list', 'run list', 'run view', 'run view']);
    // Slept once between the two in-progress observations, using the injected delay.
    expect(sleeps).toEqual([1234]);
  });

  it('resolves build-failed when a waited-on build ends red', async () => {
    const running = run({ databaseId: 400, status: 'in_progress', conclusion: null });
    const red = run({
      databaseId: 400,
      status: 'completed',
      conclusion: 'failure',
      url: 'https://github.com/jvgomg/podkit/actions/runs/400',
    });
    const { runner } = makeScriptedRunner([json([versionPr]), json([running]), json(red)]);

    const state = await resolveRcBuildState({
      subprocess: runner,
      wait: true,
      sleep: async () => {},
    });

    expect(state).toEqual({ kind: 'build-failed', runId: 400, url: red.url });
  });
});

// ---------------------------------------------------------------------------
// Explicit run-id override
// ---------------------------------------------------------------------------

describe('resolveRcBuildState — run-id override', () => {
  it('bypasses discovery and views the given run directly', async () => {
    const success = run({ databaseId: 8080, status: 'completed', conclusion: 'success' });
    const { runner, calls } = makeScriptedRunner([json(success)]);

    const state = await resolveRcBuildState({ subprocess: runner, runId: 8080 });

    // No PR to associate → prNumber is null on the override path.
    expect(state).toEqual({ kind: 'ready', runId: 8080, prNumber: null });
    // Discovery is skipped entirely: only `gh run view <id>` is invoked.
    expect(calls).toHaveLength(1);
    expect(calls.map(subcommand)).toEqual(['run view']);
    expect(calls.some((c) => subcommand(c) === 'pr list')).toBe(false);
    expect(calls.some((c) => subcommand(c) === 'run list')).toBe(false);
    expect(calls[0]!.args).toContain('8080');
  });

  it('classifies an in-progress overridden run without polling by default', async () => {
    const running = run({ databaseId: 8081, status: 'queued', conclusion: null });
    const { runner, calls } = makeScriptedRunner([json(running)]);

    const state = await resolveRcBuildState({ subprocess: runner, runId: 8081 });

    expect(state).toEqual({ kind: 'build-in-progress', runId: 8081, url: running.url });
    expect(calls).toHaveLength(1);
  });

  it('classifies an overridden run that completed with failure as build-failed', async () => {
    // Confirms the override path shares the same classifyRun logic as discovery.
    const failed = run({
      databaseId: 8082,
      status: 'completed',
      conclusion: 'failure',
      url: 'https://github.com/jvgomg/podkit/actions/runs/8082',
    });
    const { runner, calls } = makeScriptedRunner([json(failed)]);

    const state = await resolveRcBuildState({ subprocess: runner, runId: 8082 });

    expect(state).toEqual({ kind: 'build-failed', runId: 8082, url: failed.url });
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('resolveRcBuildState — error paths', () => {
  it('rejects with RcBuildDiscoveryError when a gh invocation exits non-zero', async () => {
    const { runner } = makeScriptedRunner([
      { stdout: '', stderr: 'authentication required', exitCode: 4 },
    ]);

    let caught: unknown;
    try {
      await resolveRcBuildState({ subprocess: runner });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RcBuildDiscoveryError);
    const message = (caught as Error).message;
    expect(message).toContain('4');
    expect(message).toContain('authentication required');
  });

  it('rejects with RcBuildDiscoveryError when gh stdout is not valid JSON', async () => {
    const { runner } = makeScriptedRunner([{ stdout: 'not json', stderr: '', exitCode: 0 }]);

    await expect(resolveRcBuildState({ subprocess: runner })).rejects.toThrow(
      RcBuildDiscoveryError
    );
  });

  it('rejects with RcBuildDiscoveryError when the PR is found but has no verification run yet', async () => {
    const { runner } = makeScriptedRunner([json([versionPr]), json([])]);

    await expect(resolveRcBuildState({ subprocess: runner })).rejects.toThrow(
      RcBuildDiscoveryError
    );
  });

  it('rejects with RcBuildDiscoveryError when gh returns a JSON value of the wrong shape', async () => {
    // `gh run view` should yield an object; a `null` payload is valid JSON but
    // the wrong top-level shape.
    const { runner } = makeScriptedRunner([{ stdout: 'null', stderr: '', exitCode: 0 }]);

    await expect(resolveRcBuildState({ subprocess: runner, runId: 9090 })).rejects.toThrow(
      RcBuildDiscoveryError
    );
  });
});

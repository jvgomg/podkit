#!/usr/bin/env bun
/**
 * Runs `bun test` and fails loudly if the run executed fewer than the
 * expected minimum number of tests — even when `bun test` itself exits 0.
 *
 * # Why this exists
 *
 * A `[test].preload` script that calls `process.exit()` unconditionally
 * aborts the whole `bun test` process *during preload*, before a single
 * test file loads. Bun's own pass/fail accounting never runs in that case,
 * so nothing about bun's exit code or its "N pass / 0 fail" summary can
 * distinguish "ran everything, all green" from "ran nothing, reported
 * green anyway". `--pass-with-no-tests` doesn't help either — it only
 * governs bun's own behaviour when a file *pattern* matches zero files; it
 * has no visibility into a preload that terminated the process outright.
 *
 * This has already happened once: `@podkit/device-testing`'s Lima-VM
 * preflight (`src/preflight.ts`) called `process.exit(0)` whenever VM tests
 * weren't targeted, which silently voided every unit test in this package
 * under `test:unit` — `bunx turbo run @podkit/device-testing#test:unit`
 * reported success having executed zero tests, for an unknown period.
 *
 * This wrapper is the guard against that recurring: it parses bun's own
 * "Ran N tests across M files" summary line out of the captured output and
 * treats a count below the minimum as a hard failure, regardless of the
 * exit code bun itself produced. If a future change reintroduces an early
 * exit (in this preload or a new one), this trips even though bun reports
 * a clean pass.
 *
 * # Usage
 *
 * ```sh
 * assert-min-tests [...bun test args]
 * MIN_TEST_COUNT=5 assert-min-tests --pass-with-no-tests
 * ```
 *
 * `MIN_TEST_COUNT` defaults to 1 — any package wired through this guard is
 * expected to execute at least one real test under the invocation it wraps.
 *
 * @module
 */

import { spawn } from 'node:child_process';

const MIN_TEST_COUNT = Number(process.env.MIN_TEST_COUNT ?? '1');
const args = process.argv.slice(2);

const child = spawn('bun', ['test', ...args], {
  stdio: ['inherit', 'pipe', 'pipe'],
});

let captured = '';

child.stdout.on('data', (chunk: Buffer) => {
  process.stdout.write(chunk);
  captured += chunk.toString('utf8');
});
child.stderr.on('data', (chunk: Buffer) => {
  process.stderr.write(chunk);
  captured += chunk.toString('utf8');
});

child.on('error', (err) => {
  console.error(`[assert-min-tests] failed to spawn \`bun test\`: ${String(err)}`);
  process.exit(1);
});

child.on('close', (bunExitCode) => {
  const summary = captured.match(/Ran (\d+) tests? across (\d+) files?/);
  const ranCount = summary ? Number(summary[1]) : 0;

  if (ranCount < MIN_TEST_COUNT) {
    process.stderr.write(
      '\n[assert-min-tests] ' +
        (summary
          ? `Only ${ranCount} test(s) executed (bun exited ${bunExitCode}).`
          : `No "Ran N tests" summary line found in \`bun test\` output (bun exited ${bunExitCode}).`) +
        ` Expected at least ${MIN_TEST_COUNT}.\n` +
        '[assert-min-tests] A clean bun exit code with a near-zero test count usually means something ' +
        'terminated the process before any test file loaded — most likely a `[test].preload` script ' +
        'calling `process.exit()` unconditionally. Fix the preload to fall through instead of exiting; ' +
        'do not raise MIN_TEST_COUNT to paper over a shrinking count.\n'
    );
    process.exit(1);
  }

  process.exit(bunExitCode ?? 1);
});

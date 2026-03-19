#!/usr/bin/env bun
/**
 * Parallel E2E test runner.
 *
 * Runs E2E test files concurrently (N at a time) to reduce wall-clock time.
 * Each test file runs in its own `bun test` subprocess with full isolation.
 *
 * Usage:
 *   bun run src/scripts/run-parallel.ts                    # Run all E2E tests, 4 at a time
 *   bun run src/scripts/run-parallel.ts --concurrency 2    # Run 2 at a time
 *   bun run src/scripts/run-parallel.ts --bail              # Stop on first failure
 *   bun run src/scripts/run-parallel.ts src/commands/       # Run tests matching a path
 *
 * Environment:
 *   E2E_CONCURRENCY=N    Alternative way to set concurrency (flag takes precedence)
 */

import { spawn } from 'node:child_process';
import { glob } from 'node:fs';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let concurrency = parseInt(process.env.E2E_CONCURRENCY ?? '4', 10);
let bail = false;
const pathFilters: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === '--concurrency' && args[i + 1]) {
    concurrency = parseInt(args[i + 1]!, 10);
    i++;
  } else if (arg === '--bail') {
    bail = true;
  } else if (!arg.startsWith('--')) {
    pathFilters.push(arg);
  }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

async function findTestFiles(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const pattern = 'src/**/*.e2e.test.ts';
    glob(pattern, (err, matches) => {
      if (err) return reject(err);
      let results = matches.sort();
      if (pathFilters.length > 0) {
        results = results.filter((f) => pathFilters.some((p) => f.includes(p)));
      }
      resolve(results);
    });
  });
}

// ---------------------------------------------------------------------------
// Test execution
// ---------------------------------------------------------------------------

interface TestResult {
  file: string;
  exitCode: number;
  duration: number;
  output: string;
}

function runTestFile(file: string): Promise<TestResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let output = '';

    const proc = spawn('bun', ['test', file], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: process.cwd(),
    });

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        file,
        exitCode: code ?? 1,
        duration: Date.now() - start,
        output,
      });
    });

    proc.on('error', () => {
      resolve({
        file,
        exitCode: 1,
        duration: Date.now() - start,
        output: output || 'Failed to spawn process',
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Concurrency-limited runner
// ---------------------------------------------------------------------------

async function runAll(files: string[]): Promise<TestResult[]> {
  const results: TestResult[] = [];
  let aborted = false;
  let activeCount = 0;
  let nextIndex = 0;

  return new Promise((resolve) => {
    function tryStartNext() {
      while (activeCount < concurrency && nextIndex < files.length && !aborted) {
        const file = files[nextIndex++]!;
        activeCount++;

        const shortName = file.replace(/^src\//, '').replace(/\.e2e\.test\.ts$/, '');
        process.stdout.write(`  ▶ ${shortName}\n`);

        runTestFile(file).then((result) => {
          activeCount--;
          results.push(result);

          const status = result.exitCode === 0 ? '✓' : '✗';
          const duration = (result.duration / 1000).toFixed(1);
          const resultName = result.file.replace(/^src\//, '').replace(/\.e2e\.test\.ts$/, '');
          process.stdout.write(`  ${status} ${resultName} (${duration}s)\n`);

          if (bail && result.exitCode !== 0) {
            aborted = true;
          }

          if (results.length === files.length || (aborted && activeCount === 0)) {
            resolve(results);
          } else {
            tryStartNext();
          }
        });
      }

      // All done or aborted with no active tasks
      if (nextIndex >= files.length && activeCount === 0) {
        resolve(results);
      }
    }

    tryStartNext();
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const files = await findTestFiles();

  if (files.length === 0) {
    console.log('No test files found.');
    process.exit(0);
  }

  console.log(`Running ${files.length} test files (concurrency: ${concurrency})\n`);
  const startTime = Date.now();

  const results = await runAll(files);

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const passed = results.filter((r) => r.exitCode === 0);
  const failed = results.filter((r) => r.exitCode !== 0);

  // Print failures with their output
  if (failed.length > 0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Failures:\n`);
    for (const result of failed) {
      console.log(`── ${result.file} ──`);
      console.log(result.output);
      console.log('');
    }
  }

  // Summary
  console.log(`${'─'.repeat(60)}`);
  console.log(`${passed.length} passed, ${failed.length} failed (${totalDuration}s wall-clock)`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});

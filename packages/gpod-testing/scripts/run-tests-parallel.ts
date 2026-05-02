#!/usr/bin/env bun
/**
 * File-level parallel test runner.
 *
 * Spawns one `bun test` subprocess per matching test file, up to N at a time.
 * Each file gets full process isolation, so libgpod-node's non-thread-safe
 * native binding state doesn't collide between concurrent tests.
 *
 * Output is buffered per file and printed batched once each file finishes,
 * so summaries stay readable even with N processes interleaving stdout.
 *
 * Usage (from a package directory):
 *   bun run /path/to/run-tests-parallel.ts \
 *       --pattern '*.integration.test.ts' \
 *       --concurrency 8
 *
 * Defaults: pattern = '*.integration.test.ts' under src/, concurrency = 8.
 *
 * Exit code: 0 if every file passed, 1 if any failed.
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

type Args = {
  pattern: string;
  concurrency: number;
  timeout: number;
  bail: boolean;
  root: string;
  pathFilters: string[];
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = {
    pattern: '*.integration.test.ts',
    concurrency: parseInt(process.env.TEST_CONCURRENCY ?? '8', 10),
    timeout: parseInt(process.env.TEST_TIMEOUT ?? '30000', 10),
    bail: false,
    root: 'src',
    pathFilters: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--pattern' && argv[i + 1]) out.pattern = argv[++i]!;
    else if (a === '--concurrency' && argv[i + 1]) out.concurrency = parseInt(argv[++i]!, 10);
    else if (a === '--timeout' && argv[i + 1]) out.timeout = parseInt(argv[++i]!, 10);
    else if (a === '--root' && argv[i + 1]) out.root = argv[++i]!;
    else if (a === '--bail') out.bail = true;
    else if (!a.startsWith('--')) out.pathFilters.push(a);
  }
  return out;
}

function walk(dir: string, suffix: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, suffix, acc);
    else if (name.endsWith(suffix)) acc.push(path);
  }
  return acc;
}

interface TestResult {
  file: string;
  exitCode: number;
  duration: number;
  output: string;
}

function runFile(file: string, timeout: number): Promise<TestResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let output = '';
    // Prefix with `./` so bun treats the arg as a file path (not a substring
    // filter) and override bunfig's pathIgnorePatterns so integration files
    // aren't excluded.
    const filePath = file.startsWith('./') || file.startsWith('/') ? file : `./${file}`;
    const proc = spawn(
      'bun',
      ['test', '--timeout', String(timeout), '--path-ignore-patterns=', filePath],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      }
    );
    proc.stdout.on('data', (d) => (output += d.toString()));
    proc.stderr.on('data', (d) => (output += d.toString()));
    proc.on('close', (code) => {
      resolve({ file, exitCode: code ?? 1, duration: Date.now() - start, output });
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

async function runAll(files: string[], args: Args): Promise<TestResult[]> {
  const results: TestResult[] = [];
  let aborted = false;
  let active = 0;
  let next = 0;

  return new Promise((resolve) => {
    const tryNext = () => {
      while (active < args.concurrency && next < files.length && !aborted) {
        const file = files[next++]!;
        active++;
        const short = relative(process.cwd(), file);
        process.stdout.write(`  ▶ ${short}\n`);
        runFile(file, args.timeout).then((result) => {
          active--;
          results.push(result);
          const status = result.exitCode === 0 ? '✓' : '✗';
          const dur = (result.duration / 1000).toFixed(1);
          process.stdout.write(`  ${status} ${short} (${dur}s)\n`);
          if (args.bail && result.exitCode !== 0) aborted = true;
          if (results.length === files.length || (aborted && active === 0)) resolve(results);
          else tryNext();
        });
      }
      if (next >= files.length && active === 0) resolve(results);
    };
    tryNext();
  });
}

async function main() {
  const args = parseArgs();
  const suffix = args.pattern.replace(/^\*/, '');
  let files = walk(args.root, suffix).sort();
  if (args.pathFilters.length > 0) {
    files = files.filter((f) => args.pathFilters.some((p) => f.includes(p)));
  }
  if (files.length === 0) {
    console.log(`No test files matching '${args.pattern}' under ${args.root}/.`);
    process.exit(0);
  }

  console.log(`Running ${files.length} test files (concurrency: ${args.concurrency})\n`);
  const t0 = Date.now();
  const results = await runAll(files, args);
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  const failed = results.filter((r) => r.exitCode !== 0);

  if (failed.length > 0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log('Failures:\n');
    for (const r of failed) {
      console.log(`── ${r.file} ──`);
      console.log(r.output);
      console.log('');
    }
  }

  console.log(`${'─'.repeat(60)}`);
  console.log(
    `${results.length - failed.length} passed, ${failed.length} failed (${wall}s wall-clock)`
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});

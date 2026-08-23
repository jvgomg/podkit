/**
 * Child-process worker for the advisory-lock integration test. Not a test file
 * itself — it is spawned by `lock.integration.test.ts` as a separate OS process
 * so the lock's cross-process mutual exclusion can be exercised for real.
 *
 * argv: <mode> <lockDir> <instance> [outFile]
 *   hold     acquire and hold forever (announce ACQUIRED, then block so the
 *            parent can SIGKILL us to test stale reclaim).
 *   contend  acquire (waiting out any current holder), record a START/END
 *            window to outFile with a short hold, then release.
 *   nowait   attempt a zero-retry acquire; exit 3 on ELOCKED, 0 if acquired.
 *
 * @module
 */

import * as fs from 'node:fs';
import { acquireVmLock } from './lock.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const mode = process.argv[2];
  const lockDir = process.argv[3];
  const instance = process.argv[4];
  const outFile = process.argv[5];

  if (!mode || !lockDir || !instance) {
    process.stderr.write('usage: worker <mode> <lockDir> <instance> [outFile]\n');
    process.exit(9);
  }

  if (mode === 'hold') {
    await acquireVmLock(instance, { lockDir, staleMs: 5000, updateMs: 1000, retries: 0 });
    process.stdout.write('ACQUIRED\n');
    await sleep(60_000);
    return;
  }

  if (mode === 'contend') {
    if (!outFile) {
      process.stderr.write('contend mode requires an outFile\n');
      process.exit(9);
    }
    const release = await acquireVmLock(instance, { lockDir, staleMs: 5000, retries: 100 });
    fs.appendFileSync(outFile, `START ${process.pid} ${Date.now()}\n`);
    await sleep(400);
    fs.appendFileSync(outFile, `END ${process.pid} ${Date.now()}\n`);
    await release();
    return;
  }

  if (mode === 'nowait') {
    try {
      await acquireVmLock(instance, { lockDir, staleMs: 5000, retries: 0 });
      process.exit(0); // acquired => NOT blocked (the test expects this to fail)
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      process.stderr.write(`${code}\n`);
      process.exit(code === 'ELOCKED' ? 3 : 4);
    }
  }

  process.stderr.write(`unknown mode: ${mode}\n`);
  process.exit(9);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

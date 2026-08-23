/**
 * Real-process integration test for the advisory lock's mutual exclusion — the
 * one property the scripted-`SubprocessRunner` seam cannot verify. Spawns
 * genuine child processes (via `lock.integration.worker.ts`) that contend for a
 * single proper-lockfile-backed lock, and asserts:
 *
 *   - two contenders serialize (their held windows never overlap);
 *   - a live holder blocks a zero-retry contender (ELOCKED);
 *   - a stale lock whose holder was SIGKILLed is reclaimed by the next
 *     contender once the staleness window elapses.
 *
 * No real `limactl` or VM is involved — only the lock.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { acquireVmLock } from './lock.js';

const WORKER = fileURLToPath(new URL('./lock.integration.worker.ts', import.meta.url));
const INSTANCE = 'podkit-integration-lock';

let lockDir: string;

beforeEach(() => {
  lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-lock-int-'));
});
afterEach(() => {
  fs.rmSync(lockDir, { recursive: true, force: true });
});

function spawnWorker(mode: string, outFile?: string): ChildProcess {
  const args = [WORKER, mode, lockDir, INSTANCE];
  if (outFile) args.push(outFile);
  return spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function waitExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? -1));
  });
}

function waitForStdout(child: ChildProcess, needle: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for '${needle}'`)), 15_000);
    child.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      if (buf.includes(needle)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

describe('advisory lock mutual exclusion (real processes)', () => {
  it('serializes two contending processes so their held windows never overlap', async () => {
    const outFile = path.join(lockDir, 'windows.log');
    fs.writeFileSync(outFile, '');

    const a = spawnWorker('contend', outFile);
    const b = spawnWorker('contend', outFile);
    const [ca, cb] = await Promise.all([waitExit(a), waitExit(b)]);
    expect(ca).toBe(0);
    expect(cb).toBe(0);

    const lines = fs.readFileSync(outFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(4);
    // Serialized => each START is immediately followed by its own END. If the
    // windows had overlapped we'd see START, START, ... interleaved.
    expect(lines[0]!.startsWith('START ')).toBe(true);
    expect(lines[1]!.startsWith('END ')).toBe(true);
    expect(lines[2]!.startsWith('START ')).toBe(true);
    expect(lines[3]!.startsWith('END ')).toBe(true);
    const pidOf = (line: string): string => line.split(' ')[1]!;
    expect(pidOf(lines[0]!)).toBe(pidOf(lines[1]!));
    expect(pidOf(lines[2]!)).toBe(pidOf(lines[3]!));
    expect(pidOf(lines[0]!)).not.toBe(pidOf(lines[2]!));
  }, 30_000);

  it('blocks a zero-retry contender while a holder is alive', async () => {
    const release = await acquireVmLock(INSTANCE, { lockDir, staleMs: 5000 });
    try {
      const contender = spawnWorker('nowait');
      const code = await waitExit(contender);
      expect(code).toBe(3); // ELOCKED
    } finally {
      await release();
    }
  }, 15_000);

  it('reclaims a stale lock whose holder was killed', async () => {
    const holder = spawnWorker('hold');
    await waitForStdout(holder, 'ACQUIRED');
    holder.kill('SIGKILL');

    const started = Date.now();
    const release = await acquireVmLock(INSTANCE, { lockDir, staleMs: 5000, retries: 60 });
    const waitedMs = Date.now() - started;
    try {
      // The holder was killed while alive, so the contender must wait out the
      // staleness window (≥5s) before reclaiming — it cannot have reclaimed
      // instantly.
      expect(waitedMs).toBeGreaterThanOrEqual(4_000);
    } finally {
      await release();
    }
  }, 30_000);
});

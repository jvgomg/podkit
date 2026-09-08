/**
 * End-to-end reproduction of the pre-sync sweep vs. live transcode race
 * (TASK-501).
 *
 * The music pipeline creates `<tmpdir>/podkit-transcode-<uuid>/` and only
 * then writes the `.owner` marker that tells the debris walker the dir is
 * live. A sibling `podkit sync` sweeping inside that window used to classify
 * the dir as debris and delete it — along with the victim's in-flight
 * output. FFmpeg then wrote into a path that no longer existed and exited
 * 254 (`-ENOENT`) for every remaining track at once.
 *
 * The seam-level version of this lives in `pre-sync-sweep.test.ts`; this file
 * carries it through a real FFmpeg run so the failure mode the CI logs showed
 * — `FFmpeg exited with code 254`, `category: "transcode"` — is reproduced
 * rather than inferred.
 *
 * @module
 */

import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { requireFFmpeg } from '@podkit/test-fixtures';
import { FFmpegTranscoder } from '../../transcode/ffmpeg.js';
import { runPreSyncSweep, runPreliminariesPreFlight } from './pre-sync-sweep.js';
import type { Warning, WarningSink } from './types.js';

requireFFmpeg();

/** Stand-in for the sibling process's sweep, pointed at our fake tmp root. */
async function runSiblingSweep(hostTmp: string, mount: string): Promise<void> {
  const warnings: Warning[] = [];
  const sink: WarningSink = { emit: (w) => warnings.push(w) };
  const preliminaries = await runPreSyncSweep({
    mountPoint: mount,
    deviceType: 'ipod',
    tmpDirOverride: hostTmp,
  });
  await runPreliminariesPreFlight(preliminaries, { dryRun: false, warningSink: sink });
}

async function makeSource(path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-ac',
      '2',
      '-c:a',
      'flac',
      '-y',
      path,
    ]);
    let err = '';
    proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err))));
  });
}

describe('pre-sync sweep vs. a live transcode', () => {
  it('leaves a mid-setup scratch dir alone, so the transcode into it succeeds', async () => {
    const hostTmp = await mkdtemp(join(tmpdir(), 'race-hosttmp-'));
    const mount = await mkdtemp(join(tmpdir(), 'race-mount-'));
    try {
      const source = join(mount, 'source.flac');
      await makeSource(source);

      // Victim: the pipeline has mkdir'd its scratch dir and has not yet
      // reached `writeOwnership`. No `.owner` exists.
      const scratch = join(hostTmp, 'podkit-transcode-11111111-2222-3333-4444-555555555555');
      await mkdir(scratch, { recursive: true });
      await writeFile(join(scratch, 'earlier-track.m4a'), 'already transcoded');

      // Sibling sync sweeps in that window.
      await runSiblingSweep(hostTmp, mount);

      // The scratch dir and everything already written into it must survive.
      expect(existsSync(scratch)).toBe(true);
      expect(existsSync(join(scratch, 'earlier-track.m4a'))).toBe(true);

      // And the victim's next transcode must still land. Before the fix this
      // rejected with `FFmpeg exited with code 254`.
      const transcoder = new FFmpegTranscoder();
      const result = await transcoder.transcode(source, join(scratch, 'next-track.m4a'), 'low');
      expect(result.size).toBeGreaterThan(0);
    } finally {
      await rm(hostTmp, { recursive: true, force: true });
      await rm(mount, { recursive: true, force: true });
    }
  });
});

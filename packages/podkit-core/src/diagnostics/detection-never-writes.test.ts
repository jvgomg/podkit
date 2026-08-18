/**
 * Detection is read-only.
 *
 * `podkit doctor` runs its database-health checks on read-only devices
 * (shuffle 3G/4G, nano 6G/7G) — podkit can read those, so it can diagnose
 * them. That is only safe while detection and repair stay separated: a
 * check's `check()` observes, a check's `repair` writes. A probe that
 * "harmlessly" touched the device would break the tier's one promise.
 *
 * This test walks every registered iPod database-health check against a
 * populated mount point and asserts the tree is byte-identical afterwards.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getDiagnosticCheck, getDiagnosticCheckIds } from './index.js';
import type { DiagnosticContext } from './types.js';

/** One entry per file/directory: relative path, size, and mtime. */
type TreeSnapshot = string[];

function snapshot(root: string): TreeSnapshot {
  const entries: TreeSnapshot = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort()) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      const stats = fs.statSync(full);
      entries.push(`${rel}\t${entry.isDirectory() ? 'dir' : stats.size}\t${stats.mtimeMs}`);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return entries.sort();
}

/**
 * Database handle stub. Real enough that checks get past their "no database"
 * guard and reach their actual probe, which is the code under test here.
 */
function makeStubDb(): DiagnosticContext['db'] {
  return {
    getInfo: () => ({ device: { modelName: 'Stub iPod', generation: 'nano_7g' } }),
    device: { generation: 'nano_7g', modelName: 'Stub iPod' },
    trackCount: 1,
    getTracks: () => [
      { id: 1, ipodPath: ':iPod_Control:Music:F00:song.mp3', title: 'Song', artist: 'Artist' },
    ],
    getSysInfo: () => undefined,
    close: () => {},
  } as never;
}

describe('diagnostic detection never writes to the device', () => {
  let mountPoint: string;

  beforeEach(() => {
    mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-detection-read-only-'));
    const write = (rel: string, content: string): void => {
      const full = path.join(mountPoint, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    };
    // A populated-enough device: music that no database references (orphan
    // territory), debris, an artwork database, and both SysInfo files.
    write('iPod_Control/Music/F00/ABCD.mp3', 'not really an mp3');
    write('iPod_Control/Music/F01/.podkit-tmp-1234', 'debris');
    write('iPod_Control/Artwork/ArtworkDB', 'not really an ArtworkDB');
    write('iPod_Control/iTunes/iTunesDB', 'not really an iTunesDB');
    write('iPod_Control/iTunes/iTunesSD', 'not really an iTunesSD');
    write('iPod_Control/Device/SysInfo', 'ModelNumStr: D476\n');
    write('iPod_Control/Device/SysInfoExtended', '<?xml version="1.0"?>\n');
  });

  afterEach(() => {
    fs.rmSync(mountPoint, { recursive: true, force: true });
  });

  it('leaves the device untouched after every iPod database-health check runs', async () => {
    const before = snapshot(mountPoint);

    const ctx: DiagnosticContext = {
      mountPoint,
      deviceType: 'ipod',
      db: makeStubDb(),
      liveIdentity: { firewireGuid: '000A27001A2B3C4D' },
    };

    const ran: string[] = [];
    for (const id of getDiagnosticCheckIds()) {
      const check = getDiagnosticCheck(id);
      if (!check || check.scope !== 'database-health') continue;
      if (!(check.applicableTo ?? ['ipod']).includes('ipod')) continue;
      ran.push(id);
      try {
        await check.check(ctx);
      } catch {
        // A check that cannot read this synthetic device is fine — the
        // assertion is about what it wrote, not what it concluded.
      }
    }

    // Guard against the loop silently covering nothing.
    expect(ran.length).toBeGreaterThan(4);
    expect(snapshot(mountPoint)).toEqual(before);
  });
});

/**
 * Integration tests for the model number `initializeIpod` writes to a device.
 *
 * `itdb_init_ipod` stores its model argument as the device's SysInfo
 * `ModelNumStr` — durable identity on the user's hardware, which podkit later
 * reads back as evidence of what the device is. The binding therefore has no
 * default model: callers that cannot name the device must produce a database
 * with no SysInfo claim at all, rather than one that claims to be some other
 * iPod.
 *
 * These tests write to a temp directory only; no gpod-tool and no device.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../index.js';

const SYSINFO = join('iPod_Control', 'Device', 'SysInfo');

const created: string[] = [];

async function newMount(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'libgpod-init-'));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('Database.initializeIpod — SysInfo model number', () => {
  it('writes the model number it was given', async () => {
    const mount = await newMount();
    const db = await Database.initializeIpod(mount, { model: 'MA947', name: 'Shuffle' });
    db.close();

    const sysInfo = await readFile(join(mount, SYSINFO), 'utf8');
    expect(sysInfo).toContain('ModelNumStr: MA947');
  });

  it('writes no SysInfo at all when no model number is supplied', async () => {
    const mount = await newMount();
    const db = await Database.initializeIpod(mount, { name: 'Unknown iPod' });
    db.close();

    // The absence of the file is the point: an initialised device must not
    // claim a model number that nothing resolved from the hardware.
    expect(await exists(join(mount, SYSINFO))).toBe(false);
  });

  it('treats an empty model string as no model', async () => {
    const mount = await newMount();
    const db = await Database.initializeIpod(mount, { model: '', name: 'Unknown iPod' });
    db.close();

    expect(await exists(join(mount, SYSINFO))).toBe(false);
  });
});

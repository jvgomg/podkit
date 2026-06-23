/**
 * Integration tests for libgpod-node device-name functionality.
 *
 * The case-correct device name is stored as the iTunesDB master-playlist name.
 * These tests verify `Database.setDeviceName` writes it and that it survives
 * save() + reopen.
 *
 * These tests require gpod-tool to be built and available.
 * Run: mise run tools:build
 */

import { describe, it, expect } from 'bun:test';

import { withTestIpod, Database } from './helpers/test-setup';

describe('libgpod-node setDeviceName', () => {
  it('writes the master-playlist name', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);

      db.setDeviceName('Party iPod');

      const master = db.getMasterPlaylist();
      expect(master).not.toBeNull();
      expect(master!.name).toBe('Party iPod');

      db.close();
    });
  });

  it('persists the device name across save + reopen', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      db.setDeviceName('Party iPod');
      db.saveSync();
      db.close();

      const db2 = Database.openSync(ipod.path);
      const master = db2.getMasterPlaylist();
      expect(master).not.toBeNull();
      expect(master!.name).toBe('Party iPod');
      db2.close();
    });
  });

  it('preserves case (does not lowercase the name)', async () => {
    await withTestIpod(async (ipod) => {
      const db = Database.openSync(ipod.path);
      db.setDeviceName('MiXeD CaSe iPod');
      db.saveSync();
      db.close();

      const db2 = Database.openSync(ipod.path);
      expect(db2.getMasterPlaylist()!.name).toBe('MiXeD CaSe iPod');
      db2.close();
    });
  });
});

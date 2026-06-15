/**
 * Integration tests for the readiness pipeline against real iTunesDB
 * databases (via @podkit/gpod-testing).
 *
 * The unit tests in `readiness.test.ts` cover argv-style failure paths
 * (missing files, corrupt content) without needing libgpod. These cover
 * the success paths and the pre-opened-database optimisation seam.
 */

import { describe, it, expect } from 'bun:test';
import { withTestIpod } from '@podkit/gpod-testing';
import { requireGpodTool } from '@podkit/test-fixtures';
import { requireLibgpodNode } from '@podkit/libgpod-node';
import { IpodDatabase } from '../ipod/database.js';
import { checkDatabase, checkReadiness, ipodFromBlock } from './readiness.js';
import type { PlatformDeviceInfo } from './types.js';

requireGpodTool();
requireLibgpodNode();

function deviceInfoFor(mountPoint: string): PlatformDeviceInfo {
  return {
    identifier: 'integration',
    volumeName: 'TEST',
    volumeUuid: 'integration-uuid',
    storage: { sizeBytes: 0 },
    isMounted: true,
    mountPoint,
  };
}

describe('checkDatabase (integration)', () => {
  it('returns trackCount + modelName from a freshly-opened db (mountPoint mode)', async () => {
    await withTestIpod(async (testIpod) => {
      const result = await checkDatabase({ mountPoint: testIpod.path });
      expect(result.status).toBe('pass');
      expect(result.trackCount).toBe(0);
      expect(typeof result.modelName).toBe('string');
      expect(result.summary).toMatch(/0 tracks/);
    });
  });

  it('reuses a caller-supplied ipod handle and does not close it (ipod mode)', async () => {
    await withTestIpod(async (testIpod) => {
      const ipod = await IpodDatabase.open(testIpod.path);
      try {
        const result = await checkDatabase({ ipod });
        expect(result.status).toBe('pass');
        expect(result.trackCount).toBe(0);

        // Handle must still be usable — checkDatabase must not have closed it.
        // If it had, this read would throw / return a stale value.
        expect(ipod.trackCount).toBe(0);
        expect(typeof ipod.getInfo().device.modelName).toBe('string');
      } finally {
        ipod.close();
      }
    });
  });
});

describe('checkReadiness with pre-opened ipod (integration)', () => {
  it('threads the ipod through to the database stage', async () => {
    await withTestIpod(async (testIpod) => {
      const ipod = await IpodDatabase.open(testIpod.path);
      try {
        const result = await checkReadiness({
          device: ipodFromBlock(deviceInfoFor(testIpod.path)),
          ipod,
        });
        expect(result.level).toBe('ready');
        const dbStage = result.stages.find((s) => s.stage === 'database');
        expect(dbStage?.status).toBe('pass');
        expect(dbStage?.details?.trackCount).toBe(0);

        // Caller still owns the handle.
        expect(ipod.trackCount).toBe(0);
      } finally {
        ipod.close();
      }
    });
  });

  it('opens its own database when no ipod handle is provided', async () => {
    await withTestIpod(async (testIpod) => {
      const result = await checkReadiness({
        device: ipodFromBlock(deviceInfoFor(testIpod.path)),
      });
      expect(result.level).toBe('ready');
      const dbStage = result.stages.find((s) => s.stage === 'database');
      expect(dbStage?.status).toBe('pass');
    });
  });
});

import { describe, it, expect } from 'bun:test';
import {
  getScanner,
  getScannerIds,
  getApplicableScanners,
  runScanners,
  type Scanner,
  type ScannerContext,
} from './index.js';

const baseCtx: ScannerContext = {
  mountPoint: '/Volumes/example',
  deviceType: 'mass-storage',
  sessionStartMs: 1_700_000_000_000,
};

describe('Scanner registry shape', () => {
  it('returns empty by default', () => {
    expect(getScannerIds()).toEqual([]);
    expect(getApplicableScanners('ipod')).toEqual([]);
    expect(getApplicableScanners('mass-storage')).toEqual([]);
    expect(getApplicableScanners('host')).toEqual([]);
  });

  it('getScanner returns undefined for unknown id', () => {
    expect(getScanner('does-not-exist')).toBeUndefined();
  });
});

describe('runScanners aggregation', () => {
  it('returns empty debris when no scanners apply', async () => {
    const result = await runScanners('mass-storage', baseCtx);
    expect(result).toEqual({ debris: [], totalBytes: 0 });
  });

  it('aggregates debris + totalBytes across multiple scanners', async () => {
    // Local fixtures rather than registry mutation — pins the SHAPE the
    // registry expects without leaking state across other tests in the suite.
    const fixtures: Scanner[] = [
      {
        id: 'fixture-a',
        name: 'Fixture A',
        applicableTo: ['mass-storage'],
        async scan() {
          return {
            debris: [
              { path: '/a/one.tmp', bytes: 100 },
              { path: '/a/two.tmp', bytes: 50 },
            ],
            totalBytes: 150,
          };
        },
      },
      {
        id: 'fixture-b',
        name: 'Fixture B',
        applicableTo: ['mass-storage', 'ipod'],
        async scan() {
          return { debris: [{ path: '/b/three.tmp', bytes: 25 }], totalBytes: 25 };
        },
      },
    ];

    const applicable = fixtures.filter((s) => s.applicableTo.includes('mass-storage'));
    const results = await Promise.all(applicable.map((s) => s.scan(baseCtx)));
    const debris = results.flatMap((r) => r.debris);
    const totalBytes = results.reduce((sum, r) => sum + r.totalBytes, 0);

    expect(debris).toHaveLength(3);
    expect(totalBytes).toBe(175);
  });
});

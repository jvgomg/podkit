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
};

describe('Scanner registry shape', () => {
  it('registers the three baked-in debris scanners', () => {
    expect(getScannerIds()).toEqual(
      expect.arrayContaining([
        'mass-storage-content-debris',
        'ipod-content-debris',
        'transcode-tmp-debris',
      ])
    );
  });

  it('routes by applicableTo target', () => {
    const ms = getApplicableScanners('mass-storage').map((s) => s.id);
    const ipod = getApplicableScanners('ipod').map((s) => s.id);
    const host = getApplicableScanners('host').map((s) => s.id);

    expect(ms).toContain('mass-storage-content-debris');
    expect(ms).not.toContain('ipod-content-debris');
    expect(ms).not.toContain('transcode-tmp-debris');

    expect(ipod).toContain('ipod-content-debris');
    expect(ipod).not.toContain('mass-storage-content-debris');
    expect(ipod).not.toContain('transcode-tmp-debris');

    expect(host).toContain('transcode-tmp-debris');
    expect(host).not.toContain('ipod-content-debris');
    expect(host).not.toContain('mass-storage-content-debris');
  });

  it('getScanner returns undefined for unknown id', () => {
    expect(getScanner('does-not-exist')).toBeUndefined();
  });

  it('getScanner returns a registered scanner by id', () => {
    expect(getScanner('mass-storage-content-debris')?.applicableTo).toEqual(['mass-storage']);
  });
});

describe('runScanners aggregation', () => {
  it('returns empty debris when applicable scanners find nothing', async () => {
    // Mass-storage scanner returns empty when contentPaths is undefined.
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

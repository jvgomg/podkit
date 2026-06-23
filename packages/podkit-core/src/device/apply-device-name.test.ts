import { describe, it, expect, mock } from 'bun:test';
import {
  applyDeviceName,
  type IpodDatabaseNameWriter,
  type DeviceLabelWriter,
  type ResolveMountPath,
  type RefreshConfig,
  type ConfigRefreshInfo,
} from './apply-device-name.js';

function makeFakeDb(): IpodDatabaseNameWriter & {
  setDeviceName: ReturnType<typeof mock>;
  save: ReturnType<typeof mock>;
} {
  return {
    setDeviceName: mock(() => {}),
    save: mock(async () => undefined),
  };
}

function makeFakeLabelWriter(filesystem: string | null = 'MS-DOS FAT32'): DeviceLabelWriter & {
  detectFilesystem: ReturnType<typeof mock>;
  setVolumeLabel: ReturnType<typeof mock>;
} {
  return {
    detectFilesystem: mock(async () => filesystem),
    setVolumeLabel: mock(async () => undefined),
  };
}

describe('applyDeviceName', () => {
  it('writes the database name and saves when database is enabled', async () => {
    const db = makeFakeDb();

    const result = await applyDeviceName({
      db,
      mountPath: '/Volumes/IPOD',
      name: 'Party iPod',
      disk: false,
    });

    expect(db.setDeviceName).toHaveBeenCalledTimes(1);
    expect(db.setDeviceName).toHaveBeenCalledWith('Party iPod');
    expect(db.save).toHaveBeenCalledTimes(1);
    expect(result.databaseUpdated).toBe(true);
    expect(result.name).toBe('Party iPod');
  });

  it('writes the database name before saving', async () => {
    const order: string[] = [];
    const db: IpodDatabaseNameWriter = {
      setDeviceName: () => {
        order.push('setDeviceName');
      },
      save: async () => {
        order.push('save');
        return undefined;
      },
    };

    await applyDeviceName({ db, mountPath: '/Volumes/IPOD', name: 'X', disk: false });

    expect(order).toEqual(['setDeviceName', 'save']);
  });

  it('skips the database branch when database is false', async () => {
    const db = makeFakeDb();

    const result = await applyDeviceName({
      db,
      mountPath: '/Volumes/IPOD',
      name: 'Party iPod',
      database: false,
      disk: false,
    });

    expect(db.setDeviceName).not.toHaveBeenCalled();
    expect(db.save).not.toHaveBeenCalled();
    expect(result.databaseUpdated).toBe(false);
  });

  it('defaults database to enabled when omitted', async () => {
    const db = makeFakeDb();

    const result = await applyDeviceName({
      db,
      mountPath: '/Volumes/IPOD',
      name: 'Party iPod',
      disk: false,
    });

    expect(db.setDeviceName).toHaveBeenCalledTimes(1);
    expect(result.databaseUpdated).toBe(true);
  });

  it('skips the disk branch when disk is false', async () => {
    const db = makeFakeDb();
    const labelWriter = makeFakeLabelWriter();

    const result = await applyDeviceName({
      db,
      mountPath: '/Volumes/IPOD',
      name: 'Party iPod',
      disk: false,
      labelWriter,
    });

    expect(labelWriter.detectFilesystem).not.toHaveBeenCalled();
    expect(labelWriter.setVolumeLabel).not.toHaveBeenCalled();
    expect(result.diskUpdated).toBe(false);
    expect(result.mountPath).toBe('/Volumes/IPOD');
    expect(result.diskLabel).toBeUndefined();
  });
});

describe('applyDeviceName (disk branch)', () => {
  it('writes the DB name BEFORE relabeling the disk', async () => {
    const order: string[] = [];
    const db: IpodDatabaseNameWriter = {
      setDeviceName: () => order.push('setDeviceName'),
      save: async () => {
        order.push('save');
        return undefined;
      },
    };
    const labelWriter: DeviceLabelWriter = {
      detectFilesystem: async () => {
        order.push('detectFilesystem');
        return 'MS-DOS FAT32';
      },
      setVolumeLabel: async () => {
        order.push('setVolumeLabel');
      },
    };
    const resolveMountPath: ResolveMountPath = async () => {
      order.push('resolveMountPath');
      return '/Volumes/PARTY IPOD';
    };

    await applyDeviceName({
      db,
      mountPath: '/Volumes/IPOD',
      name: 'Party iPod',
      labelWriter,
      resolveMountPath,
    });

    expect(order).toEqual([
      'setDeviceName',
      'save',
      'detectFilesystem',
      'setVolumeLabel',
      'resolveMountPath',
    ]);
  });

  it('derives a FAT label, relabels, and returns the lossy warning + new mountPath', async () => {
    const db = makeFakeDb();
    const labelWriter = makeFakeLabelWriter('MS-DOS FAT32');
    const resolveMountPath: ResolveMountPath = mock(async () => '/Volumes/PARTY IPOD');

    const result = await applyDeviceName({
      db,
      mountPath: '/Volumes/IPOD',
      // Longer than 11 chars so the FAT label is genuinely lossy (truncated),
      // which is what produces a warning (plain case-folding does not).
      name: 'Party iPod Collection',
      labelWriter,
      resolveMountPath,
    });

    expect(labelWriter.setVolumeLabel).toHaveBeenCalledWith('/Volumes/IPOD', 'PARTY IPOD');
    expect(result.diskUpdated).toBe(true);
    expect(result.diskLabel).toBe('PARTY IPOD');
    expect(result.diskWarning).toContain('PARTY IPOD');
    expect(result.mountPath).toBe('/Volumes/PARTY IPOD');
    expect(resolveMountPath).toHaveBeenCalledWith('/Volumes/IPOD', 'PARTY IPOD');
  });

  it('preserves case + no warning on HFS+', async () => {
    const db = makeFakeDb();
    const labelWriter = makeFakeLabelWriter('Apple_HFS');
    const resolveMountPath: ResolveMountPath = async () => '/Volumes/Party iPod';

    const result = await applyDeviceName({
      db,
      mountPath: '/Volumes/IPOD',
      name: 'Party iPod',
      labelWriter,
      resolveMountPath,
    });

    expect(labelWriter.setVolumeLabel).toHaveBeenCalledWith('/Volumes/IPOD', 'Party iPod');
    expect(result.diskLabel).toBe('Party iPod');
    expect(result.diskWarning).toBeUndefined();
    expect(result.mountPath).toBe('/Volumes/Party iPod');
  });

  it('relabels even when the database branch is skipped', async () => {
    const db = makeFakeDb();
    const labelWriter = makeFakeLabelWriter('MS-DOS FAT32');
    const resolveMountPath: ResolveMountPath = async () => '/Volumes/X';

    const result = await applyDeviceName({
      db,
      mountPath: '/Volumes/IPOD',
      name: 'X',
      database: false,
      labelWriter,
      resolveMountPath,
    });

    expect(db.setDeviceName).not.toHaveBeenCalled();
    expect(result.databaseUpdated).toBe(false);
    expect(labelWriter.setVolumeLabel).toHaveBeenCalledTimes(1);
    expect(result.diskUpdated).toBe(true);
  });

  it('throws VolumeLabelError on an unsupported filesystem and never relabels', async () => {
    const db = makeFakeDb();
    const labelWriter = makeFakeLabelWriter('APFS');
    const resolveMountPath: ResolveMountPath = async () => '/Volumes/X';

    await expect(
      applyDeviceName({
        db,
        mountPath: '/Volumes/IPOD',
        name: 'Party iPod',
        labelWriter,
        resolveMountPath,
      })
    ).rejects.toThrow(/unsupported or unresolved filesystem/i);

    expect(labelWriter.setVolumeLabel).not.toHaveBeenCalled();
    // DB write still happened first (ordering contract) — relabel is the step
    // that failed.
    expect(db.setDeviceName).toHaveBeenCalledTimes(1);
  });
});

describe('applyDeviceName (refreshConfig seam)', () => {
  it('calls refreshConfig after a successful disk relabel with correct info', async () => {
    const db = makeFakeDb();
    const labelWriter = makeFakeLabelWriter('MS-DOS FAT32');
    const resolveMountPath: ResolveMountPath = async () => '/Volumes/PARTY IPOD';
    const refreshConfig: RefreshConfig = mock(async () => {});

    await applyDeviceName({
      db,
      mountPath: '/Volumes/IPOD',
      name: 'Party iPod',
      labelWriter,
      resolveMountPath,
      refreshConfig,
      volumeUuid: 'DEADBEEF-1234',
    });

    expect(refreshConfig).toHaveBeenCalledTimes(1);
    const calls = (refreshConfig as ReturnType<typeof mock>).mock.calls;
    const info = calls[0]?.[0] as ConfigRefreshInfo;
    expect(info.volumeUuid).toBe('DEADBEEF-1234');
    expect(info.oldPath).toBe('/Volumes/IPOD');
    expect(info.newPath).toBe('/Volumes/PARTY IPOD');
    expect(info.newLabel).toBe('PARTY IPOD');
    expect(info.name).toBe('Party iPod');
  });

  it('does NOT call refreshConfig when disk branch is skipped', async () => {
    const db = makeFakeDb();
    const refreshConfig: RefreshConfig = mock(async () => {});

    await applyDeviceName({
      db,
      mountPath: '/Volumes/IPOD',
      name: 'Party iPod',
      disk: false,
      refreshConfig,
    });

    expect(refreshConfig).not.toHaveBeenCalled();
  });

  it('succeeds without refreshConfig (safe no-op default)', async () => {
    const db = makeFakeDb();
    const labelWriter = makeFakeLabelWriter('MS-DOS FAT32');
    const resolveMountPath: ResolveMountPath = async () => '/Volumes/PARTY IPOD';

    // No refreshConfig injected — must not throw
    const result = await applyDeviceName({
      db,
      mountPath: '/Volumes/IPOD',
      name: 'Party iPod',
      labelWriter,
      resolveMountPath,
    });

    expect(result.diskUpdated).toBe(true);
    expect(result.mountPath).toBe('/Volumes/PARTY IPOD');
  });

  it('forwards volumeUuid as undefined when not supplied', async () => {
    const db = makeFakeDb();
    const labelWriter = makeFakeLabelWriter('MS-DOS FAT32');
    const resolveMountPath: ResolveMountPath = async () => '/Volumes/PARTY IPOD';
    const refreshConfig: RefreshConfig = mock(async () => {});

    await applyDeviceName({
      db,
      mountPath: '/Volumes/IPOD',
      name: 'Party iPod',
      labelWriter,
      resolveMountPath,
      refreshConfig,
      // volumeUuid intentionally omitted
    });

    const calls2 = (refreshConfig as ReturnType<typeof mock>).mock.calls;
    const info = calls2[0]?.[0] as ConfigRefreshInfo;
    expect(info.volumeUuid).toBeUndefined();
  });
});

import { describe, expect, it } from 'bun:test';
import { getModelInfo, getDisplayName, supportsArtwork, supportsVideo } from './models.js';
import type { IpodGeneration } from './types.js';

// ---------------------------------------------------------------------------
// getModelInfo
// ---------------------------------------------------------------------------

describe('getModelInfo', () => {
  it('looks up a known model with full SysInfo form (MA147 → iPod Video 60GB)', () => {
    const info = getModelInfo('MA147');
    expect(info).toBeDefined();
    expect(info!.modelNumber).toBe('A147');
    expect(info!.fullModelNumber).toBe('MA147');
    expect(info!.capacityGb).toBe(60);
    expect(info!.generation).toBe('video_1');
    expect(info!.displayName).toContain('60GB');
    expect(info!.musicDirs).toBe(50);
  });

  it('looks up a known model with stripped form (A147)', () => {
    const byFull = getModelInfo('MA147');
    const byStripped = getModelInfo('A147');
    expect(byStripped).toEqual(byFull);
  });

  it('lookup is case-insensitive', () => {
    expect(getModelInfo('ma147')).toEqual(getModelInfo('MA147'));
    expect(getModelInfo('a147')).toEqual(getModelInfo('A147'));
  });

  it('returns undefined for unknown model numbers', () => {
    expect(getModelInfo('ZZZZZZ')).toBeUndefined();
    expect(getModelInfo('MX999')).toBeUndefined();
    expect(getModelInfo('')).toBeUndefined();
  });

  it('looks up iPod 1st gen (M8513)', () => {
    const info = getModelInfo('M8513');
    expect(info).toBeDefined();
    expect(info!.generation).toBe('first');
    expect(info!.capacityGb).toBe(5);
    expect(info!.model).toBe('regular');
  });

  it('looks up iPod Photo (MA079)', () => {
    const info = getModelInfo('MA079');
    expect(info).toBeDefined();
    expect(info!.generation).toBe('photo');
    expect(info!.displayName).toContain('Photo');
  });

  it('looks up iPod mini 2nd gen 6GB (M9801)', () => {
    const info = getModelInfo('M9801');
    expect(info).toBeDefined();
    expect(info!.generation).toBe('mini_2');
    expect(info!.capacityGb).toBe(6);
    expect(info!.musicDirs).toBe(20);
  });

  it('looks up iPod shuffle 1st gen (M9724)', () => {
    const info = getModelInfo('M9724');
    expect(info).toBeDefined();
    expect(info!.generation).toBe('shuffle_1');
    expect(info!.capacityGb).toBe(0.5);
    expect(info!.musicDirs).toBe(3);
  });

  it('looks up iPod nano 1st gen (MA004)', () => {
    const info = getModelInfo('MA004');
    expect(info).toBeDefined();
    expect(info!.generation).toBe('nano_1');
    expect(info!.capacityGb).toBe(2);
  });

  it('looks up iPod Classic 6th gen (MB029)', () => {
    const info = getModelInfo('MB029');
    expect(info).toBeDefined();
    expect(info!.generation).toBe('classic_1');
    expect(info!.capacityGb).toBe(80);
    expect(info!.model).toBe('classic_silver');
  });

  it('looks up iPod Classic 7th gen (MC293)', () => {
    const info = getModelInfo('MC293');
    expect(info).toBeDefined();
    expect(info!.generation).toBe('classic_3');
    expect(info!.capacityGb).toBe(160);
  });

  it('looks up iPod touch 1st gen (MA623)', () => {
    const info = getModelInfo('MA623');
    expect(info).toBeDefined();
    expect(info!.generation).toBe('touch_1');
    expect(info!.capacityGb).toBe(8);
  });

  it('looks up iPhone (MA501)', () => {
    const info = getModelInfo('MA501');
    expect(info).toBeDefined();
    expect(info!.generation).toBe('iphone_1');
  });

  it('looks up iPad (MB292)', () => {
    const info = getModelInfo('MB292');
    expect(info).toBeDefined();
    expect(info!.generation).toBe('ipad_1');
    expect(info!.capacityGb).toBe(16);
  });

  it('model table has at least 50 entries', () => {
    // Count how many unique model numbers resolve by testing a representative
    // set of known models from different generations
    const knownModels = [
      'M8513',
      'M8737',
      'M8976',
      'M9282', // 1st-4th gen
      'M9160',
      'M9800', // mini
      'MA079',
      'M9829', // photo
      'M9724',
      'M9725', // shuffle 1
      'MA546',
      'MA947', // shuffle 2
      'MC306',
      'MC323', // shuffle 3
      'MC584', // shuffle 4
      'MA350',
      'MA004',
      'MA005', // nano 1
      'MA002',
      'MA146',
      'MA003',
      'MA147', // video 1
      'MA444',
      'MA448', // video 2
      'MA477',
      'MA426', // nano 2
      'MB029',
      'MB145', // classic 1
      'MB562', // classic 2
      'MC293', // classic 3
      'MA978',
      'MB261', // nano 3
      'MB480',
      'MB598', // nano 4
      'MC027',
      'MC060', // nano 5
      'MC525',
      'MC526', // nano 6
      'MA623',
      'MB528',
      'MC008',
      'MC540', // touch
      'MA501',
      'MB046',
      'MC131',
      'MC603', // iphone
      'MB292',
      'MB293',
      'MB294', // ipad
      'MA978',
      'MA980', // nano 3 (extra)
    ];
    const found = knownModels.filter((m) => getModelInfo(m) !== undefined);
    expect(found.length).toBeGreaterThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// getDisplayName
// ---------------------------------------------------------------------------

describe('getDisplayName', () => {
  it('returns the display name from the model info', () => {
    const info = getModelInfo('MA147')!;
    expect(getDisplayName(info)).toBe(info.displayName);
    expect(getDisplayName(info)).toContain('60GB');
  });
});

// ---------------------------------------------------------------------------
// supportsArtwork
// ---------------------------------------------------------------------------

describe('supportsArtwork', () => {
  it('returns false for shuffle 1st generation', () => {
    expect(supportsArtwork('shuffle_1')).toBe(false);
  });

  it('returns false for shuffle 2nd generation', () => {
    expect(supportsArtwork('shuffle_2')).toBe(false);
  });

  it('returns true for shuffle 3rd generation', () => {
    expect(supportsArtwork('shuffle_3')).toBe(true);
  });

  it('returns true for shuffle 4th generation', () => {
    expect(supportsArtwork('shuffle_4')).toBe(true);
  });

  it('returns true for regular iPod generations', () => {
    expect(supportsArtwork('first')).toBe(true);
    expect(supportsArtwork('second')).toBe(true);
    expect(supportsArtwork('third')).toBe(true);
    expect(supportsArtwork('fourth')).toBe(true);
  });

  it('returns true for photo generation', () => {
    expect(supportsArtwork('photo')).toBe(true);
  });

  it('returns true for nano generations', () => {
    expect(supportsArtwork('nano_1')).toBe(true);
    expect(supportsArtwork('nano_6')).toBe(true);
  });

  it('returns true for video generations', () => {
    expect(supportsArtwork('video_1')).toBe(true);
    expect(supportsArtwork('video_2')).toBe(true);
  });

  it('returns true for classic generations', () => {
    expect(supportsArtwork('classic_1')).toBe(true);
    expect(supportsArtwork('classic_3')).toBe(true);
  });

  it('returns true for touch generations', () => {
    expect(supportsArtwork('touch_1')).toBe(true);
    expect(supportsArtwork('touch_4')).toBe(true);
  });

  it('returns true for iphone generations', () => {
    expect(supportsArtwork('iphone_1')).toBe(true);
  });

  it('returns true for ipad', () => {
    expect(supportsArtwork('ipad_1')).toBe(true);
  });

  it('returns true for unknown generation', () => {
    expect(supportsArtwork('unknown')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// supportsVideo
// ---------------------------------------------------------------------------

describe('supportsVideo', () => {
  it('returns true for video_1', () => {
    expect(supportsVideo('video_1')).toBe(true);
  });

  it('returns true for video_2', () => {
    expect(supportsVideo('video_2')).toBe(true);
  });

  it('returns true for classic generations', () => {
    expect(supportsVideo('classic_1')).toBe(true);
    expect(supportsVideo('classic_2')).toBe(true);
    expect(supportsVideo('classic_3')).toBe(true);
  });

  it('returns true for nano 3rd generation and later', () => {
    expect(supportsVideo('nano_3')).toBe(true);
    expect(supportsVideo('nano_4')).toBe(true);
    expect(supportsVideo('nano_5')).toBe(true);
    expect(supportsVideo('nano_6')).toBe(true);
  });

  it('returns false for nano 1st and 2nd generation', () => {
    expect(supportsVideo('nano_1')).toBe(false);
    expect(supportsVideo('nano_2')).toBe(false);
  });

  it('returns true for touch generations', () => {
    expect(supportsVideo('touch_1')).toBe(true);
    expect(supportsVideo('touch_2')).toBe(true);
    expect(supportsVideo('touch_3')).toBe(true);
    expect(supportsVideo('touch_4')).toBe(true);
  });

  it('returns true for iphone generations', () => {
    expect(supportsVideo('iphone_1')).toBe(true);
    expect(supportsVideo('iphone_2')).toBe(true);
    expect(supportsVideo('iphone_3')).toBe(true);
    expect(supportsVideo('iphone_4')).toBe(true);
  });

  it('returns true for ipad', () => {
    expect(supportsVideo('ipad_1')).toBe(true);
  });

  it('returns false for shuffle generations', () => {
    expect(supportsVideo('shuffle_1')).toBe(false);
    expect(supportsVideo('shuffle_2')).toBe(false);
    expect(supportsVideo('shuffle_3')).toBe(false);
    expect(supportsVideo('shuffle_4')).toBe(false);
  });

  it('returns false for early iPod generations', () => {
    expect(supportsVideo('first')).toBe(false);
    expect(supportsVideo('second')).toBe(false);
    expect(supportsVideo('third')).toBe(false);
    expect(supportsVideo('fourth')).toBe(false);
  });

  it('returns false for photo generation', () => {
    expect(supportsVideo('photo')).toBe(false);
  });

  it('returns false for mini generations', () => {
    expect(supportsVideo('mini_1')).toBe(false);
    expect(supportsVideo('mini_2')).toBe(false);
  });

  it('returns false for unknown generation', () => {
    expect(supportsVideo('unknown')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// All 32 IpodGeneration values are defined
// ---------------------------------------------------------------------------

describe('IpodGeneration coverage', () => {
  const allGenerations: IpodGeneration[] = [
    'unknown',
    'first',
    'second',
    'third',
    'fourth',
    'photo',
    'mobile',
    'mini_1',
    'mini_2',
    'shuffle_1',
    'shuffle_2',
    'shuffle_3',
    'shuffle_4',
    'nano_1',
    'nano_2',
    'nano_3',
    'nano_4',
    'nano_5',
    'nano_6',
    'video_1',
    'video_2',
    'classic_1',
    'classic_2',
    'classic_3',
    'touch_1',
    'touch_2',
    'touch_3',
    'touch_4',
    'iphone_1',
    'iphone_2',
    'iphone_3',
    'iphone_4',
    'ipad_1',
  ];

  it('defines all 33 generation values (32 non-unknown + unknown)', () => {
    expect(allGenerations).toHaveLength(33);
  });

  it('supportsArtwork handles every generation without throwing', () => {
    for (const gen of allGenerations) {
      expect(() => supportsArtwork(gen)).not.toThrow();
    }
  });

  it('supportsVideo handles every generation without throwing', () => {
    for (const gen of allGenerations) {
      expect(() => supportsVideo(gen)).not.toThrow();
    }
  });
});

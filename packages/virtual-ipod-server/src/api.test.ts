import { describe, test, expect } from 'bun:test';
import { ipodPathToFs } from './api.js';

describe('ipodPathToFs', () => {
  test('converts colon-separated path with leading colon', () => {
    const result = ipodPathToFs(':iPod_Control:Music:F00:ABCD.m4a', '/mnt/ipod');
    expect(result).toBe('/mnt/ipod/iPod_Control/Music/F00/ABCD.m4a');
  });

  test('converts colon-separated path without leading colon', () => {
    const result = ipodPathToFs('iPod_Control:Music:F00:ABCD.m4a', '/mnt/ipod');
    expect(result).toBe('/mnt/ipod/iPod_Control/Music/F00/ABCD.m4a');
  });

  test('handles path with single component', () => {
    const result = ipodPathToFs(':file.m4a', '/mnt/ipod');
    expect(result).toBe('/mnt/ipod/file.m4a');
  });

  test('handles deep nested paths', () => {
    const result = ipodPathToFs(':iPod_Control:Music:F19:ZZZZ.mp3', '/mnt/ipod');
    expect(result).toBe('/mnt/ipod/iPod_Control/Music/F19/ZZZZ.mp3');
  });

  test('uses custom mount point', () => {
    const result = ipodPathToFs(':iPod_Control:iTunes:iTunesDB', '/media/ipod');
    expect(result).toBe('/media/ipod/iPod_Control/iTunes/iTunesDB');
  });
});

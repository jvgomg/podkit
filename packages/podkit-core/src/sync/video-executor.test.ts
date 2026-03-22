/**
 * Unit tests for the video sync executor
 *
 * Video execution uses SyncExecutor + VideoHandler. Tests for video execution
 * behaviour are now in the sync executor and video handler test suites.
 *
 * This file is kept as a placeholder for any future PlaceholderVideoSyncExecutor
 * or getVideoOperationDisplayName tests.
 */

import { describe, expect, it } from 'bun:test';
import { getVideoOperationDisplayName } from './video-executor.js';
import type { SyncOperation } from './types.js';

describe('getVideoOperationDisplayName', () => {
  it('should format movie title with year', () => {
    const op: SyncOperation = {
      type: 'video-transcode',
      source: {
        id: '/videos/test.mkv',
        filePath: '/videos/test.mkv',
        contentType: 'movie',
        title: 'The Matrix',
        container: 'mkv',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 1920,
        height: 1080,
        duration: 7200,
        year: 1999,
      },
      settings: {
        targetWidth: 320,
        targetHeight: 240,
        targetVideoBitrate: 500,
        targetAudioBitrate: 128,
        videoProfile: 'baseline' as const,
        videoLevel: '3.0',
        crf: 23,
        frameRate: 30,
        useHardwareAcceleration: false,
      },
    };
    expect(getVideoOperationDisplayName(op)).toBe('The Matrix (1999)');
  });

  it('should format movie title without year', () => {
    const op: SyncOperation = {
      type: 'video-copy',
      source: {
        id: '/videos/test.mp4',
        filePath: '/videos/test.mp4',
        contentType: 'movie',
        title: 'Inception',
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 640,
        height: 480,
        duration: 7200,
      },
    };
    expect(getVideoOperationDisplayName(op)).toBe('Inception');
  });
});

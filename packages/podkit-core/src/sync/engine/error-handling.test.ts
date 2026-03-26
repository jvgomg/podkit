/**
 * Unit tests for the shared error handling module
 *
 * ## Test Coverage
 *
 * 1. Error categorization (message-based and operation-type-based)
 * 2. Retry configuration (DEFAULT_RETRY_CONFIG and VIDEO_RETRY_CONFIG)
 * 3. getRetriesForCategory with different configs
 * 4. createCategorizedError helper
 * 5. withRetry generic retry function
 */

import { describe, expect, it } from 'bun:test';
import {
  categorizeError,
  getRetriesForCategory,
  createCategorizedError,
  withRetry,
  DEFAULT_RETRY_CONFIG,
  VIDEO_RETRY_CONFIG,
} from './error-handling.js';

// =============================================================================
// Error Categorization Tests
// =============================================================================

describe('categorizeError', () => {
  describe('message-based categorization', () => {
    it('categorizes database errors', () => {
      expect(categorizeError(new Error('database error'), 'add-direct-copy')).toBe('database');
      expect(categorizeError(new Error('itunes db corrupt'), 'add-direct-copy')).toBe('database');
      expect(categorizeError(new Error('libgpod failed'), 'add-direct-copy')).toBe('database');
      expect(categorizeError(new Error('ipod not found'), 'add-direct-copy')).toBe('database');
    });

    it('categorizes artwork errors', () => {
      expect(categorizeError(new Error('artwork extraction failed'), 'add-direct-copy')).toBe(
        'artwork'
      );
      expect(categorizeError(new Error('image format unsupported'), 'add-direct-copy')).toBe(
        'artwork'
      );
    });

    it('categorizes file I/O errors as copy', () => {
      expect(categorizeError(new Error('ENOENT: no such file'), 'add-transcode')).toBe('copy');
      expect(categorizeError(new Error('EACCES: permission denied'), 'add-transcode')).toBe('copy');
      expect(categorizeError(new Error('ENOSPC: no space left'), 'add-transcode')).toBe('copy');
      expect(categorizeError(new Error('file not found'), 'add-transcode')).toBe('copy');
    });

    it('categorizes transcode errors', () => {
      expect(categorizeError(new Error('ffmpeg exited with code 1'), 'add-direct-copy')).toBe(
        'transcode'
      );
      expect(categorizeError(new Error('transcode failed'), 'add-direct-copy')).toBe('transcode');
      expect(categorizeError(new Error('encoder not found'), 'add-direct-copy')).toBe('transcode');
      expect(categorizeError(new Error('codec not supported'), 'add-direct-copy')).toBe(
        'transcode'
      );
    });
  });

  describe('operation-type fallback', () => {
    it('falls back to transcode for transcode operations', () => {
      expect(categorizeError(new Error('unknown error'), 'add-transcode')).toBe('transcode');
    });

    it('falls back to transcode for video-transcode operations', () => {
      expect(categorizeError(new Error('unknown error'), 'video-transcode')).toBe('transcode');
    });

    it('falls back to copy for copy operations', () => {
      expect(categorizeError(new Error('unknown error'), 'add-direct-copy')).toBe('copy');
    });

    it('falls back to copy for video-copy operations', () => {
      expect(categorizeError(new Error('unknown error'), 'video-copy')).toBe('copy');
    });

    it('falls back to copy for upgrade operations', () => {
      expect(categorizeError(new Error('unknown error'), 'upgrade-direct-copy')).toBe('copy');
    });

    it('falls back to copy for video-upgrade operations', () => {
      expect(categorizeError(new Error('unknown error'), 'video-upgrade')).toBe('copy');
    });

    it('returns unknown for other operation types', () => {
      expect(categorizeError(new Error('unknown error'), 'remove')).toBe('unknown');
      expect(categorizeError(new Error('unknown error'), 'update-metadata')).toBe('unknown');
    });
  });

  describe('priority order', () => {
    it('database takes priority over copy keywords', () => {
      // "ipod" matches database, but also looks like a file I/O error
      expect(categorizeError(new Error('ipod ENOENT'), 'add-direct-copy')).toBe('database');
    });

    it('database takes priority over transcode keywords', () => {
      expect(categorizeError(new Error('database ffmpeg error'), 'add-direct-copy')).toBe(
        'database'
      );
    });
  });
});

// =============================================================================
// Retry Configuration Tests
// =============================================================================

describe('retry configurations', () => {
  describe('DEFAULT_RETRY_CONFIG', () => {
    it('allows 1 transcode retry', () => {
      expect(DEFAULT_RETRY_CONFIG.transcode).toBe(1);
    });

    it('allows 1 copy retry', () => {
      expect(DEFAULT_RETRY_CONFIG.copy).toBe(1);
    });

    it('allows 0 database retries', () => {
      expect(DEFAULT_RETRY_CONFIG.database).toBe(0);
    });

    it('allows 0 artwork retries', () => {
      expect(DEFAULT_RETRY_CONFIG.artwork).toBe(0);
    });

    it('allows 0 unknown retries', () => {
      expect(DEFAULT_RETRY_CONFIG.unknown).toBe(0);
    });

    it('has 1000ms retry delay', () => {
      expect(DEFAULT_RETRY_CONFIG.retryDelayMs).toBe(1000);
    });
  });

  describe('VIDEO_RETRY_CONFIG', () => {
    it('allows 0 transcode retries (too expensive)', () => {
      expect(VIDEO_RETRY_CONFIG.transcode).toBe(0);
    });

    it('allows 1 copy retry', () => {
      expect(VIDEO_RETRY_CONFIG.copy).toBe(1);
    });

    it('allows 0 database retries', () => {
      expect(VIDEO_RETRY_CONFIG.database).toBe(0);
    });
  });
});

// =============================================================================
// getRetriesForCategory Tests
// =============================================================================

describe('getRetriesForCategory', () => {
  it('returns transcode retries for transcode category', () => {
    expect(getRetriesForCategory('transcode', DEFAULT_RETRY_CONFIG)).toBe(1);
    expect(getRetriesForCategory('transcode', VIDEO_RETRY_CONFIG)).toBe(0);
  });

  it('returns copy retries for copy category', () => {
    expect(getRetriesForCategory('copy', DEFAULT_RETRY_CONFIG)).toBe(1);
    expect(getRetriesForCategory('copy', VIDEO_RETRY_CONFIG)).toBe(1);
  });

  it('returns database retries for database category', () => {
    expect(getRetriesForCategory('database', DEFAULT_RETRY_CONFIG)).toBe(0);
  });

  it('returns artwork retries for artwork category', () => {
    expect(getRetriesForCategory('artwork', DEFAULT_RETRY_CONFIG)).toBe(0);
  });

  it('returns unknown retries for unknown category', () => {
    expect(getRetriesForCategory('unknown', DEFAULT_RETRY_CONFIG)).toBe(0);
  });
});

// =============================================================================
// createCategorizedError Tests
// =============================================================================

describe('createCategorizedError', () => {
  it('creates a categorized error with all fields', () => {
    const error = new Error('test error');
    const result = createCategorizedError(error, 'transcode', 'Artist - Title', 1, true);

    expect(result.error).toBe(error);
    expect(result.category).toBe('transcode');
    expect(result.trackName).toBe('Artist - Title');
    expect(result.retryAttempts).toBe(1);
    expect(result.wasRetried).toBe(true);
  });

  it('creates a categorized error without retries', () => {
    const error = new Error('database error');
    const result = createCategorizedError(error, 'database', 'Track', 0, false);

    expect(result.category).toBe('database');
    expect(result.retryAttempts).toBe(0);
    expect(result.wasRetried).toBe(false);
  });
});

// =============================================================================
// withRetry Tests
// =============================================================================

describe('withRetry', () => {
  it('returns success on first try', async () => {
    const result = await withRetry(
      async () => 42,
      DEFAULT_RETRY_CONFIG,
      'add-transcode',
      'Test Track'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe(42);
      expect(result.attempts).toBe(1);
    }
  });

  it('retries on transient failure and succeeds', async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('ffmpeg transient failure');
        }
        return 'success';
      },
      { ...DEFAULT_RETRY_CONFIG, retryDelayMs: 0 },
      'add-transcode',
      'Test Track'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('success');
      expect(result.attempts).toBe(2);
    }
  });

  it('returns error after exhausting retries', async () => {
    const result = await withRetry(
      async () => {
        throw new Error('ffmpeg persistent failure');
      },
      { ...DEFAULT_RETRY_CONFIG, retryDelayMs: 0 },
      'add-transcode',
      'Test Track'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('transcode');
      expect(result.error.trackName).toBe('Test Track');
      expect(result.error.wasRetried).toBe(true);
      expect(result.error.retryAttempts).toBe(1); // 1 retry = 2 total attempts
      expect(result.attempts).toBe(2);
    }
  });

  it('does not retry database errors', async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        throw new Error('database error');
      },
      { ...DEFAULT_RETRY_CONFIG, retryDelayMs: 0 },
      'add-direct-copy',
      'Test Track'
    );

    expect(callCount).toBe(1); // No retry
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('database');
      expect(result.error.wasRetried).toBe(false);
    }
  });

  it('does not retry video transcodes with VIDEO_RETRY_CONFIG', async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        throw new Error('ffmpeg error');
      },
      { ...VIDEO_RETRY_CONFIG, retryDelayMs: 0 },
      'video-transcode',
      'Test Video'
    );

    expect(callCount).toBe(1); // No retry (VIDEO_RETRY_CONFIG.transcode = 0)
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('transcode');
      expect(result.error.wasRetried).toBe(false);
    }
  });

  it('retries video copy errors with VIDEO_RETRY_CONFIG', async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('ENOENT: file not found');
        }
        return 'success';
      },
      { ...VIDEO_RETRY_CONFIG, retryDelayMs: 0 },
      'video-copy',
      'Test Video'
    );

    expect(callCount).toBe(2); // 1 retry
    expect(result.ok).toBe(true);
  });
});

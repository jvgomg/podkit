/**
 * Unit tests for the shared error handling module.
 *
 * ## Contract
 *
 * `categorizeError` follows two rules in order:
 *
 * 1. If the error extends {@link CategorizedSyncError}, read its `category`
 *    directly. The throw site declared the category on the class.
 * 2. Else, fall back to a small operation-type table. The call site
 *    intentionally chose the operation type, so it's the next-best signal.
 *
 * There is NO message-keyword inspection. Tests that previously pinned
 * substring matching (e.g. "ENOSPC → copy", "ffmpeg → transcode") have been
 * removed — those errors now categorize via op-type fallback, OR via a
 * typed error class wrapping the raw cause. Untyped, unknown-op-type errors
 * are `unknown`.
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
import { CategorizedSyncError, DatabaseWriteError } from './errors.js';
import {
  CopyError,
  MoveError,
  PictureWriteError,
  SidecarWriteError,
  TagWriteError,
} from '../../device/mass-storage-tag-writer.js';

// =============================================================================
// Error Categorization Tests
// =============================================================================

describe('categorizeError', () => {
  describe('typed errors (CategorizedSyncError subclasses)', () => {
    it('reads category from TagWriteError, regardless of paths embedded in the message', () => {
      // A path like "/mnt/iPod/foo.flac" used to trip the substring matcher
      // and mis-classify this as a database error. The typed class closes
      // that hole — the category is on the type.
      const err = new TagWriteError([
        '/mnt/iPod/foo.flac: ENOENT',
        '/mnt/itunes-style/x.flac: permission denied',
      ]);
      expect(categorizeError(err, 'update-metadata')).toBe('copy');
    });

    it('reads category from SidecarWriteError', () => {
      const err = new SidecarWriteError(['/album/foo: rename failed']);
      expect(categorizeError(err, 'upgrade-artwork')).toBe('copy');
    });

    it('reads category from PictureWriteError', () => {
      const err = new PictureWriteError(['/x.ogg: write failed']);
      expect(categorizeError(err, 'add-direct-copy')).toBe('copy');
    });

    it('reads category from MoveError', () => {
      const err = new MoveError(['/old → /new: EACCES']);
      expect(categorizeError(err, 'relocate')).toBe('copy');
    });

    it('reads category from CopyError, regardless of operation type', () => {
      const underlying = Object.assign(new Error('ENOSPC: no space left on device, write'), {
        code: 'ENOSPC',
      });
      const err = new CopyError('/src/song.mp3', underlying);
      expect(categorizeError(err, 'add-direct-copy')).toBe('copy');
      // Even with an op type that doesn't route to 'copy' via fallback,
      // the typed-error class wins.
      expect(categorizeError(err, 'update-metadata')).toBe('copy');
    });

    it('preserves underlying errno on CopyError.errorCode and surfaces a single cause', () => {
      const underlying = Object.assign(new Error('ENOSPC: no space left on device, write'), {
        code: 'ENOSPC',
      });
      const err = new CopyError('/src/song.mp3', underlying);
      expect(err.errorCode).toBe('ENOSPC');
      expect(err.sourcePath).toBe('/src/song.mp3');
      expect(err.causes.length).toBe(1);
      expect(err.causes[0]).toBe('/src/song.mp3: ENOSPC: no space left on device, write');
      // Class name comes from `new.target.name` on the base class.
      expect(err.name).toBe('CopyError');
      // Message format matches the matrix's classifyThrowsClass regex.
      expect(/file copy failed for/.test(err.message)).toBe(true);
    });

    it('CopyError tolerates an underlying error without a `code` property', () => {
      const err = new CopyError('/src/song.mp3', new Error('synthetic failure'));
      expect(err.errorCode).toBeUndefined();
      expect(err.causes[0]).toBe('/src/song.mp3: synthetic failure');
    });

    it('CopyError tolerates a non-Error underlying value', () => {
      const err = new CopyError('/src/song.mp3', 'string failure');
      expect(err.errorCode).toBeUndefined();
      expect(err.causes[0]).toBe('/src/song.mp3: string failure');
    });

    it('CopyError can wrap another CategorizedSyncError without recursion concerns', () => {
      // Sanity check: the adapter's copyTrackFile catch has an
      // `instanceof CategorizedSyncError` passthrough so it does NOT
      // double-wrap an already-typed error. The CopyError class itself
      // doesn't enforce that — it just records the message — but the
      // round-trip via the categorizer should still classify the OUTER
      // error's category.
      const inner = new MoveError(['/x: EACCES']);
      const outer = new CopyError('/src/song.mp3', inner);
      expect(categorizeError(outer, 'add-direct-copy')).toBe('copy');
      // The wrapped message is preserved in the causes for diagnostics.
      expect(outer.causes[0]).toContain('file move failed for');
    });

    it('reads category from DatabaseWriteError', () => {
      const err = new DatabaseWriteError('itunesdb corrupt');
      // Op-type would normally route 'add-direct-copy' to 'copy'; the typed
      // error wins so the executor does NOT retry an iTunesDB failure.
      expect(categorizeError(err, 'add-direct-copy')).toBe('database');
      expect(categorizeError(err, 'update-metadata')).toBe('database');
    });

    it('ignores operation type when the error is typed', () => {
      // Even with op-type='video-transcode' (which would fall back to
      // 'transcode'), the typed error's category wins.
      const err = new TagWriteError(['x.flac: failed']);
      expect(categorizeError(err, 'video-transcode')).toBe('copy');
    });

    it('honours category on a caller-defined subclass', () => {
      class CustomTranscodeError extends CategorizedSyncError {
        readonly category = 'transcode' as const;
      }
      const err = new CustomTranscodeError('encoder died');
      expect(categorizeError(err, 'remove')).toBe('transcode');
    });
  });

  describe('operation-type fallback (untyped errors)', () => {
    it('falls back to transcode for add-transcode / upgrade-transcode / video-transcode', () => {
      expect(categorizeError(new Error('boom'), 'add-transcode')).toBe('transcode');
      expect(categorizeError(new Error('boom'), 'upgrade-transcode')).toBe('transcode');
      expect(categorizeError(new Error('boom'), 'video-transcode')).toBe('transcode');
    });

    it('falls back to copy for the copy / upgrade / artwork / relocate ops', () => {
      expect(categorizeError(new Error('boom'), 'add-direct-copy')).toBe('copy');
      expect(categorizeError(new Error('boom'), 'add-optimized-copy')).toBe('copy');
      expect(categorizeError(new Error('boom'), 'upgrade-direct-copy')).toBe('copy');
      expect(categorizeError(new Error('boom'), 'upgrade-optimized-copy')).toBe('copy');
      expect(categorizeError(new Error('boom'), 'upgrade-artwork')).toBe('copy');
      expect(categorizeError(new Error('boom'), 'video-copy')).toBe('copy');
      expect(categorizeError(new Error('boom'), 'video-upgrade')).toBe('copy');
      expect(categorizeError(new Error('boom'), 'relocate')).toBe('copy');
    });

    it('returns unknown for ops with no natural category mapping', () => {
      expect(categorizeError(new Error('boom'), 'remove')).toBe('unknown');
      expect(categorizeError(new Error('boom'), 'update-metadata')).toBe('unknown');
      expect(categorizeError(new Error('boom'), 'update-sync-tag')).toBe('unknown');
      expect(categorizeError(new Error('boom'), '')).toBe('unknown');
    });

    it('does NOT substring-match the message', () => {
      // The historical categorizer would have called this `database`. The new
      // contract requires a typed error if you want that classification — the
      // op-type fallback is the only inference path for untyped errors.
      expect(categorizeError(new Error('database is corrupt'), 'add-direct-copy')).toBe('copy');
      expect(categorizeError(new Error('ffmpeg crashed'), 'add-direct-copy')).toBe('copy');
      expect(categorizeError(new Error('ENOSPC: no space'), 'remove')).toBe('unknown');
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

  it('retries on transient transcode failure (op-type fallback) and succeeds', async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('encoder died');
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
        throw new Error('persistent failure');
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
      expect(result.error.retryAttempts).toBe(1);
      expect(result.attempts).toBe(2);
    }
  });

  it('does not retry typed copy errors beyond the copy-category budget', async () => {
    // TagWriteError is `copy` → 1 retry under DEFAULT_RETRY_CONFIG. Verifies
    // typed errors flow through retry policy correctly.
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        throw new TagWriteError(['x.flac: failed']);
      },
      { ...DEFAULT_RETRY_CONFIG, retryDelayMs: 0 },
      'update-metadata',
      'Test Track'
    );

    expect(callCount).toBe(2); // first try + 1 retry
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('copy');
    }
  });

  it('does not retry video transcodes with VIDEO_RETRY_CONFIG', async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        throw new Error('encoder died');
      },
      { ...VIDEO_RETRY_CONFIG, retryDelayMs: 0 },
      'video-transcode',
      'Test Video'
    );

    expect(callCount).toBe(1);
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
          throw new Error('file not found');
        }
        return 'success';
      },
      { ...VIDEO_RETRY_CONFIG, retryDelayMs: 0 },
      'video-copy',
      'Test Video'
    );

    expect(callCount).toBe(2);
    expect(result.ok).toBe(true);
  });
});

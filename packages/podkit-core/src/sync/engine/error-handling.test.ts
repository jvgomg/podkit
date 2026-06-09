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
        { path: '/mnt/iPod/foo.flac', message: 'ENOENT', errno: 'ENOENT' },
        { path: '/mnt/itunes-style/x.flac', message: 'permission denied', errno: 'EACCES' },
      ]);
      expect(categorizeError(err, 'update-metadata')).toBe('copy');
    });

    it('reads category from SidecarWriteError', () => {
      const err = new SidecarWriteError([
        { path: '/album/foo', message: 'rename failed', errno: 'EACCES' },
      ]);
      expect(categorizeError(err, 'upgrade-artwork')).toBe('copy');
    });

    it('reads category from PictureWriteError', () => {
      const err = new PictureWriteError([
        { path: '/x.ogg', message: 'write failed', errno: 'EACCES' },
      ]);
      expect(categorizeError(err, 'add-direct-copy')).toBe('copy');
    });

    it('reads category from MoveError', () => {
      const err = new MoveError([{ path: '/old → /new', message: 'EACCES', errno: 'EACCES' }]);
      expect(categorizeError(err, 'relocate')).toBe('copy');
    });

    it('routes CopyError ENOSPC to space (override on top of declared copy)', () => {
      // The ENOSPC override fires regardless of the error class's declared
      // category. CopyError declares 'copy' (1 retry) but a disk-full
      // failure should not retry — the second attempt would fail the same
      // way. The categorizer reads errno off the structured cause and
      // overrides to 'space' (0 retries).
      const underlying = Object.assign(new Error('ENOSPC: no space left on device, write'), {
        code: 'ENOSPC',
      });
      const err = new CopyError('/src/song.mp3', underlying);
      expect(categorizeError(err, 'add-direct-copy')).toBe('space');
      expect(categorizeError(err, 'update-metadata')).toBe('space');
    });

    it('CopyError without ENOSPC keeps declared copy category', () => {
      const underlying = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      const err = new CopyError('/src/song.mp3', underlying);
      expect(categorizeError(err, 'add-direct-copy')).toBe('copy');
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
      expect(err.structuredCauses?.length).toBe(1);
      expect(err.structuredCauses?.[0]).toEqual({
        path: '/src/song.mp3',
        message: 'ENOSPC: no space left on device, write',
        errno: 'ENOSPC',
      });
      // Class name comes from `new.target.name` on the base class.
      expect(err.name).toBe('CopyError');
      // Message format matches the matrix's classifyThrowsClass regex.
      expect(/file copy failed for/.test(err.message)).toBe(true);
    });

    it('CopyError tolerates an underlying error without a `code` property', () => {
      const err = new CopyError('/src/song.mp3', new Error('synthetic failure'));
      expect(err.errorCode).toBeUndefined();
      expect(err.causes[0]).toBe('/src/song.mp3: synthetic failure');
      expect(err.structuredCauses?.[0]?.errno).toBeUndefined();
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
      const inner = new MoveError([{ path: '/x', message: 'EACCES', errno: 'EACCES' }]);
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
      const err = new TagWriteError([{ path: 'x.flac', message: 'failed', errno: undefined }]);
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

  describe('ENOSPC override (hasEnospc → "space")', () => {
    // An aggregate or single-cause typed error whose structured causes
    // include an ENOSPC entry routes to 'space' regardless of the class's
    // declared `category`. This catches the case where a file-I/O error
    // class (`TagWriteError`/`PictureWriteError`/`SidecarWriteError`/
    // `MoveError`/`CopyError`) would otherwise route to 'copy' (1 retry) and
    // waste a retry attempt when the disk is genuinely full.

    it('TagWriteError with ENOSPC cause routes to space', () => {
      const err = new TagWriteError([
        { path: 'a.flac', message: 'ENOSPC: no space left', errno: 'ENOSPC' },
      ]);
      expect(categorizeError(err, 'update-metadata')).toBe('space');
    });

    it('PictureWriteError with ENOSPC cause routes to space', () => {
      const err = new PictureWriteError([
        { path: 'a.ogg', message: 'ENOSPC: no space left', errno: 'ENOSPC' },
      ]);
      expect(categorizeError(err, 'upgrade-artwork')).toBe('space');
    });

    it('SidecarWriteError with ENOSPC cause routes to space', () => {
      const err = new SidecarWriteError([
        { path: '/album', message: 'ENOSPC: no space left', errno: 'ENOSPC' },
      ]);
      expect(categorizeError(err, 'upgrade-artwork')).toBe('space');
    });

    it('MoveError with ENOSPC cause routes to space', () => {
      const err = new MoveError([
        { path: '/old → /new', message: 'ENOSPC: no space left', errno: 'ENOSPC' },
      ]);
      expect(categorizeError(err, 'relocate')).toBe('space');
    });

    it('any ENOSPC cause wins — mixed EACCES + ENOSPC routes to space', () => {
      const err = new TagWriteError([
        { path: 'a.flac', message: 'EACCES', errno: 'EACCES' },
        { path: 'b.flac', message: 'ENOSPC: no space left', errno: 'ENOSPC' },
      ]);
      expect(categorizeError(err, 'update-metadata')).toBe('space');
    });

    it('non-ENOSPC mixed causes keep the declared category', () => {
      const err = new TagWriteError([
        { path: 'a.flac', message: 'EACCES', errno: 'EACCES' },
        { path: 'b.flac', message: 'EROFS', errno: 'EROFS' },
      ]);
      expect(categorizeError(err, 'update-metadata')).toBe('copy');
    });

    it('typed error without structuredCauses falls through to declared category', () => {
      // DatabaseWriteError doesn't populate structuredCauses (its causes are
      // bare path strings). hasEnospc returns false → declared category wins.
      const err = new DatabaseWriteError('itunesdb corrupt');
      expect(err.hasEnospc).toBe(false);
      expect(categorizeError(err, 'add-direct-copy')).toBe('database');
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
        throw new TagWriteError([{ path: 'x.flac', message: 'failed', errno: undefined }]);
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

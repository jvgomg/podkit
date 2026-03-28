import { describe, expect, it } from 'bun:test';
import { interpretError } from './error-codes.js';

describe('interpretError', () => {
  // ── Known errno codes ───────────────────────────────────────────────────────

  describe('known errno codes via .errno property', () => {
    const cases: Array<[number, string, string]> = [
      [71, 'EPROTO', 'Device communication failed'],
      [13, 'EACCES', 'Permission denied'],
      [19, 'ENODEV', 'Device not found'],
      [5, 'EIO', 'I/O error'],
      [1, 'EPERM', 'Operation not permitted'],
      [16, 'EBUSY', 'Device is busy'],
      [28, 'ENOSPC', 'No space left on device'],
      [30, 'EROFS', 'Read-only file system'],
    ];

    for (const [code, name, descFragment] of cases) {
      it(`errno ${code} (${name}) produces correct explanation`, () => {
        const err = Object.assign(new Error('some error'), { errno: code });
        const result = interpretError(err);
        expect(result.explanation).toContain(descFragment);
        expect(result.errno).toBe(code);
        expect(result.errnoName).toBe(name);
        expect(result.rawMessage).toBe('some error');
      });
    }
  });

  // ── .code string property ───────────────────────────────────────────────────

  describe('known errno codes via .code property', () => {
    it('EACCES code produces permission denied explanation', () => {
      const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const result = interpretError(err);
      expect(result.explanation).toContain('Permission denied');
      expect(result.errno).toBe(13);
      expect(result.errnoName).toBe('EACCES');
    });

    it('EPROTO code produces device communication explanation', () => {
      const err = Object.assign(new Error('protocol error'), { code: 'EPROTO' });
      const result = interpretError(err);
      expect(result.explanation).toContain('Device communication failed');
      expect(result.errno).toBe(71);
      expect(result.errnoName).toBe('EPROTO');
    });

    it('ENODEV code produces device not found explanation', () => {
      const err = Object.assign(new Error('no device'), { code: 'ENODEV' });
      const result = interpretError(err);
      expect(result.explanation).toContain('Device not found');
      expect(result.errno).toBe(19);
      expect(result.errnoName).toBe('ENODEV');
    });
  });

  // ── Parsing errno from string messages ─────────────────────────────────────

  describe('parsing errno from string messages', () => {
    it('parses "errno 71" pattern', () => {
      const result = interpretError(new Error('libgpod errno 71 occurred'));
      expect(result.errno).toBe(71);
      expect(result.explanation).toContain('Device communication failed');
    });

    it('parses "error 71" pattern', () => {
      const result = interpretError(new Error('Got error 71 from device'));
      expect(result.errno).toBe(71);
      expect(result.explanation).toContain('Device communication failed');
    });

    it('parses "[Errno 13]" pattern', () => {
      const result = interpretError(new Error('[Errno 13] Permission denied: /dev/sdb'));
      expect(result.errno).toBe(13);
      expect(result.explanation).toContain('Permission denied');
    });

    it('parses EPROTO name from message string', () => {
      const result = interpretError(new Error('EPROTO: protocol error, open /Volumes/iPod'));
      expect(result.errno).toBe(71);
      expect(result.errnoName).toBe('EPROTO');
      expect(result.explanation).toContain('Device communication failed');
    });

    it('parses EACCES name from message string', () => {
      const result = interpretError(new Error('EACCES: permission denied, open /dev/sdb'));
      expect(result.errno).toBe(13);
      expect(result.errnoName).toBe('EACCES');
    });
  });

  // ── Plain string input ──────────────────────────────────────────────────────

  describe('plain string errors', () => {
    it('parses errno from a plain string', () => {
      const result = interpretError('errno 5: I/O error');
      expect(result.errno).toBe(5);
      expect(result.explanation).toContain('I/O error');
      expect(result.rawMessage).toBe('errno 5: I/O error');
    });

    it('returns generic explanation for plain string without codes', () => {
      const result = interpretError('something went wrong');
      expect(result.explanation).toBe('An unexpected error occurred.');
      expect(result.rawMessage).toBe('something went wrong');
      expect(result.errno).toBeUndefined();
      expect(result.errnoName).toBeUndefined();
    });
  });

  // ── Unknown errno codes ─────────────────────────────────────────────────────

  describe('unknown errno codes', () => {
    it('returns generic explanation for unrecognised errno', () => {
      const err = Object.assign(new Error('obscure error'), { errno: 999 });
      const result = interpretError(err);
      expect(result.explanation).toBe('An unexpected error occurred.');
      expect(result.errno).toBe(999);
      expect(result.rawMessage).toBe('obscure error');
    });

    it('preserves raw message for unknown errno from string', () => {
      const result = interpretError(new Error('errno 42 from device'));
      expect(result.explanation).toBe('An unexpected error occurred.');
      expect(result.errno).toBe(42);
      expect(result.rawMessage).toBe('errno 42 from device');
    });
  });

  // ── Raw message preservation ────────────────────────────────────────────────

  describe('raw message preservation', () => {
    it('always includes raw message even for known codes', () => {
      const err = Object.assign(new Error('the actual message from libgpod'), { errno: 71 });
      const result = interpretError(err);
      expect(result.rawMessage).toBe('the actual message from libgpod');
    });

    it('always includes raw message for generic errors', () => {
      const result = interpretError(new Error('no errno here'));
      expect(result.rawMessage).toBe('no errno here');
    });

    it('preserves raw message from plain string', () => {
      const result = interpretError('raw string error');
      expect(result.rawMessage).toBe('raw string error');
    });
  });

  // ── Error objects without errno ─────────────────────────────────────────────

  describe('Error objects without errno', () => {
    it('produces a generic explanation for Error with no errno or code', () => {
      const result = interpretError(new Error('database open failed'));
      expect(result.explanation).toBe('An unexpected error occurred.');
      expect(result.rawMessage).toBe('database open failed');
      expect(result.errno).toBeUndefined();
    });

    it('falls back to message parsing when no errno property', () => {
      const result = interpretError(new Error('operation failed with EBUSY'));
      expect(result.errno).toBe(16);
      expect(result.errnoName).toBe('EBUSY');
    });
  });

  // ── Negative errno (Node.js platform behaviour) ─────────────────────────────

  describe('negative errno values', () => {
    it('handles negative errno by taking absolute value', () => {
      const err = Object.assign(new Error('permission denied'), { errno: -13 });
      const result = interpretError(err);
      expect(result.errno).toBe(13);
      expect(result.explanation).toContain('Permission denied');
    });
  });
});

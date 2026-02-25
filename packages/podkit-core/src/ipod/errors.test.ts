import { describe, expect, it } from 'bun:test';
import { IpodError, type IpodErrorCode } from './errors.js';

describe('IpodError', () => {
  describe('construction', () => {
    it('creates error with message and code', () => {
      const error = new IpodError('iPod not found', 'NOT_FOUND');

      expect(error.message).toBe('iPod not found');
      expect(error.code).toBe('NOT_FOUND');
    });

    it('sets name to IpodError', () => {
      const error = new IpodError('test error', 'DATABASE_CORRUPT');

      expect(error.name).toBe('IpodError');
    });

    it('is an instance of Error', () => {
      const error = new IpodError('test error', 'SAVE_FAILED');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(IpodError);
    });

    it('has a stack trace', () => {
      const error = new IpodError('test error', 'COPY_FAILED');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('IpodError');
    });

    it('handles empty message', () => {
      const error = new IpodError('', 'NOT_FOUND');

      expect(error.message).toBe('');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.name).toBe('IpodError');
    });
  });

  describe('error codes', () => {
    const testCases: Array<{
      code: IpodErrorCode;
      description: string;
    }> = [
      { code: 'NOT_FOUND', description: 'iPod not found at path' },
      { code: 'DATABASE_CORRUPT', description: 'database corrupt' },
      { code: 'TRACK_REMOVED', description: 'track removed' },
      { code: 'PLAYLIST_REMOVED', description: 'playlist removed' },
      { code: 'FILE_NOT_FOUND', description: 'source file not found' },
      { code: 'COPY_FAILED', description: 'file copy failed' },
      { code: 'ARTWORK_FAILED', description: 'artwork operation failed' },
      { code: 'SAVE_FAILED', description: 'database save failed' },
      { code: 'DATABASE_CLOSED', description: 'database closed' },
    ];

    for (const { code, description } of testCases) {
      it(`supports ${code} code for ${description}`, () => {
        const error = new IpodError(`Error: ${description}`, code);

        expect(error.code).toBe(code);
        expect(error.message).toBe(`Error: ${description}`);
      });
    }
  });

  describe('readonly properties', () => {
    it('code property is set correctly and accessible', () => {
      const error = new IpodError('test', 'NOT_FOUND');

      // The readonly modifier is a TypeScript compile-time check,
      // not a runtime enforcement. We verify the value is correct.
      expect(error.code).toBe('NOT_FOUND');

      // Also verify it's a direct property of the instance
      expect(Object.prototype.hasOwnProperty.call(error, 'code')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('can be caught and identified by instanceof', () => {
      const throwAndCatch = () => {
        try {
          throw new IpodError('test error', 'NOT_FOUND');
        } catch (e) {
          if (e instanceof IpodError) {
            return e.code;
          }
          return 'unknown';
        }
      };

      expect(throwAndCatch()).toBe('NOT_FOUND');
    });

    it('can be caught as generic Error', () => {
      const throwAndCatch = () => {
        try {
          throw new IpodError('test error', 'DATABASE_CORRUPT');
        } catch (e) {
          if (e instanceof Error) {
            return e.message;
          }
          return 'unknown';
        }
      };

      expect(throwAndCatch()).toBe('test error');
    });

    it('can switch on error codes', () => {
      const handleError = (error: IpodError): string => {
        switch (error.code) {
          case 'NOT_FOUND':
            return 'device missing';
          case 'DATABASE_CORRUPT':
            return 'database broken';
          case 'SAVE_FAILED':
            return 'save error';
          default:
            return 'other error';
        }
      };

      expect(handleError(new IpodError('x', 'NOT_FOUND'))).toBe(
        'device missing'
      );
      expect(handleError(new IpodError('x', 'DATABASE_CORRUPT'))).toBe(
        'database broken'
      );
      expect(handleError(new IpodError('x', 'SAVE_FAILED'))).toBe('save error');
      expect(handleError(new IpodError('x', 'COPY_FAILED'))).toBe(
        'other error'
      );
    });
  });
});

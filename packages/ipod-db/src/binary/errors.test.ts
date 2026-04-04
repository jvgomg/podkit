import { describe, expect, it } from 'bun:test';
import { ParseError } from './errors.js';

describe('ParseError', () => {
  it('sets all fields from constructor options', () => {
    const err = new ParseError('bad tag', {
      offset: 42,
      expected: '"mhbd"',
      actual: '"mhsd"',
      recordPath: ['mhbd', 'mhsd[0]'],
    });

    expect(err.offset).toBe(42);
    expect(err.expected).toBe('"mhbd"');
    expect(err.actual).toBe('"mhsd"');
    expect(err.recordPath).toEqual(['mhbd', 'mhsd[0]']);
  });

  it('inherits from Error', () => {
    const err = new ParseError('oops', { offset: 0 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ParseError);
  });

  it('has name "ParseError"', () => {
    const err = new ParseError('oops', { offset: 0 });
    expect(err.name).toBe('ParseError');
  });

  it('formats message with offset', () => {
    const err = new ParseError('unexpected value', { offset: 16 });
    expect(err.message).toContain('unexpected value');
    expect(err.message).toContain('at offset 16');
  });

  it('formats message with expected and actual', () => {
    const err = new ParseError('bad tag', {
      offset: 0,
      expected: '"mhbd"',
      actual: '"xxxx"',
    });
    expect(err.message).toContain('expected "mhbd"');
    expect(err.message).toContain('got "xxxx"');
  });

  it('formats message with record path', () => {
    const err = new ParseError('bad data', {
      offset: 100,
      recordPath: ['mhbd', 'mhsd[0]', 'mhlt'],
    });
    expect(err.message).toContain('mhbd > mhsd[0] > mhlt');
  });

  it('defaults recordPath to empty array', () => {
    const err = new ParseError('oops', { offset: 0 });
    expect(err.recordPath).toEqual([]);
  });

  it('does not include record path in message when empty', () => {
    const err = new ParseError('oops', { offset: 0, recordPath: [] });
    expect(err.message).not.toContain(' in ');
  });

  it('has a stack trace', () => {
    const err = new ParseError('oops', { offset: 0 });
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('ParseError');
  });
});

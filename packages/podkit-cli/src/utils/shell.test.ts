import { describe, it, expect } from 'bun:test';
import { shellQuote } from './shell.js';

describe('shellQuote', () => {
  it('returns simple alphanumeric tokens unchanged', () => {
    expect(shellQuote('terapod')).toBe('terapod');
    expect(shellQuote('my-device')).toBe('my-device');
    expect(shellQuote('device_1')).toBe('device_1');
  });

  it('returns paths with safe punctuation unchanged', () => {
    expect(shellQuote('/Volumes/iPod')).toBe('/Volumes/iPod');
    expect(shellQuote('./relative/path')).toBe('./relative/path');
    expect(shellQuote('host.example.com:8080')).toBe('host.example.com:8080');
    expect(shellQuote('a/b,c=d')).toBe('a/b,c=d');
    expect(shellQuote('user@host')).toBe('user@host');
  });

  it('wraps values containing spaces in double quotes', () => {
    expect(shellQuote('My iPod')).toBe('"My iPod"');
    expect(shellQuote('/Volumes/My Music')).toBe('"/Volumes/My Music"');
  });

  it('escapes embedded double-quote characters', () => {
    expect(shellQuote('a"b')).toBe('"a\\"b"');
  });

  it('escapes embedded backslashes', () => {
    expect(shellQuote('a\\b')).toBe('"a\\\\b"');
  });

  it('escapes embedded dollar signs (would otherwise expand inside double quotes)', () => {
    expect(shellQuote('$HOME')).toBe('"\\$HOME"');
  });

  it('escapes embedded backticks (would otherwise command-substitute inside double quotes)', () => {
    expect(shellQuote('a`b')).toBe('"a\\`b"');
  });

  it('quotes the empty string (no safe-char match)', () => {
    expect(shellQuote('')).toBe('""');
  });

  it('quotes leading-hyphen tokens unchanged (still safe-char only)', () => {
    // Hyphen IS in the safe set, so a leading `-` doesn't force quoting.
    // Documented behaviour: shellQuote is for display, not argv-injection
    // safety. Callers that need flag-injection protection must guard at
    // the call site.
    expect(shellQuote('-d')).toBe('-d');
  });

  it('quotes values with characters outside the safe set', () => {
    expect(shellQuote("don't")).toBe('"don\'t"');
    expect(shellQuote('a;b')).toBe('"a;b"');
    expect(shellQuote('a|b')).toBe('"a|b"');
    expect(shellQuote('a&b')).toBe('"a&b"');
  });
});

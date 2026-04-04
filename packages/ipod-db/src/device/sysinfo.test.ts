import { describe, expect, it } from 'bun:test';
import { parseSysInfo } from './sysinfo.js';

describe('parseSysInfo', () => {
  it('parses a standard SysInfo with ModelNumStr and FirewireGuid', () => {
    const content = `ModelNumStr: MA147\nFirewireGuid: 0x0000A00000000001\n`;
    const result = parseSysInfo(content);
    expect(result.modelNumber).toBe('MA147');
    expect(result.firewireGuid).toBe('0x0000A00000000001');
  });

  it('stores all key-value pairs in raw map', () => {
    const content = [
      'ModelNumStr: MA147',
      'FirewireGuid: 0x0000A00000000001',
      'BoardHwName: iPod',
      'PolicyVersion: 0x00010001',
    ].join('\n');
    const result = parseSysInfo(content);
    expect(result.raw.size).toBe(4);
    expect(result.raw.get('BoardHwName')).toBe('iPod');
    expect(result.raw.get('PolicyVersion')).toBe('0x00010001');
  });

  it('handles extra unknown fields gracefully', () => {
    const content = ['ModelNumStr: MC293', 'SomeUnknownField: someValue', 'AnotherField: 42'].join(
      '\n'
    );
    const result = parseSysInfo(content);
    expect(result.modelNumber).toBe('MC293');
    expect(result.raw.get('SomeUnknownField')).toBe('someValue');
    expect(result.raw.get('AnotherField')).toBe('42');
  });

  it('returns null for modelNumber when ModelNumStr is absent', () => {
    const content = 'FirewireGuid: 0x0000A00000000001\nBoardHwName: iPod\n';
    const result = parseSysInfo(content);
    expect(result.modelNumber).toBeNull();
    expect(result.firewireGuid).toBe('0x0000A00000000001');
  });

  it('returns null for firewireGuid when FirewireGuid is absent', () => {
    const content = 'ModelNumStr: MA147\nBoardHwName: iPod\n';
    const result = parseSysInfo(content);
    expect(result.firewireGuid).toBeNull();
    expect(result.modelNumber).toBe('MA147');
  });

  it('handles an empty file', () => {
    const result = parseSysInfo('');
    expect(result.modelNumber).toBeNull();
    expect(result.firewireGuid).toBeNull();
    expect(result.raw.size).toBe(0);
  });

  it('skips empty lines', () => {
    const content = '\n\nModelNumStr: MA147\n\n\nFirewireGuid: 0x0001\n\n';
    const result = parseSysInfo(content);
    expect(result.modelNumber).toBe('MA147');
    expect(result.firewireGuid).toBe('0x0001');
    expect(result.raw.size).toBe(2);
  });

  it('skips malformed lines without a colon', () => {
    const content = [
      'ModelNumStr: MA147',
      'this line has no colon',
      'NorDoesThisOne',
      'FirewireGuid: 0x0001',
    ].join('\n');
    const result = parseSysInfo(content);
    expect(result.modelNumber).toBe('MA147');
    expect(result.firewireGuid).toBe('0x0001');
    expect(result.raw.size).toBe(2);
  });

  it('matches ModelNumStr case-insensitively', () => {
    const content = 'modelNumStr: MA147\nfirewireGuid: 0x0001\n';
    const result = parseSysInfo(content);
    expect(result.modelNumber).toBe('MA147');
    expect(result.firewireGuid).toBe('0x0001');
  });

  it('trims whitespace from keys and values', () => {
    const content = '  ModelNumStr  :  MA147  \n  FirewireGuid : 0x0001 \n';
    const result = parseSysInfo(content);
    expect(result.modelNumber).toBe('MA147');
    expect(result.firewireGuid).toBe('0x0001');
  });

  it('handles values with colons (e.g. GUID with 0x prefix)', () => {
    // Value should include everything after the first colon
    const content = 'FirewireGuid: 0x0000A00000000001\n';
    const result = parseSysInfo(content);
    expect(result.firewireGuid).toBe('0x0000A00000000001');
  });

  it('handles Windows-style CRLF line endings', () => {
    const content = 'ModelNumStr: MA147\r\nFirewireGuid: 0x0001\r\n';
    const result = parseSysInfo(content);
    expect(result.modelNumber).toBe('MA147');
    expect(result.firewireGuid).toBe('0x0001');
  });
});

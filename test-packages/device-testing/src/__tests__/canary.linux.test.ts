import { describe, it, expect } from 'bun:test';

const isLinux = process.platform === 'linux';
if (!isLinux) console.log(`Skipping canary.linux.test.ts on ${process.platform}`);

describe.skipIf(!isLinux)('canary (linux)', () => {
  it('runs only on linux', () => {
    expect(process.platform).toBe('linux');
  });
});

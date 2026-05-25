import { describe, it, expect } from 'bun:test';

const isDarwin = process.platform === 'darwin';
if (!isDarwin) console.log(`Skipping canary.darwin.test.ts on ${process.platform}`);

describe.skipIf(!isDarwin)('canary (darwin)', () => {
  it('runs only on darwin', () => {
    expect(process.platform).toBe('darwin');
  });
});

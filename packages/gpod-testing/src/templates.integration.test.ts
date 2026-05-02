import { describe, expect, it } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import { createTestIpod, TEMPLATE_MODELS, templatePath, templatesDir } from './index';

describe('template fast-path', () => {
  it('templates directory exists (run `bun turbo generate-templates` if missing)', () => {
    const dir = templatesDir();
    expect(existsSync(dir)).toBe(true);
    expect(statSync(dir).isDirectory()).toBe(true);
  });

  it('every TEMPLATE_MODELS entry has a corresponding template directory', () => {
    for (const model of TEMPLATE_MODELS) {
      const path = templatePath(model);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).isDirectory()).toBe(true);
    }
  });

  it.skipIf(process.env.PODKIT_DISABLE_TEMPLATE_CACHE === '1')(
    'createTestIpod() with defaults uses fast path (well under subprocess cost)',
    async () => {
      const start = performance.now();
      const ipod = await createTestIpod();
      const ms = performance.now() - start;
      try {
        // Subprocess spawn alone is ~250-300ms. Template copy is ~5ms. 50ms is a
        // generous separator that proves the fast path was taken.
        expect(ms).toBeLessThan(50);
      } finally {
        await ipod.cleanup();
      }
    }
  );

  it('createTestIpod produces a valid iPod via the fast path', async () => {
    const ipod = await createTestIpod({ model: 'MA147' });
    try {
      const info = await ipod.info();
      expect(info.device.modelName).toBe('iPod Video');
      expect(info.trackCount).toBe(0);
      const verify = await ipod.verify();
      expect(verify.valid).toBe(true);
    } finally {
      await ipod.cleanup();
    }
  });
});

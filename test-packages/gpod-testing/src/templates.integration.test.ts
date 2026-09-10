import { describe, expect, it } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import { requireGpodTool } from '@podkit/test-fixtures';
import { createTestIpod, TEMPLATE_MODELS, templatePath, templatesDir } from './index';

requireGpodTool();

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

  // This pair asserts on the branch `createTestIpod` took, via the
  // `usedTemplate` flag it reports, NOT on how long it took. The elapsed-time
  // proxy this replaced (`expect(ms).toBeLessThan(50)`, TASK-227) failed on
  // essentially every CI run with the fast path working perfectly — a template
  // copy measured 68ms on a loaded 4-vCPU runner (TASK-507). Nothing about the
  // contract "defaults copy a template instead of spawning gpod-tool" is
  // expressible as a duration, so don't reintroduce one.
  it.skipIf(process.env.PODKIT_DISABLE_TEMPLATE_CACHE === '1')(
    'createTestIpod() with defaults copies a template instead of spawning gpod-tool',
    async () => {
      const ipod = await createTestIpod();
      try {
        expect(ipod.usedTemplate).toBe(true);
      } finally {
        await ipod.cleanup();
      }
    }
  );

  // Keeps the flag above honest: it has to be able to report `false`, or the
  // assertion it carries could never go red. Also pins the escape hatch itself
  // — PODKIT_DISABLE_TEMPLATE_CACHE=1 must still reach the subprocess path,
  // which is what makes the A/B benchmark in docs/agents/testing.md meaningful.
  it('PODKIT_DISABLE_TEMPLATE_CACHE=1 forces the gpod-tool subprocess path', async () => {
    const previous = process.env.PODKIT_DISABLE_TEMPLATE_CACHE;
    process.env.PODKIT_DISABLE_TEMPLATE_CACHE = '1';
    try {
      const ipod = await createTestIpod();
      try {
        expect(ipod.usedTemplate).toBe(false);
        expect((await ipod.verify()).valid).toBe(true);
      } finally {
        await ipod.cleanup();
      }
    } finally {
      if (previous === undefined) delete process.env.PODKIT_DISABLE_TEMPLATE_CACHE;
      else process.env.PODKIT_DISABLE_TEMPLATE_CACHE = previous;
    }
  });

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

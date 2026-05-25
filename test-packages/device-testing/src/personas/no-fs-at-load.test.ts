/**
 * Regression test: importing the persona registry must NOT touch the
 * filesystem at module-eval time.
 *
 * Why this exists
 * ---------------
 * Persona modules used to call `readFileSync` at the top level to load
 * their `raw/` fixtures. That broke external consumers (the bundler
 * didn't copy `raw/` into `dist/`, so importing `personas` from another
 * package crashed with `ENOENT`) and made the registry import order-
 * dependent on filesystem state. The fixtures now live as base64-encoded
 * string literals inside generated TypeScript modules; persona fields
 * decode them lazily inside cached getters.
 *
 * The test patches `fs.readFileSync`, then triggers a fresh import of
 * the registry via Bun's `--preload` plugin pattern (here: a worker
 * subprocess that does the import and reports back). If the import path
 * calls `readFileSync`, the test fails — which is the contract every
 * persona must obey.
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('persona registry import — no fs at module-eval', () => {
  it('importing `personas` performs zero readFileSync calls', () => {
    // Run a child process that wraps `fs.readFileSync` (and friends)
    // before the registry import, then imports it. The wrapper records
    // every call; we assert the count is zero. A child process is the
    // only way to guarantee a fresh module graph — Bun caches module
    // evaluation across `import()` calls in the parent.
    const probeScript = join(HERE, 'no-fs-at-load.probe.mjs');
    const result = spawnSync('bun', [probeScript], {
      cwd: join(HERE, '..', '..'),
      encoding: 'utf8',
      env: process.env,
    });
    if (result.status !== 0) {
      throw new Error(
        `probe subprocess failed (exit=${result.status}): stderr=${result.stderr.trim()} stdout=${result.stdout.trim()}`
      );
    }
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    const json = lines.at(-1);
    if (json === undefined) {
      throw new Error(
        `probe subprocess produced no output. stdout=${result.stdout} stderr=${result.stderr}`
      );
    }
    const report = JSON.parse(json) as { calls: string[]; personaCount: number };

    expect(report.calls).toEqual([]);
    // Sanity check that the import actually happened.
    expect(report.personaCount).toBeGreaterThan(0);
  });

  it('field access still returns the expected raw fixture contents', async () => {
    // Direct in-process import — proves the cached getters return the
    // original bytes (not the base64 encoding by accident).
    const { personas } = await import('./index.js');
    const ipod5g = personas.get('ipod-video-5g-iflash-1tb');
    expect(ipod5g).toBeDefined();
    if (ipod5g === undefined) return;

    const xml = ipod5g.sysInfoExtendedXml;
    expect(typeof xml).toBe('string');
    expect(xml).not.toBeNull();
    // SIE payloads are XML plist; check the canonical opening line.
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<plist');

    // Repeated access returns the same string instance — getter caches.
    const xml2 = ipod5g.sysInfoExtendedXml;
    expect(xml2).toBe(xml);

    // JSON fields parse correctly.
    const sp = ipod5g.systemProfilerJson;
    expect(typeof sp).toBe('object');
    expect(sp).not.toBeNull();
    // Cached: same reference on the next read.
    const sp2 = ipod5g.systemProfilerJson;
    expect(sp2).toBe(sp);
  });
});

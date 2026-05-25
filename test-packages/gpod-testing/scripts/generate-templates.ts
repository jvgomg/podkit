#!/usr/bin/env bun
/**
 * Generate pre-built iPod database templates for fast test setup.
 *
 * For each model in TEMPLATE_MODELS, runs `gpod-tool init` once into
 * `test-packages/gpod-testing/templates/<MODEL>/`. createTestIpod() then uses
 * fs.cp from these templates instead of spawning a subprocess per call.
 *
 * Templates are deterministic (HashInfo derived from a fixed firewire_id)
 * so output is byte-stable across machines.
 *
 * Run via:
 *   bun run generate-templates              # local
 *   bun turbo generate-templates --filter=@podkit/gpod-testing
 */

import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../src/gpod-tool';
import { TEMPLATE_MODELS } from '../src/templates';
import { TEST_FIREWIRE_GUID } from '../src/test-ipod';

const here = dirname(fileURLToPath(import.meta.url));
const templatesRoot = resolve(here, '..', 'templates');

async function generate(): Promise<void> {
  await rm(templatesRoot, { recursive: true, force: true });
  await mkdir(templatesRoot, { recursive: true });

  console.log(`Generating ${TEMPLATE_MODELS.length} iPod templates → ${templatesRoot}`);

  for (const model of TEMPLATE_MODELS) {
    const dest = resolve(templatesRoot, model);
    await mkdir(dest, { recursive: true });
    const start = performance.now();
    await init(dest, {
      model,
      name: 'Test iPod',
      firewireId: TEST_FIREWIRE_GUID,
    });
    const ms = (performance.now() - start).toFixed(0);
    console.log(`  ✓ ${model}  (${ms}ms)`);
  }

  console.log(`Done.`);
}

generate().catch((err) => {
  console.error('Template generation failed:', err);
  process.exit(1);
});

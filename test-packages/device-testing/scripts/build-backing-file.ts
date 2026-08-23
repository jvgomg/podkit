#!/usr/bin/env bun
/**
 * Standalone driver for `ensureBackingFile` — synthesises FAT32 mass-storage
 * backing images inside the test VM for one or more starter personas.
 *
 * Usage:
 *
 *   bun run build:backing-file              # all personas with synthesis recipe
 *   bun run build:backing-file echo-mini    # one persona
 *   bun run build:backing-file echo-mini ipod-video-5g-iflash-1tb
 *
 * The runner's `prepare()` already invokes `ensureBackingFilesForPersonas` so
 * this script is only needed when developers want to (re-)build the images
 * out-of-band — e.g. when debugging the synthesis recipe, or to confirm the
 * deterministic-bytes claim from the command line.
 *
 * Each persona's image is built inside `podkit-device` (mkfs.vfat is
 * provisioned there) at `/var/device-testing/backing-files/<id>.img`.
 *
 * Deterministic synthesis:
 *
 *   truncate -s <sizeMiB>M <path>
 *   mkfs.vfat --invariant -F 32 -n <label> -I <path>
 *
 * `--invariant` fixes volume ID, creation timestamps, and OEM string — the
 * recipe is the source of truth, the image is its deterministic projection.
 * See `runners/lima-test-vm-backing-files.ts` for the implementation.
 *
 * @module
 */

import { getVm } from '@podkit/lima';
import { personas as defaultPersonas } from '../src/personas/index.js';
import { ensureBackingFile } from '../src/runners/lima-test-vm-backing-files.js';

const VM_NAME = process.env['PODKIT_DEVICE_HARNESS_VM_NAME'] ?? getVm('device').instanceName;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const requestedIds = argv.filter((a) => !a.startsWith('-'));

  // Collect every persona with a synthesis recipe (matches the runner's
  // prepare() filter). Then narrow by the user-supplied id list when one
  // is given.
  const synthesisable = [...defaultPersonas.values()].filter(
    (p) => p.massStorageBackingFile?.synthesis !== undefined
  );

  const personasToBuild =
    requestedIds.length === 0
      ? synthesisable
      : synthesisable.filter((p) => requestedIds.includes(p.id));

  if (requestedIds.length > 0) {
    const knownIds = new Set(synthesisable.map((p) => p.id));
    const unknown = requestedIds.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      console.error(
        `ERROR: no synthesis recipe for: ${unknown.join(', ')}\n` +
          `       known synthesisable personas: ${[...knownIds].join(', ')}`
      );
      process.exit(1);
    }
  }

  if (personasToBuild.length === 0) {
    console.error(
      `ERROR: no personas to build. The registry has no personas with a\n` +
        `       \`massStorageBackingFile.synthesis\` recipe.`
    );
    process.exit(1);
  }

  console.log(`==> building ${personasToBuild.length} backing image(s) inside ${VM_NAME}...`);
  for (const persona of personasToBuild) {
    const synth = persona.massStorageBackingFile!.synthesis!;
    console.log(`    ${persona.id}: ${synth.sizeMiB} MiB FAT32 label='${synth.label}'`);
    const result = await ensureBackingFile({ vmName: VM_NAME, persona });
    const tag = result.wasAlreadyIdentical ? 'unchanged' : 'rebuilt';
    console.log(`      → ${result.vmPath} sha256=${result.sha256.slice(0, 16)}… (${tag})`);
  }
  console.log(`==> done.`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`ERROR: ${msg}`);
  process.exit(1);
});

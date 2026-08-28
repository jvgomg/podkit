/**
 * VM verification: `synthesis.initialContent` seeding into FAT32 backing
 * images.
 *
 * Two personas declare `initialContent` and depend on the runner copying their
 * fixtures into the post-`mkfs.vfat` image:
 *
 *   - `echo-mini-populated` — five 64-byte sentinel tracks at `Music/track-0N.mp3`
 *   - `ipod-video-5g-corrupt-db` — 512-byte truncated iTunesDB at
 *     `iPod_Control/iTunes/iTunesDB`
 *
 * For each persona, this suite:
 *
 *   1. Calls `ensureBackingFile` to synthesise the image inside the VM.
 *   2. Loop-mounts the resulting image read-only.
 *   3. Asserts the expected files exist and `sha256sum`s them inside the
 *      mount, comparing to a sha256 computed locally on the host fixture.
 *      sha256 equality proves the in-image bytes match the host fixture
 *      (the mtools `-m`-free / `SOURCE_DATE_EPOCH` path preserves content
 *      verbatim).
 *   4. Unmounts.
 *
 * A separate `it` re-runs `ensureBackingFile` for `echo-mini-populated` and
 * checks the post-seed sha256 is byte-identical across runs — the determinism
 * tripwire for mtools (`mkfs.vfat --invariant` alone is not enough; mtools
 * would otherwise embed a current-time directory timestamp).
 *
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { LIMA_DEVICE_HARNESS_VM_NAME, limaTestVmRunner } from '../runners/lima-test-vm.js';
import { ensureBackingFile, personasRoot } from '../runners/lima-test-vm-backing-files.js';
import { echoMiniPopulated, ipodVideo5gCorruptDb } from '../personas/index.js';
import type { DevicePersona } from '../personas/types.js';
import { VM_COLD_TIMEOUT_MS, VM_WARM_TIMEOUT_MS } from './vm-runtime-setup.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VM_NAME = LIMA_DEVICE_HARNESS_VM_NAME;

interface VmResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function vm(cmd: string, timeoutMs: number = VM_WARM_TIMEOUT_MS): Promise<VmResult> {
  return limaTestVmRunner.run(cmd, { timeoutMs });
}

/** POSIX single-quote a string for safe shell embedding. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Compute sha256(hex) for a host file. */
function sha256OfHostFile(absPath: string): string {
  const bytes = fs.readFileSync(absPath);
  return createHash('sha256').update(bytes).digest('hex');
}

/** Mountpoint helper — deterministic per persona so cleanup is targetable. */
function mountPointFor(personaId: string): string {
  return `/mnt/seed-verify-${personaId}`;
}

/**
 * Mount `vmImagePath` read-only inside the VM, run `body`, then unmount no
 * matter what. The mountpoint is created/removed by this helper so callers
 * see a clean VM after every invocation.
 */
async function withReadOnlyMount<T>(
  personaId: string,
  vmImagePath: string,
  body: (mountPoint: string) => Promise<T>
): Promise<T> {
  const mountPoint = mountPointFor(personaId);
  await vm(`sudo mkdir -p ${shQuote(mountPoint)}`);
  const mount = await vm(`sudo mount -o loop,ro ${shQuote(vmImagePath)} ${shQuote(mountPoint)}`);
  if (mount.exitCode !== 0) {
    throw new Error(
      `mount failed for ${vmImagePath} → ${mountPoint}: exit=${mount.exitCode} stderr=${mount.stderr}`
    );
  }
  try {
    return await body(mountPoint);
  } finally {
    await vm(`sudo umount ${shQuote(mountPoint)} 2>/dev/null || true`);
    await vm(`sudo rmdir ${shQuote(mountPoint)} 2>/dev/null || true`);
  }
}

/**
 * Definition of one persona's seeded files, used by both verification cases.
 * `imagePath` is the in-image absolute path (the mountpoint prefix is added
 * by the test), `hostFixture` is the persona-relative `sourceFixture` value.
 */
interface SeedExpectation {
  persona: DevicePersona;
  files: Array<{
    /** Path inside the mounted image, with leading '/'. */
    imagePath: string;
    /** Persona-relative host fixture (matches the persona's sourceFixture). */
    hostFixture: string;
  }>;
}

const EXPECTATIONS: SeedExpectation[] = [
  {
    persona: echoMiniPopulated,
    files: [
      { imagePath: '/Music/track-01.mp3', hostFixture: './raw/track-01.mp3' },
      { imagePath: '/Music/track-02.mp3', hostFixture: './raw/track-02.mp3' },
      { imagePath: '/Music/track-03.mp3', hostFixture: './raw/track-03.mp3' },
      { imagePath: '/Music/track-04.mp3', hostFixture: './raw/track-04.mp3' },
      { imagePath: '/Music/track-05.mp3', hostFixture: './raw/track-05.mp3' },
    ],
  },
  {
    persona: ipodVideo5gCorruptDb,
    files: [{ imagePath: '/iPod_Control/iTunes/iTunesDB', hostFixture: './raw/iTunesDB' }],
  },
];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('VM: initialContent seeding for FAT32 backing files', () => {
  beforeAll(async () => {
    // Boot the VM + transfer binaries. Idempotent.
    await limaTestVmRunner.prepare();
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  for (const expectation of EXPECTATIONS) {
    const { persona, files } = expectation;

    it(
      `seeds ${persona.id} backing image with declared initialContent`,
      async () => {
        const result = await ensureBackingFile({
          vmName: VM_NAME,
          persona,
          computeSha256: true,
        });
        expect(result.personaId).toBe(persona.id);
        expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);

        await withReadOnlyMount(persona.id, result.vmPath, async (mount) => {
          for (const file of files) {
            const inImage = `${mount}${file.imagePath}`;
            const stat = await vm(`test -f ${shQuote(inImage)} && echo present || echo absent`);
            expect(stat.exitCode).toBe(0);
            expect(stat.stdout.trim()).toBe('present');

            const sumInVm = await vm(`sha256sum ${shQuote(inImage)} | awk '{print $1}'`);
            expect(sumInVm.exitCode).toBe(0);
            const inImageSha = sumInVm.stdout.trim();

            const hostFixtureAbs = path.resolve(personasRoot(), persona.id, file.hostFixture);
            const hostSha = sha256OfHostFile(hostFixtureAbs);
            expect(inImageSha).toBe(hostSha);
          }
        });
      },
      VM_WARM_TIMEOUT_MS * 3
    );
  }

  it(
    'produces byte-identical sha256 across two synthesise+seed runs (determinism)',
    async () => {
      const first = await ensureBackingFile({
        vmName: VM_NAME,
        persona: echoMiniPopulated,
        computeSha256: true,
      });
      // Sleep a couple seconds so the VM clock advances past any mtools
      // default-timestamp granularity (FAT entries store 2-second precision).
      // If determinism were broken, the second sha would differ from the first.
      await new Promise<void>((resolve) => setTimeout(resolve, 2500));
      const second = await ensureBackingFile({
        vmName: VM_NAME,
        persona: echoMiniPopulated,
        computeSha256: true,
      });
      expect(second.sha256).toBe(first.sha256);
      expect(second.sha256).not.toBeNull();
    },
    VM_WARM_TIMEOUT_MS * 3
  );
});

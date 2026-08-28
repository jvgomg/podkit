/**
 * Unit tests for `ensureBackingFile` + `ensureBackingFilesForPersonas`.
 *
 * Strategy: same scripted-subprocess pattern as `lima-test-vm.test.ts`. We
 * assert that `limactl shell` is called with the expected synthesis script
 * and that the helper validates its inputs (size, label, filesystem).
 */

import { describe, it, expect } from 'bun:test';

import {
  ensureBackingFile,
  ensureBackingFilesForPersonas,
  imageWorkTimeoutMs,
  vmPathForPersona,
  BACKING_FILES_VM_DIR,
  VM_ROUND_TRIP_TIMEOUT_MS,
} from './lima-test-vm-backing-files.js';
import type { DevicePersona } from '../personas/types.js';
import type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult } from '../subprocess.js';

interface ScriptedCall {
  command: string;
  args: string[];
  opts?: SubprocessRunOpts;
}

function makeScriptedRunner(script: (SubprocessRunResult | Error)[]): {
  runner: SubprocessRunner;
  calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  let i = 0;
  return {
    calls,
    runner: {
      async run(command, args, opts) {
        calls.push({ command, args, opts });
        const r = script[i++];
        if (r === undefined) {
          throw new Error(`scripted runner exhausted at call ${i}: ${command} ${args.join(' ')}`);
        }
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

const ok = (stdout = ''): SubprocessRunResult => ({ stdout, stderr: '', exitCode: 0 });
const fail = (code: number, stderr: string): SubprocessRunResult => ({
  stdout: '',
  stderr,
  exitCode: code,
});

// 64-char hex sha256, used as canned synthesis output
const SHA = 'a'.repeat(64);

/** Canned `stat -c %s` output for a `sizeMiB` image (the build script's first line). */
const sizeLine = (sizeMiB: number): string => `${sizeMiB * 1024 * 1024}\n`;

function makePersona(overrides: Partial<DevicePersona> = {}): DevicePersona {
  return {
    id: 'echo-mini',
    description: 'test',
    schemaVersion: 3,
    usbDescriptor: {
      vendorId: 0x071b,
      productId: 0x3203,
      deviceSerial: 'TEST',
      deviceClass: 0,
      deviceSubclass: 0,
      deviceProtocol: 0,
      bMaxPacketSize0: 64,
      bcdUSB: 0x0200,
      bcdDevice: 0x0200,
      bNumConfigurations: 1,
      configurations: [
        {
          bConfigurationValue: 1,
          bNumInterfaces: 1,
          bmAttributes: 0x80,
          bMaxPower: 0xfa,
          interfaces: [
            {
              bInterfaceNumber: 0,
              bAlternateSetting: 0,
              bInterfaceClass: 0x08,
              bInterfaceSubClass: 0x06,
              bInterfaceProtocol: 0x50,
              endpoints: [],
            },
          ],
        },
      ],
      stringDescriptors: {},
    },
    sysInfoExtendedXml: null,
    lsblkJson: null,
    systemProfilerJson: null,
    diskutilPlist: null,
    partitionLayout: { luns: [{ lun: 0, partitions: [] }] },
    massStorageBackingFile: {
      synthesis: { sizeMiB: 64, filesystem: 'FAT32', label: 'ECHO_MINI' },
      resetStrategy: 'copy',
    },
    provenance: { provenanceDoc: '', source: 'physical-capture' },
    ...overrides,
  };
}

describe('vmPathForPersona', () => {
  it('produces a path under BACKING_FILES_VM_DIR', () => {
    expect(vmPathForPersona('echo-mini')).toBe(`${BACKING_FILES_VM_DIR}/echo-mini.img`);
  });

  it('rejects ids with shell metacharacters', () => {
    expect(() => vmPathForPersona('echo mini')).toThrow(/persona id/);
    expect(() => vmPathForPersona('echo/mini')).toThrow(/persona id/);
    expect(() => vmPathForPersona('echo;rm')).toThrow(/persona id/);
    expect(() => vmPathForPersona('')).toThrow(/persona id/);
  });

  it('allows lowercase, digits, hyphen', () => {
    expect(vmPathForPersona('ipod-video-5g-iflash-1tb')).toBe(
      `${BACKING_FILES_VM_DIR}/ipod-video-5g-iflash-1tb.img`
    );
  });
});

describe('ensureBackingFile', () => {
  it('invokes limactl shell with the deterministic synthesis script', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok(sizeLine(64)), // build script reports the finished image size
    ]);
    const result = await ensureBackingFile({
      vmName: 'podkit-device',
      persona: makePersona(),
      subprocess: runner,
    });
    expect(result).toEqual({
      personaId: 'echo-mini',
      vmPath: `${BACKING_FILES_VM_DIR}/echo-mini.img`,
      sizeBytes: 64 * 1024 * 1024,
      sha256: null,
      wasAlreadyIdentical: null,
    });

    // One call only: no hash was asked for, so nothing probed the image.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('limactl');
    expect(calls[0]!.args[0]).toBe('shell');
    expect(calls[0]!.args[1]).toBe('podkit-device');

    // Build call: the script should mention truncate, mkfs.vfat --invariant,
    // and the label — and report the size rather than hashing.
    const buildScript = calls[0]!.args.join(' ');
    expect(buildScript).toContain('truncate -s 64M');
    expect(buildScript).toContain('mkfs.vfat --invariant -F 32');
    expect(buildScript).toContain("'ECHO_MINI'");
    expect(buildScript).toContain(`${BACKING_FILES_VM_DIR}/echo-mini.img`);
    expect(buildScript).toContain('stat -c %s');
    expect(buildScript).not.toContain('sha256sum');
  });

  it('bounds the build on the image size so a wedged session cannot hang the caller', async () => {
    const { runner, calls } = makeScriptedRunner([ok(sizeLine(64))]);
    await ensureBackingFile({
      vmName: 'podkit-device',
      persona: makePersona(),
      subprocess: runner,
    });
    expect(calls[0]!.opts?.timeoutMs).toBe(imageWorkTimeoutMs(64));
  });

  it('bounds the sha256 probe on the image size', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok('absent'), // probe
      ok(sizeLine(64) + SHA + '\n'), // build: size then sha
    ]);
    await ensureBackingFile({
      vmName: 'podkit-device',
      persona: makePersona(),
      computeSha256: true,
      subprocess: runner,
    });
    expect(calls[0]!.args.join(' ')).toContain('sha256sum');
    expect(calls[0]!.opts?.timeoutMs).toBe(imageWorkTimeoutMs(64));
  });

  it('hashes only when asked, and then reports both size and digest', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok('absent'), // probe: file missing
      ok(sizeLine(64) + SHA + '\n'),
    ]);
    const result = await ensureBackingFile({
      vmName: 'podkit-device',
      persona: makePersona(),
      computeSha256: true,
      subprocess: runner,
    });
    expect(result.sha256).toBe(SHA);
    expect(result.sizeBytes).toBe(64 * 1024 * 1024);
    expect(result.wasAlreadyIdentical).toBe(false);
    expect(calls[1]!.args.join(' ')).toContain('sha256sum');
  });

  it('reports wasAlreadyIdentical=true when the existing sha256 matches the rebuild output', async () => {
    const { runner } = makeScriptedRunner([
      ok(SHA + '\n'), // probe: pre-existing
      ok(sizeLine(64) + SHA + '\n'), // build: same sha
    ]);
    const result = await ensureBackingFile({
      vmName: 'podkit-device',
      persona: makePersona(),
      computeSha256: true,
      subprocess: runner,
    });
    expect(result.wasAlreadyIdentical).toBe(true);
    expect(result.sha256).toBe(SHA);
  });

  it('rejects a build whose image is not the size the recipe declared', async () => {
    const { runner } = makeScriptedRunner([ok(sizeLine(32))]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-device',
        persona: makePersona(),
        subprocess: runner,
      })
    ).rejects.toThrow(/produced 33554432 bytes, expected 67108864/);
  });

  it('throws when persona has no massStorageBackingFile', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-device',
        persona: makePersona({ massStorageBackingFile: null }),
        subprocess: runner,
      })
    ).rejects.toThrow(/has no massStorageBackingFile/);
  });

  it('throws when persona has no synthesis recipe (only imagePath)', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-device',
        persona: makePersona({
          massStorageBackingFile: { imagePath: './foo.img', resetStrategy: 'copy' },
        }),
        subprocess: runner,
      })
    ).rejects.toThrow(/has no synthesis recipe/);
  });

  it('rejects FAT16 (only FAT32 + HFS+ are wired up)', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-device',
        persona: makePersona({
          massStorageBackingFile: {
            synthesis: { sizeMiB: 4, filesystem: 'FAT16', label: 'X' },
            resetStrategy: 'copy',
          },
        }),
        subprocess: runner,
      })
    ).rejects.toThrow(/FAT32.*HFS\+/);
  });

  it('synthesises HFS+ on the HOST + limactl-copies into the VM (no in-VM mkfs)', async () => {
    // 5 scripted calls on the "absent → copy" path:
    //   1. probe sha256 → 'absent'
    //   2. mkdir BACKING_FILES_VM_DIR
    //   3. limactl copy host → vm /tmp staging file
    //   4. sudo install staging → canonical vmPath
    //   5. rm staging (best-effort, no throw on failure)
    const { runner, calls } = makeScriptedRunner([ok('absent\n'), ok(''), ok(''), ok(''), ok('')]);
    const result = await ensureBackingFile({
      vmName: 'podkit-device',
      persona: makePersona({
        id: 'ipod-hfsplus',
        massStorageBackingFile: {
          synthesis: { sizeMiB: 2, filesystem: 'HFS+', label: 'IPOD_HFS' },
          resetStrategy: 'copy',
        },
      }),
      subprocess: runner,
    });
    expect(result.personaId).toBe('ipod-hfsplus');
    // sha256 is computed on the host over the just-written image — assert
    // it's a real digest, not anything synthesised by the scripted runner.
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.wasAlreadyIdentical).toBe(false);

    // No call carries mkfs.hfsplus / mkfs.vfat — the HFS+ branch never
    // invokes a userspace mkfs; the volume header is written from TS.
    for (const call of calls) {
      const joined = call.args.join(' ');
      expect(joined).not.toContain('mkfs.hfsplus');
      expect(joined).not.toContain('mkfs.vfat');
    }
    // The copy call (call #3) carries the host→VM transfer.
    expect(calls[2]!.args[0]).toBe('copy');
    expect(calls[2]!.args[2]).toContain('podkit-device:/tmp/hfsplus-');

    // Every call is bounded: the size-derived bound on the ones that move or
    // read the whole image, the flat round-trip bound on `mkdir` and `rm`.
    expect(calls[0]!.opts?.timeoutMs).toBe(imageWorkTimeoutMs(2)); // probe
    expect(calls[1]!.opts?.timeoutMs).toBe(VM_ROUND_TRIP_TIMEOUT_MS); // mkdir -p
    expect(calls[3]!.opts?.timeoutMs).toBe(imageWorkTimeoutMs(2)); // install
    expect(calls[4]!.opts?.timeoutMs).toBe(VM_ROUND_TRIP_TIMEOUT_MS); // rm staging
    for (const call of calls) {
      expect(typeof call.opts?.timeoutMs).toBe('number');
    }
  });

  it('skips the limactl copy when the VM already has the byte-identical HFS+ image', async () => {
    // First scripted call returns the same sha256 the host-side writer will
    // produce. We can't pre-compute that here without coupling the test to
    // implementation; instead, run the helper twice: the first call seeds
    // the cache, the second call short-circuits.
    const { runner: firstRunner } = makeScriptedRunner([
      ok('absent\n'),
      ok(''),
      ok(''),
      ok(''),
      ok(''),
    ]);
    const first = await ensureBackingFile({
      vmName: 'podkit-device',
      persona: makePersona({
        id: 'ipod-hfsplus-cache',
        massStorageBackingFile: {
          synthesis: { sizeMiB: 2, filesystem: 'HFS+', label: 'X' },
          resetStrategy: 'copy',
        },
      }),
      subprocess: firstRunner,
    });

    // Second invocation — probe returns the matching sha256, so the helper
    // must NOT issue mkdir / copy / install / rm. Single scripted response.
    const { runner: secondRunner, calls: secondCalls } = makeScriptedRunner([
      ok(`${first.sha256 ?? ''}\n`),
    ]);
    const second = await ensureBackingFile({
      vmName: 'podkit-device',
      persona: makePersona({
        id: 'ipod-hfsplus-cache',
        massStorageBackingFile: {
          synthesis: { sizeMiB: 2, filesystem: 'HFS+', label: 'X' },
          resetStrategy: 'copy',
        },
      }),
      subprocess: secondRunner,
    });
    expect(second.sha256).toBe(first.sha256);
    expect(second.wasAlreadyIdentical).toBe(true);
    expect(secondCalls.length).toBe(1);
  });

  it('accepts non-FAT-safe labels on HFS+ personas (the HFS+ writer ignores label)', async () => {
    // FAT requires uppercase A-Z / digits / underscore / hyphen — `'My iPod'`
    // contains a space and lowercase letters and would be rejected by
    // validateFatLabel. HFS+ has no such constraint and the writer ignores
    // the label entirely, so the FAT validator must not fire here.
    const { runner } = makeScriptedRunner([ok('absent\n'), ok(''), ok(''), ok(''), ok('')]);
    const result = await ensureBackingFile({
      vmName: 'podkit-device',
      persona: makePersona({
        id: 'ipod-hfsplus-spaced-label',
        massStorageBackingFile: {
          synthesis: { sizeMiB: 2, filesystem: 'HFS+', label: 'My iPod' },
          resetStrategy: 'copy',
        },
      }),
      subprocess: runner,
    });
    expect(result.personaId).toBe('ipod-hfsplus-spaced-label');
  });

  it('rejects HFS+ + initialContent (seeding is FAT-only via mtools)', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-device',
        persona: makePersona({
          massStorageBackingFile: {
            synthesis: {
              sizeMiB: 32,
              filesystem: 'HFS+',
              label: 'IPOD_HFS',
              initialContent: [{ path: 'foo', sourceFixture: './raw/foo' }],
            },
            resetStrategy: 'copy',
          },
        }),
        subprocess: runner,
      })
    ).rejects.toThrow(/HFS\+/);
  });

  it('rejects non-positive sizeMiB', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-device',
        persona: makePersona({
          massStorageBackingFile: {
            synthesis: { sizeMiB: 0, filesystem: 'FAT32', label: 'X' },
            resetStrategy: 'copy',
          },
        }),
        subprocess: runner,
      })
    ).rejects.toThrow(/sizeMiB/);
  });

  it('rejects labels that exceed 11 chars', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-device',
        persona: makePersona({
          massStorageBackingFile: {
            synthesis: { sizeMiB: 1, filesystem: 'FAT32', label: 'TOO_LONG_LABEL' },
            resetStrategy: 'copy',
          },
        }),
        subprocess: runner,
      })
    ).rejects.toThrow(/11 chars/);
  });

  it('rejects labels with disallowed characters', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-device',
        persona: makePersona({
          massStorageBackingFile: {
            synthesis: { sizeMiB: 1, filesystem: 'FAT32', label: 'Bad Label' },
            resetStrategy: 'copy',
          },
        }),
        subprocess: runner,
      })
    ).rejects.toThrow(/[A-Z0-9_-]/);
  });

  it('surfaces a descriptive error on a non-zero build exit', async () => {
    const { runner } = makeScriptedRunner([fail(1, 'mkfs.vfat: command not found')]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-device',
        persona: makePersona(),
        subprocess: runner,
      })
    ).rejects.toThrow(/synthesise backing file/);
  });

  it("throws when the build script's stdout isn't a size", async () => {
    const { runner } = makeScriptedRunner([ok('not-a-size\n')]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-device',
        persona: makePersona(),
        subprocess: runner,
      })
    ).rejects.toThrow(/non-numeric size/);
  });

  it("throws when a requested digest isn't a sha256", async () => {
    const { runner } = makeScriptedRunner([ok('absent'), ok(sizeLine(64) + 'not-a-sha\n')]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-device',
        persona: makePersona(),
        computeSha256: true,
        subprocess: runner,
      })
    ).rejects.toThrow(/non-sha256/);
  });

  it('requires vmName', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      ensureBackingFile({
        vmName: '',
        persona: makePersona(),
        subprocess: runner,
      })
    ).rejects.toThrow(/vmName/);
  });
});

describe('ensureBackingFilesForPersonas', () => {
  it('returns an empty map for an empty persona list', async () => {
    const { runner, calls } = makeScriptedRunner([]);
    const result = await ensureBackingFilesForPersonas({
      vmName: 'podkit-device',
      personas: [],
      subprocess: runner,
    });
    expect(result.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('skips personas without massStorageBackingFile', async () => {
    const { runner, calls } = makeScriptedRunner([]);
    const result = await ensureBackingFilesForPersonas({
      vmName: 'podkit-device',
      personas: [makePersona({ id: 'no-backing', massStorageBackingFile: null })],
      subprocess: runner,
    });
    expect(result.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('skips personas with only imagePath (pre-built)', async () => {
    const { runner, calls } = makeScriptedRunner([]);
    const result = await ensureBackingFilesForPersonas({
      vmName: 'podkit-device',
      personas: [
        makePersona({
          id: 'prebuilt',
          massStorageBackingFile: { imagePath: './foo.img', resetStrategy: 'copy' },
        }),
      ],
      subprocess: runner,
    });
    expect(result.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('synthesises every persona with a synthesis recipe and returns a vmPath map', async () => {
    // One call per persona: the batch path asks for no digests, so neither
    // the pre-build probe nor the post-build hash is issued.
    const { runner, calls } = makeScriptedRunner([ok(sizeLine(64)), ok(sizeLine(128))]);
    const result = await ensureBackingFilesForPersonas({
      vmName: 'podkit-device',
      personas: [
        makePersona({ id: 'one' }),
        makePersona({
          id: 'two',
          massStorageBackingFile: {
            synthesis: { sizeMiB: 128, filesystem: 'FAT32', label: 'TWO' },
            resetStrategy: 'copy',
          },
        }),
      ],
      subprocess: runner,
    });
    expect([...result.entries()]).toEqual([
      ['one', `${BACKING_FILES_VM_DIR}/one.img`],
      ['two', `${BACKING_FILES_VM_DIR}/two.img`],
    ]);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.args.join(' ')).not.toContain('sha256sum');
    }
  });
});

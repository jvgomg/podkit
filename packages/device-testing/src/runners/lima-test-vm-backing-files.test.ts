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
  vmPathForPersona,
  BACKING_FILES_VM_DIR,
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

function makePersona(overrides: Partial<DevicePersona> = {}): DevicePersona {
  return {
    id: 'echo-mini',
    description: 'test',
    schemaVersion: 2,
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
    expectedCapabilities: null,
    expectedReadiness: { level: 'ready', stages: [] },
    expectedDoctorOutput: {},
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
      ok('absent'), // probe: file missing
      ok(SHA + '\n'), // build script returns sha256
    ]);
    const result = await ensureBackingFile({
      vmName: 'podkit-test-vm',
      persona: makePersona(),
      subprocess: runner,
    });
    expect(result).toEqual({
      personaId: 'echo-mini',
      vmPath: `${BACKING_FILES_VM_DIR}/echo-mini.img`,
      sha256: SHA,
      wasAlreadyIdentical: false,
    });

    // Probe call shape
    expect(calls[0]!.command).toBe('limactl');
    expect(calls[0]!.args[0]).toBe('shell');
    expect(calls[0]!.args[1]).toBe('podkit-test-vm');

    // Build call: the script should mention truncate, mkfs.vfat --invariant,
    // and the label.
    const buildScript = calls[1]!.args.join(' ');
    expect(buildScript).toContain('truncate -s 64M');
    expect(buildScript).toContain('mkfs.vfat --invariant -F 32');
    expect(buildScript).toContain("'ECHO_MINI'");
    expect(buildScript).toContain(`${BACKING_FILES_VM_DIR}/echo-mini.img`);
  });

  it('reports wasAlreadyIdentical=true when the existing sha256 matches the rebuild output', async () => {
    const { runner } = makeScriptedRunner([
      ok(SHA + '\n'), // probe: pre-existing
      ok(SHA + '\n'), // build: same sha
    ]);
    const result = await ensureBackingFile({
      vmName: 'podkit-test-vm',
      persona: makePersona(),
      subprocess: runner,
    });
    expect(result.wasAlreadyIdentical).toBe(true);
    expect(result.sha256).toBe(SHA);
  });

  it('throws when persona has no massStorageBackingFile', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-test-vm',
        persona: makePersona({ massStorageBackingFile: null }),
        subprocess: runner,
      })
    ).rejects.toThrow(/has no massStorageBackingFile/);
  });

  it('throws when persona has no synthesis recipe (only imagePath)', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-test-vm',
        persona: makePersona({
          massStorageBackingFile: { imagePath: './foo.img', resetStrategy: 'copy' },
        }),
        subprocess: runner,
      })
    ).rejects.toThrow(/has no synthesis recipe/);
  });

  it('rejects FAT16 (only FAT32 is wired up)', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-test-vm',
        persona: makePersona({
          massStorageBackingFile: {
            synthesis: { sizeMiB: 4, filesystem: 'FAT16', label: 'X' },
            resetStrategy: 'copy',
          },
        }),
        subprocess: runner,
      })
    ).rejects.toThrow(/FAT32/);
  });

  it('rejects non-positive sizeMiB', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-test-vm',
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
        vmName: 'podkit-test-vm',
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
        vmName: 'podkit-test-vm',
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
    const { runner } = makeScriptedRunner([
      ok('absent'), // probe
      fail(1, 'mkfs.vfat: command not found'),
    ]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-test-vm',
        persona: makePersona(),
        subprocess: runner,
      })
    ).rejects.toThrow(/synthesise backing file/);
  });

  it("throws when the build script's stdout isn't a sha256", async () => {
    const { runner } = makeScriptedRunner([ok('absent'), ok('not-a-sha\n')]);
    await expect(
      ensureBackingFile({
        vmName: 'podkit-test-vm',
        persona: makePersona(),
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
      vmName: 'podkit-test-vm',
      personas: [],
      subprocess: runner,
    });
    expect(result.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('skips personas without massStorageBackingFile', async () => {
    const { runner, calls } = makeScriptedRunner([]);
    const result = await ensureBackingFilesForPersonas({
      vmName: 'podkit-test-vm',
      personas: [makePersona({ id: 'no-backing', massStorageBackingFile: null })],
      subprocess: runner,
    });
    expect(result.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('skips personas with only imagePath (pre-built)', async () => {
    const { runner, calls } = makeScriptedRunner([]);
    const result = await ensureBackingFilesForPersonas({
      vmName: 'podkit-test-vm',
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
    const { runner } = makeScriptedRunner([
      ok('absent'),
      ok(SHA + '\n'),
      ok('absent'),
      ok('b'.repeat(64) + '\n'),
    ]);
    const result = await ensureBackingFilesForPersonas({
      vmName: 'podkit-test-vm',
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
  });
});

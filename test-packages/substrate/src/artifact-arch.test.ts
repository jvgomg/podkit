/**
 * Unit tests for the artifact-vs-substrate architecture assertion.
 *
 * The case that matters is the one an arm64 Mac cannot produce by accident: an
 * x86_64 ELF about to be installed on an aarch64 substrate. Both halves are
 * parameters here — the bytes and the substrate's machine type — so the
 * mismatch is reachable without either machine existing.
 */

import { describe, it, expect } from 'bun:test';

import {
  ArtifactArchMismatchError,
  assertArtifactArch,
  readElfTargetArch,
} from './artifact-arch.js';
import { TargetArchError } from './target-arch.js';

/**
 * A minimal 64-byte ELF64 header with the given `e_machine`. Real enough for
 * the only field anything here reads, and deliberately synthesised rather than
 * checked in: a fixture binary would be a megabyte of bytes to assert two of.
 */
function elfHeader(eMachine: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46], 0); // \x7fELF
  bytes[4] = 2; // ELFCLASS64
  bytes[5] = 1; // ELFDATA2LSB
  bytes[6] = 1; // EV_CURRENT
  bytes[16] = 2; // ET_EXEC
  bytes[0x12] = eMachine & 0xff;
  bytes[0x13] = (eMachine >> 8) & 0xff;
  return bytes;
}

const X86_64_ELF = elfHeader(0x3e);
const AARCH64_ELF = elfHeader(0xb7);

describe('readElfTargetArch', () => {
  it('reads e_machine for both architectures this repo builds for', () => {
    expect(readElfTargetArch(X86_64_ELF)).toBe('x64');
    expect(readElfTargetArch(AARCH64_ELF)).toBe('arm64');
  });

  it('returns null for anything that is not one of them', () => {
    expect(readElfTargetArch(elfHeader(0xf3))).toBeNull(); // EM_RISCV
    expect(readElfTargetArch(new TextEncoder().encode('#!/bin/sh\necho hi\n'))).toBeNull();
    expect(readElfTargetArch(new Uint8Array(0))).toBeNull();
    // A Mach-O — what a host-native `bun build --compile` on macOS produces,
    // and the artifact most likely to reach a transfer by mistake.
    expect(readElfTargetArch(new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1]))).toBeNull();
  });

  it('does not read past the end of a truncated header', () => {
    expect(readElfTargetArch(X86_64_ELF.slice(0, 8))).toBeNull();
  });
});

describe('assertArtifactArch', () => {
  const base = {
    artifactPath: '/repo/packages/podkit-cli/bin/podkit-linux-x64',
    substrateDescription: 'Lima instance `podkit-device`',
    label: 'podkit binary',
  };

  it('passes when the artifact matches the substrate', () => {
    expect(() =>
      assertArtifactArch({ ...base, bytes: AARCH64_ELF, substrateMachine: 'aarch64' })
    ).not.toThrow();
    expect(() =>
      assertArtifactArch({ ...base, bytes: X86_64_ELF, substrateMachine: 'x86_64' })
    ).not.toThrow();
  });

  it('names both architectures when they differ', () => {
    let caught: unknown;
    try {
      assertArtifactArch({ ...base, bytes: X86_64_ELF, substrateMachine: 'aarch64' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ArtifactArchMismatchError);
    const message = (caught as Error).message;
    // Both sides and the file, because "arch mismatch" alone sends the reader
    // to the wrong half.
    expect(message).toContain('linux-x64');
    expect(message).toContain('aarch64');
    expect(message).toContain(base.artifactPath);
    expect(message).toContain('podkit binary');
    // And the symptom it is standing in for, so the reader recognises the one
    // they would otherwise have hit mid-run.
    expect(message).toContain('exec format error');
  });

  it('rejects an artifact that is not a Linux ELF at all', () => {
    // The stale-host-build case: `bin/podkit` from a macOS `bun run compile`
    // sitting where the linux artifact was expected.
    expect(() =>
      assertArtifactArch({
        ...base,
        bytes: new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]),
        substrateMachine: 'aarch64',
      })
    ).toThrow(ArtifactArchMismatchError);
  });

  it('reports an unbuildable substrate machine type as such, not as a mismatch', () => {
    // The substrate is the wrong shape, not the artifact. Reporting this as a
    // mismatch would send the reader to rebuild something that was fine.
    expect(() =>
      assertArtifactArch({ ...base, bytes: X86_64_ELF, substrateMachine: 'ppc64le' })
    ).toThrow(TargetArchError);
  });
});

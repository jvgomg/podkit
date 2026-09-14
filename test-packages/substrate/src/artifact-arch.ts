/**
 * Does this artifact's architecture match the substrate about to run it?
 *
 * ## Why this exists at all
 *
 * `./target-arch.ts` makes the target architecture an explicit input, and
 * `turbo.json` hashes it into the cache key of every task that produces a
 * Linux binary. That is the mechanism; this is the backstop for the mechanism
 * being wrong — a task that forgot the declaration, a stale artifact on disk
 * from before a substrate was swapped, a `PODKIT_LINUX_BINARY` override
 * pointing at the wrong download.
 *
 * It earns its place because of what the failure looks like without it. A
 * foreign-arch binary installs perfectly happily: the copy succeeds, the
 * `install -m 0755` succeeds, and the first thing that goes wrong is an
 * `exec format error` somewhere in the middle of a test run, attributed to
 * whichever test happened to invoke it first. That sends the reader hunting
 * through the test, then the harness, then the guest — everywhere except the
 * build that produced the bytes. Asserting at the transfer costs one string
 * comparison and names the actual cause.
 *
 * ## Why the ELF header and not the filename
 *
 * The filenames already carry the architecture, which is exactly why they are
 * the wrong thing to check: every failure mode this module guards against
 * produces a correctly-named file with the wrong bytes inside it. `e_machine`
 * is written by the linker and is the only claim about the artifact that the
 * build could not have got wrong while still succeeding.
 *
 * @module
 */

import { normalizeTargetArch, type TargetArch } from './target-arch.js';

/**
 * An artifact's architecture does not match the substrate it was about to be
 * installed on, or the artifact is not a Linux executable at all.
 *
 * Typed and named so the reader lands on the build rather than on the test
 * that first tried to run the binary.
 */
export class ArtifactArchMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactArchMismatchError';
  }
}

/** ELF magic: `\x7fELF`. */
const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46] as const;
/** Offset of `e_machine` in an ELF header, little-endian `Elf64_Half`. */
const E_MACHINE_OFFSET = 0x12;
/** `EM_X86_64`. */
const EM_X86_64 = 0x3e;
/** `EM_AARCH64`. */
const EM_AARCH64 = 0xb7;

/**
 * Read the target architecture out of an ELF header, or `null` when the bytes
 * are not an ELF this repo builds for.
 *
 * Deliberately hand-rolled over the first twenty bytes rather than shelling
 * out to `file(1)`: this runs on the host, on macOS as often as on Linux,
 * inside a transfer that must not depend on what the developer happens to have
 * installed. `e_machine` sits at a fixed offset in both ELF32 and ELF64 and is
 * little-endian for both architectures involved, so there is no class or
 * endianness dance to get wrong.
 */
export function readElfTargetArch(bytes: Uint8Array): TargetArch | null {
  if (bytes.length < E_MACHINE_OFFSET + 2) return null;
  if (!ELF_MAGIC.every((byte, i) => bytes[i] === byte)) return null;

  const machine = bytes[E_MACHINE_OFFSET]! | (bytes[E_MACHINE_OFFSET + 1]! << 8);
  if (machine === EM_X86_64) return 'x64';
  if (machine === EM_AARCH64) return 'arm64';
  return null;
}

/** Inputs to {@link assertArtifactArch}. */
export interface AssertArtifactArchInput {
  /** The artifact's bytes. The caller has already read them to hash them. */
  readonly bytes: Uint8Array;
  /** Host path of the artifact, for the error message. */
  readonly artifactPath: string;
  /** What the substrate reports for `uname -m`. */
  readonly substrateMachine: string;
  /** How the substrate describes itself, for the error message. */
  readonly substrateDescription: string;
  /** Short name of the artifact (`podkit binary`, `gpod-tool`). */
  readonly label: string;
}

/**
 * Assert that an artifact can actually start on a substrate.
 *
 * Pure and synchronous — the caller supplies the substrate's machine type,
 * which it already has to ask for anyway. Every branch, including the
 * cross-architecture one that no single machine can reach naturally, is
 * therefore reachable from a unit test.
 *
 * @throws {ArtifactArchMismatchError} when the artifact is not a Linux ELF, or
 * is one built for a different architecture.
 * @throws {TargetArchError} when the substrate reported a machine type this
 * repo does not build for.
 */
export function assertArtifactArch(input: AssertArtifactArchInput): void {
  const substrateArch = normalizeTargetArch(input.substrateMachine, 'substrate machine type');
  const artifactArch = readElfTargetArch(input.bytes);

  if (artifactArch === null) {
    throw new ArtifactArchMismatchError(
      `${input.label} at ${input.artifactPath} is not a Linux ELF executable for a supported ` +
        `architecture, so it cannot run on ${input.substrateDescription} ` +
        `(${input.substrateMachine}). Rebuild it — a host-native or truncated artifact here ` +
        `would install cleanly and then fail with 'exec format error' mid-run.`
    );
  }

  if (artifactArch !== substrateArch) {
    throw new ArtifactArchMismatchError(
      `${input.label} at ${input.artifactPath} is a linux-${artifactArch} binary, but ` +
        `${input.substrateDescription} is ${input.substrateMachine} (linux-${substrateArch}). ` +
        `Installing it would produce 'exec format error' partway through the run rather than ` +
        `here. Rebuild with the target architecture the substrate reports — the build tasks ` +
        `hash it into their cache key, so a stale cache entry is the usual cause.`
    );
  }
}

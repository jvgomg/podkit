/**
 * Load-time validator for {@link DevicePersona} shape.
 *
 * Surfaces the mechanical constraints documented at
 * `documents/architecture/testing/vm-testing.md` §5 as registry-load errors
 * instead of cryptic kernel timeouts inside the VM. Today three constraints
 * are checked statically:
 *
 *   - §5.1 `description` byte length ≤ {@link MAX_DESCRIPTION_UTF16_BYTES}
 *     when UTF-16-LE encoded. Anything longer overflows the USB string
 *     descriptor `bLength` u8 field, the daemon fails to start with
 *     `EOVERFLOW`, systemd restart-loops, and the test times out with
 *     a misleading "is the daemon binding mass-storage correctly?" error.
 *   - §5.2 `id` length ≤ {@link MAX_ID_ASCII_CHARS} and matches
 *     {@link ID_REGEX}. Longer ids overflow the configfs FunctionFS path
 *     segment cap (`ffs.podkit-<id>` ≤ 40 bytes); illegal characters
 *     break configfs path safety.
 *   - §5.3 `initialContent[].sourceFixture` does NOT contain `..`
 *     segments. The runtime check in `resolveSeedEntries` already
 *     enforces this at synthesis time; surfacing it at load time
 *     fails fast before the VM boots.
 *
 * `validatePersona` is pure — no fs, no env reads — so it runs against
 * any persona literal in any process. Optional fs-side check
 * {@link validateInitialContentExists} lives separately for the registry
 * load loop to catch typoed fixture paths early; that one touches disk.
 *
 * @module
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { DevicePersona } from './types.js';

/**
 * UTF-16-LE byte budget for `persona.description`. The USB string
 * descriptor carries length in a `u8` `bLength` field (max 255); the
 * 2-byte header (`bLength` + `bDescriptorType`) leaves 253 bytes for the
 * body. 252 is the conservative ceiling task-spec'd in TASK-426 (one byte
 * of slack so the kernel writer never lands exactly on the limit).
 */
export const MAX_DESCRIPTION_UTF16_BYTES = 252;

/**
 * ASCII char cap for `persona.id`. The configfs FunctionFS path
 * `ffs.podkit-<id>` has a ~40-byte segment cap; with the 8-byte
 * `ffs.podkit-` prefix that leaves 32 chars for the id itself.
 */
export const MAX_ID_ASCII_CHARS = 32;

/**
 * Allowed character set for `persona.id`. Kebab case (lowercase letters,
 * digits, dash) keeps configfs paths safe and aligns with the existing
 * registry convention.
 */
export const ID_REGEX = /^[a-z0-9-]+$/;

/** Documentation pointer baked into error messages. */
const DOC_REF = 'documents/architecture/testing/vm-testing.md';

/**
 * Validate `persona.description` fits in the USB string descriptor
 * `bLength` field once UTF-16-LE encoded.
 *
 * JS strings are UTF-16; `.length` is the code-unit count, and each code
 * unit is exactly 2 bytes on the wire — no need to actually encode.
 */
export function validateDescription(persona: { id: string; description: string }): void {
  const codeUnits = persona.description.length;
  const byteLen = codeUnits * 2;
  if (byteLen > MAX_DESCRIPTION_UTF16_BYTES) {
    throw new Error(
      `Persona "${persona.id}": description is ${byteLen} bytes UTF-16-LE ` +
        `(${codeUnits} code units), exceeds USB string descriptor budget of ` +
        `${MAX_DESCRIPTION_UTF16_BYTES} bytes. Shorten the description; move ` +
        `long-form context to provenance.md. See ${DOC_REF} §5.1.`
    );
  }
}

/**
 * Validate `persona.id` fits the configfs FunctionFS path segment cap and
 * uses a safe character set.
 */
export function validateId(persona: { id: string }): void {
  if (persona.id.length === 0) {
    throw new Error(`Persona id is empty. See ${DOC_REF} §5.2.`);
  }
  if (persona.id.length > MAX_ID_ASCII_CHARS) {
    throw new Error(
      `Persona "${persona.id}": id length ${persona.id.length} exceeds ` +
        `${MAX_ID_ASCII_CHARS} ASCII chars (configfs FunctionFS path cap on ` +
        `\`ffs.podkit-<id>\`). See ${DOC_REF} §5.2.`
    );
  }
  if (!ID_REGEX.test(persona.id)) {
    throw new Error(
      `Persona "${persona.id}": id must match ${ID_REGEX} (lowercase ASCII ` +
        `letters, digits, dash). See ${DOC_REF} §5.2.`
    );
  }
}

/**
 * Validate every `initialContent[].sourceFixture` path is shaped to resolve
 * inside the persona's own directory.
 *
 * The runtime check in `resolveSeedEntries` (lima-test-vm-backing-files.ts)
 * applies the same rule at synthesis time; surfacing it at load time fails
 * the test process before the VM boots, which is a much clearer signal.
 *
 * Empty `sourceFixture` strings also throw — `resolveSeedEntries` rejects
 * them too, but treating empty as "valid" at the persona-shape layer would
 * be a footgun.
 */
export function validateInitialContentPaths(persona: DevicePersona): void {
  const entries = persona.massStorageBackingFile?.synthesis?.initialContent ?? [];
  for (const entry of entries) {
    if (typeof entry.sourceFixture !== 'string' || entry.sourceFixture.length === 0) {
      throw new Error(
        `Persona "${persona.id}": initialContent entry has empty sourceFixture. ` +
          `See ${DOC_REF} §5.3.`
      );
    }
    if (entry.sourceFixture.split('/').includes('..')) {
      throw new Error(
        `Persona "${persona.id}": initialContent sourceFixture ` +
          `"${entry.sourceFixture}" must not contain '..' segments — copy the ` +
          `fixture into this persona's raw/ directory instead of referencing a ` +
          `sibling. See ${DOC_REF} §5.3.`
      );
    }
  }
}

/**
 * Run every pure validation rule against `persona`. Throws on the first
 * failure with a message naming the persona and the constraint.
 *
 * Pure — no fs, no env, no syscalls. For fs-side checks (fixture file
 * existence) call {@link validateInitialContentExists} separately at the
 * registry load layer.
 */
export function validatePersona(persona: DevicePersona): void {
  validateId(persona);
  validateDescription(persona);
  validateInitialContentPaths(persona);
}

/**
 * fs-side companion check: every `initialContent[].sourceFixture` resolves
 * to an actual file under `personaDir`. Catches typos (missing raw/file)
 * at registry load time instead of inside the VM bootstrap.
 *
 * Kept separate from {@link validatePersona} so the pure validator stays
 * disk-free for unit tests. Callers (the registry index) invoke this on
 * top of `validatePersona` when they have a persona-directory anchor.
 *
 * @param persona - The persona to check.
 * @param personaDir - Absolute path to the persona's own directory
 *   (typically `path.dirname(import.meta.url)` for the persona's
 *   persona.ts file).
 * @param fsImpl - Test seam — defaults to `node:fs`. Tests inject a fake
 *   to drive the existence check without touching disk.
 */
export function validateInitialContentExists(
  persona: DevicePersona,
  personaDir: string,
  fsImpl: {
    existsSync: (p: string) => boolean;
    statSync: (p: string) => { isFile(): boolean };
  } = fs
): void {
  const entries = persona.massStorageBackingFile?.synthesis?.initialContent ?? [];
  for (const entry of entries) {
    const hostPath = path.resolve(personaDir, entry.sourceFixture);
    if (hostPath !== personaDir && !hostPath.startsWith(personaDir + path.sep)) {
      throw new Error(
        `Persona "${persona.id}": initialContent sourceFixture ` +
          `"${entry.sourceFixture}" resolves outside the persona directory ` +
          `(${hostPath}). See ${DOC_REF} §5.3.`
      );
    }
    if (!fsImpl.existsSync(hostPath)) {
      throw new Error(
        `Persona "${persona.id}": initialContent sourceFixture ` +
          `"${entry.sourceFixture}" not found at ${hostPath}. ` +
          `Check the path or copy the fixture into raw/. See ${DOC_REF} §5.3.`
      );
    }
    if (!fsImpl.statSync(hostPath).isFile()) {
      throw new Error(
        `Persona "${persona.id}": initialContent sourceFixture ` +
          `"${entry.sourceFixture}" is not a regular file at ${hostPath}. ` +
          `See ${DOC_REF} §5.3.`
      );
    }
  }
}

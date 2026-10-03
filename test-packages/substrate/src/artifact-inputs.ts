/**
 * Was this artifact built from the sources on disk now?
 *
 * The backstop {@link ./artifact-arch.ts} cannot be: a binary left in `dist/`
 * by an old build is the right architecture with the right name, so it
 * installs cleanly and then behaves like old code. The build records a hash
 * of every file it bundled in a stamp beside the artifact; the installer
 * re-hashes those files and refuses on any difference, or on no stamp at all.
 *
 * The bundler reports the inputs, so the list is never maintained by hand.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** The artifact on disk was not built from the current sources. */
export class StaleArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleArtifactError';
  }
}

interface ArtifactInputsStamp {
  /** Root-relative input path → sha256 of its contents at build time. */
  readonly inputs: Record<string, string>;
}

export function artifactInputsStampPath(artifactPath: string): string {
  return `${artifactPath}.inputs.json`;
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** POSIX separators: a stamp written on one host is read on another. */
function relativeKey(root: string, file: string): string {
  return path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
}

export interface StampArtifactInputsInput {
  readonly artifactPath: string;
  /** Every file the build bundled, absolute or relative to `root`. */
  readonly inputs: readonly string[];
  readonly root: string;
}

export function stampArtifactInputs(input: StampArtifactInputsInput): void {
  const entries = input.inputs
    .map((file) => [relativeKey(input.root, file), sha256File(path.resolve(input.root, file))])
    .sort(([a], [b]) => compareKeys(a!, b!));
  const stamp: ArtifactInputsStamp = { inputs: Object.fromEntries(entries) };
  fs.writeFileSync(
    artifactInputsStampPath(input.artifactPath),
    JSON.stringify(stamp, null, 2) + '\n',
    'utf8'
  );
}

export interface AssertArtifactInputsCurrentInput {
  readonly artifactPath: string;
  readonly root: string;
  /** How to produce a current artifact; appended to the error. */
  readonly rebuildHint: string;
}

/** @throws {StaleArtifactError} when the stamp is missing or any input differs. */
export function assertArtifactInputsCurrent(input: AssertArtifactInputsCurrentInput): void {
  const stampPath = artifactInputsStampPath(input.artifactPath);
  const refuse = (why: string): never => {
    throw new StaleArtifactError(`${input.artifactPath} ${why}. ${input.rebuildHint}.`);
  };

  if (!fs.existsSync(stampPath)) {
    refuse(
      `has no build-inputs stamp (${path.basename(stampPath)}), so nothing says which sources ` +
        'it was built from — it predates the stamp or was built outside the build script'
    );
  }

  let stamp: ArtifactInputsStamp;
  try {
    stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8')) as ArtifactInputsStamp;
  } catch (err) {
    return refuse(`has an unreadable build-inputs stamp (${(err as Error).message})`);
  }
  if (typeof stamp?.inputs !== 'object' || stamp.inputs === null) {
    refuse('has a build-inputs stamp with no inputs record');
  }
  const changed = Object.entries(stamp.inputs)
    .filter(([rel, hash]) => {
      const file = path.join(input.root, rel);
      return !fs.existsSync(file) || sha256File(file) !== hash;
    })
    .map(([rel]) => rel);

  if (changed.length > 0) {
    refuse(`was built from sources that have since changed: ${changed.join(', ')}`);
  }
}

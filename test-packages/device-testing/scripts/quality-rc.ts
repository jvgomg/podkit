#!/usr/bin/env bun
/**
 * `quality:rc` — the CI mirror.
 *
 * Runs the exact same two-phase quality body as `bun run quality`, but against
 * the **release-candidate assets** instead of local build outputs: the compiled
 * mac binary and the glibc linux binary fetched from the release-candidate
 * build, and the Docker image pulled as the moving `:rc` tag. Only the asset
 * source differs — the surfaces are identical (see {@link runMirrorBody}).
 *
 * The release candidate is the verification build triggered by the open
 * "Version Packages" PR. This script:
 *
 *   1. discovers + classifies that build's state (pure decision, injected `gh`);
 *   2. on any non-ready state, prints an actionable message and exits non-zero
 *      (fail fast) — `--wait` opts into blocking on an in-progress build;
 *   3. on a ready build, fetches exactly two arm64 artefacts into a git-ignored
 *      scratch dir, points the override env at them + at `:rc`, and execs the
 *      shared two-phase body.
 *
 * Scope: arm64 only (Apple-Silicon host + arm64 harness VM). The musl binaries
 * and the daemon are **not** fetched standalone — they live inside the `:rc`
 * image, which the docker surfaces pull. Requires Docker Desktop, the Lima
 * harness VM, and an authenticated `gh`.
 *
 * Flags:
 *   --wait            block on an in-progress build until it completes
 *   --run-id <id>     classify an explicit run, bypassing PR/run discovery
 *   --help            print usage
 * Any other arguments are forwarded to both phases of the mirror body.
 *
 * @module
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMirrorBody } from './run-mirror-body.js';
import { resolveRcBuildState, type RcBuildState } from '../src/rc-build/resolve-rc-build.js';
import { defaultSubprocessRunner } from '../src/subprocess.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** Package root: scripts/ → device-testing/. */
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..');
/** Git-ignored scratch directory the fetched artefacts land in. */
const SCRATCH_DIR = path.join(PACKAGE_ROOT, '.rc-assets');

/** The moving pre-release image tag the release-verification workflow pushes. */
const RC_IMAGE = 'ghcr.io/jvgomg/podkit:rc';

/**
 * The two artefacts fetched on the ready path. Names match the
 * `actions/upload-artifact` names in `build-platform.yml`; each artefact
 * contains a `*.tar.gz` whose sole entry is the `podkit` binary.
 *
 * - `mac`   — compiled macOS arm64 CLI, run directly by the host e2e.
 * - `linux` — glibc linux arm64 CLI, transferred into the Debian harness VM.
 *
 * The musl binaries and the daemon are intentionally absent: they ship inside
 * the `:rc` image the docker surfaces pull.
 */
const ARTIFACTS = {
  mac: 'podkit-darwin-arm64',
  linux: 'podkit-linux-arm64-gnu',
} as const;

/** Thrown when artefact fetch/extraction fails. */
class QualityRcError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'QualityRcError';
  }
}

interface ParsedArgs {
  wait: boolean;
  runId?: number;
  help: boolean;
  /** Everything not consumed above — forwarded to both mirror phases. */
  passthrough: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { wait: false, help: false, passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--wait') {
      parsed.wait = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--run-id') {
      const value = argv[++i];
      parsed.runId = parseRunId(value);
    } else if (arg?.startsWith('--run-id=')) {
      parsed.runId = parseRunId(arg.slice('--run-id='.length));
    } else if (arg !== undefined) {
      parsed.passthrough.push(arg);
    }
  }
  return parsed;
}

function parseRunId(value: string | undefined): number {
  const n = value === undefined ? Number.NaN : Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new QualityRcError(
      `--run-id expects a positive integer run id, got: ${value ?? '(missing)'}`
    );
  }
  return n;
}

const USAGE = `quality:rc — run the full quality suite against the release-candidate assets.

Usage: bun run quality:rc [--wait] [--run-id <id>] [-- <extra turbo args>]

  --wait          block on an in-progress release-candidate build until it is green
  --run-id <id>   classify an explicit verification run, bypassing PR discovery
  --help          show this message

Any other arguments are forwarded to both phases of the quality body.
Requires Docker Desktop, the Lima harness VM, and an authenticated \`gh\`.
`;

/**
 * The actionable stderr message for a non-ready build state. Exported so its
 * copy can be asserted directly without a real `gh`.
 */
export function formatNonReadyMessage(state: Exclude<RcBuildState, { kind: 'ready' }>): string {
  switch (state.kind) {
    case 'no-version-pr':
      return [
        'No release candidate to verify.',
        '',
        'There is no open "Version Packages" PR, so there are no release-candidate',
        'assets to gate against.',
        '',
        '  - For a local check against your working tree, run:  bun run quality',
        '  - To open a release candidate: create a changeset (bunx changeset), then let',
        '    the changesets bot open the "Version Packages" PR (or run `bunx changeset',
        '    version` and push the version bump). Its verification build produces the',
        '    assets this command gates against.',
      ].join('\n');
    case 'build-in-progress':
      return [
        'Release-candidate build still in progress.',
        '',
        'The verification build for the open "Version Packages" PR has not finished yet:',
        '',
        `  ${state.url}`,
        '',
        'Re-run with --wait to block until it turns green, or come back once it has',
        'completed.',
      ].join('\n');
    case 'build-failed':
      return [
        'Release-candidate build failed.',
        '',
        'The verification build for the open "Version Packages" PR did not succeed:',
        '',
        `  ${state.url}`,
        '',
        'Fix the release-candidate build first — there are no shippable assets to gate',
        'against until it is green.',
      ].join('\n');
  }
}

/** Spawn a command inheriting stdio; throw a typed error on non-zero exit. */
async function run(command: string, args: string[]): Promise<void> {
  const proc = Bun.spawn([command, ...args], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new QualityRcError(`\`${command} ${args.join(' ')}\` exited ${code}`);
  }
}

/**
 * Download one artefact from `runId` into its own scratch subdir, extract the
 * single tarball, make the `podkit` binary executable, and return its absolute
 * path.
 */
async function fetchBinary(runId: number, artifact: string, subdir: string): Promise<string> {
  const dest = path.join(SCRATCH_DIR, subdir);
  fs.mkdirSync(dest, { recursive: true });

  process.stdout.write(`[quality:rc] fetching ${artifact} from run ${runId}…\n`);
  await run('gh', ['run', 'download', String(runId), '--name', artifact, '--dir', dest]);

  const tarball = fs.readdirSync(dest).find((entry) => entry.endsWith('.tar.gz'));
  if (!tarball) {
    throw new QualityRcError(`artefact ${artifact} contained no .tar.gz (looked in ${dest})`);
  }
  await run('tar', ['xzf', path.join(dest, tarball), '-C', dest]);

  const binary = path.join(dest, 'podkit');
  if (!fs.existsSync(binary)) {
    throw new QualityRcError(
      `expected \`podkit\` inside ${tarball} but it was not found in ${dest}`
    );
  }
  fs.chmodSync(binary, 0o755);
  return binary;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const state = await resolveRcBuildState({
    subprocess: defaultSubprocessRunner,
    wait: args.wait,
    runId: args.runId,
  });

  if (state.kind !== 'ready') {
    process.stderr.write(formatNonReadyMessage(state) + '\n');
    return 1;
  }

  // Ready: fetch the two arm64 binaries into a clean scratch dir.
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });

  const macBinary = await fetchBinary(state.runId, ARTIFACTS.mac, 'mac');
  const linuxBinary = await fetchBinary(state.runId, ARTIFACTS.linux, 'linux');

  // Point the existing override seams at the fetched assets + the :rc image.
  // Every other PODKIT_* override is left unset so the musl binaries, daemon,
  // and gpod-tool stay local harness tooling (the daemon is exercised inside
  // the pulled :rc image).
  process.env['PODKIT_CLI_BINARY'] = macBinary;
  process.env['PODKIT_LINUX_BINARY'] = linuxBinary;
  process.env['PODKIT_DOCKER_DIST_IMAGE'] = RC_IMAGE;

  process.stdout.write(
    `[quality:rc] host CLI    → ${macBinary}\n` +
      `[quality:rc] linux CLI   → ${linuxBinary}\n` +
      `[quality:rc] docker image→ ${RC_IMAGE} (pulled by both docker surfaces)\n`
  );

  return runMirrorBody(args.passthrough);
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[quality:rc] ${msg}\n`);
      process.exit(1);
    });
}

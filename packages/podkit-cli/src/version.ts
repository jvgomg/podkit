import { readFileSync } from 'node:fs';

/**
 * Build-time version, injected by the standalone-binary build and the `dist`
 * bundle via `--define PODKIT_VERSION=...`. Absent under `bun run` / tests.
 */
declare const PODKIT_VERSION: string | undefined;

/**
 * Resolve the running podkit version, in priority order:
 *
 *   1. `PODKIT_VERSION` compile-time define — the release value baked into the
 *      `dist` bundle and the compiled binary. Returned verbatim.
 *   2. `PODKIT_VERSION` runtime env var — an explicit override (Docker image,
 *      CI, a dev wrapper) that wants an exact string without a rebuild.
 *      Returned verbatim.
 *   3. Running from source (`bun run`, tests): the CLI package's own version
 *      with a `-dev` suffix, so `--version` and archive provenance never
 *      masquerade an unbuilt source tree as a real release.
 *
 * The package.json is read with `fs` at runtime rather than a static
 * `import ... with { type: 'json' }`. A static JSON import makes the bundler
 * inline the *entire* file — including the `scripts` block, whose `build`
 * command carries the `__PODKIT_DEV_HOOKS__=false` define. That literal then
 * leaks into the production bundle and trips `dev-hooks-strip.test.ts`. An fs
 * read pulls nothing into the bundle. In production the define short-circuits
 * before this code ever runs.
 */
export function resolvePodkitVersion(): string {
  if (typeof PODKIT_VERSION !== 'undefined') return PODKIT_VERSION;
  if (process.env.PODKIT_VERSION) return process.env.PODKIT_VERSION;
  return `${readPackageVersion() ?? '0.0.0'}-dev`;
}

function readPackageVersion(): string | undefined {
  try {
    const url = new URL('../package.json', import.meta.url);
    const { version } = JSON.parse(readFileSync(url, 'utf8')) as { version?: string };
    return version;
  } catch {
    return undefined;
  }
}

/**
 * Reachability guard for `--external @podkit/substrate` in this package's own
 * `build` script.
 *
 * `@podkit/substrate`'s `yamlPath` getter (see `registry.ts`'s `defineLimaVm`)
 * resolves lazily via `repoRoot()`, which anchors on the literal substring
 * `test-packages/substrate/` in `import.meta.url`. That anchor is only ever
 * true while substrate's own source (or its own `dist/`) stays on disk at that
 * path — which is exactly what `--external @podkit/substrate` guarantees for
 * `@podkit/lima`'s bundle: the import specifier survives untouched, and
 * Node/Bun's module resolution finds the real `@podkit/substrate` package at
 * runtime instead of a copy vendored into this package's output.
 *
 * Drop that flag and `bun build` inlines substrate's compiled `dist/index.js`
 * text directly into `test-packages/lima/dist/index.js`. The inlined
 * `repoRoot()` then anchors on `import.meta.url` for THIS package's bundle —
 * a path containing `test-packages/lima/`, never `test-packages/substrate/` —
 * so every `yamlPath` getter throws the very first time anything reads it.
 * Nothing here is defended by types or lint: the bundle typechecks, builds,
 * and imports cleanly either way. Only running the actual built output and
 * touching `yamlPath` observes the difference.
 *
 * This test does exactly that: it re-runs the package's own `build` script
 * (parsed from `package.json`, not restated by hand, so editing the real
 * script is what this test reacts to) into a throwaway directory, imports the
 * result, and asserts that a Lima entry's `yamlPath` resolves to a real file.
 * It shells out to a bundler and writes to disk, which is why it lives beside
 * `lock.integration.test.ts` as `*.integration.test.ts` rather than in the
 * default `test:unit` run — see that file's header for the same reasoning.
 *
 * A previously accidental guard for this flag existed only in
 * `@podkit/device-testing`'s `baseline-hash.test.ts` (via a cross-package
 * import that happens to resolve through `dist/index.js`) — that guard is
 * fragile because nothing there says it is protecting this flag, and remote
 * because it lives in a different package from the one a reviewer of a lima/
 * substrate change would actually look at. This test is the deliberate,
 * local replacement.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { limaPackageRoot } from './paths.js';
import { getVm as getVmFromSource } from '@podkit/substrate';

const PACKAGE_ROOT = limaPackageRoot();

/**
 * The package's real `build` script, parsed rather than duplicated: this test
 * exists to react to someone editing that script, so it must read the same
 * string `bun run build` does. Only the first command (before `&&
 * build:types`) matters — we need the JS bundle, not the declaration files.
 */
function buildCommandTokens(): string[] {
  const pkgPath = path.join(PACKAGE_ROOT, 'package.json');
  const pkg: { scripts?: Record<string, string> } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const buildScript = pkg.scripts?.build;
  if (!buildScript) {
    throw new Error(`external-build guard: '${pkgPath}' has no 'scripts.build' to test.`);
  }
  const bundleCommand = buildScript.split('&&')[0]!.trim();
  const tokens = bundleCommand.split(/\s+/);
  if (tokens[0] !== 'bun' || tokens[1] !== 'build') {
    throw new Error(
      `external-build guard: expected the build script to start with 'bun build', got: '${bundleCommand}'. ` +
        'If the build tool changed, update this test to match.'
    );
  }
  return tokens;
}

let tmpOutDir: string | undefined;
afterEach(() => {
  if (tmpOutDir) {
    fs.rmSync(tmpOutDir, { recursive: true, force: true });
    tmpOutDir = undefined;
  }
});

describe('the built bundle keeps @podkit/substrate external', () => {
  it("resolves a Lima entry's yamlPath against the package's own build output", async () => {
    // A sibling of `dist/`, not `dist/` itself, and inside this package (not
    // `os.tmpdir()`) so Node's node_modules walk-up still finds the
    // `@podkit/substrate` / `@podkit/device-types` workspace symlinks that
    // sit at `test-packages/lima/node_modules/@podkit/*` — the same
    // resolution the real `dist/index.js` relies on.
    tmpOutDir = fs.mkdtempSync(path.join(PACKAGE_ROOT, '.external-build-guard-'));

    const tokens = [...buildCommandTokens()];
    const outdirIdx = tokens.indexOf('--outdir');
    if (outdirIdx === -1) {
      throw new Error(
        `external-build guard: build script has no '--outdir' flag to redirect: ${tokens.join(' ')}`
      );
    }
    tokens[outdirIdx + 1] = tmpOutDir;

    const result = spawnSync(tokens[0]!, tokens.slice(1), {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(
        `external-build guard: '${tokens.join(' ')}' exited ${result.status}:\n${result.stderr}`
      );
    }

    const builtEntry = path.join(tmpOutDir, 'index.js');
    const built: { getVm: typeof getVmFromSource } = await import(pathToFileURL(builtEntry).href);

    // If `--external @podkit/substrate` is dropped, this line is where the
    // failure lands: the inlined `repoRoot()` anchors on THIS bundle's own
    // path, which contains no `test-packages/substrate/` marker, and the
    // lazy `yamlPath` getter throws instead of returning a path.
    const builtYamlPath = built.getVm('device').yamlPath;

    expect(builtYamlPath).toBe(getVmFromSource('device').yamlPath);
    expect(fs.existsSync(builtYamlPath)).toBe(true);
  });
});

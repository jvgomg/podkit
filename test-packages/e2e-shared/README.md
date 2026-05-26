# @podkit/e2e-shared

Cross-cutting helpers used by every end-to-end test package in the monorepo.

Owned: the generic CLI subprocess runner, the canonical-error assertion helper, and a library of composable preflight checks. Not owned: anything that depends on a specific test harness (Subsonic config, Docker container lifecycle, Lima VM probes, real-iPod filesystem inspection) — those live with the package that knows their context.

Consumers today:

| Package | Uses |
| --- | --- |
| `@podkit/e2e-tests` | full set (runner + error + host preflight); the docker-gated `*.docker.test.ts` files import the runner + `TestSource` interface from here too |
| `@podkit/e2e-vm-tests` | not yet — its harness predates this package |

## CLI runner

```ts
import { runCli, runCliJson, expectCliError } from '@podkit/e2e-shared';

const result = await runCli(['status', target.path]);
expect(result.exitCode).toBe(0);

const { json } = await runCliJson<StatusOutput>(['status', target.path, '--json']);
expect(json?.trackCount).toBeGreaterThan(0);

await expectCliError(['device', 'music', '--json'], {
  code: 'NO_DEVICES',
  error: /No devices configured/,
});
```

`runCli` always spawns the built CLI binary (`packages/podkit-cli/dist/main.js`) — never the TypeScript source. Builds are guaranteed by turbo's `^build` dependency on the test tasks.

Subsonic-specific config helpers live in the package that owns the Subsonic harness. Directory-based config helpers (`createTempConfig`, `cleanupTempConfig`) are here because every harness uses them.

## Composable preflight checks

Each check is a function returning a `CheckResult`. Assemble the list your harness needs and pass it to `runPreflightChecks`:

```ts
import {
  checkCliBuilt,
  checkFfmpeg,
  checkFixtureSet,
  checkGpodTool,
  printResults,
  runPreflightChecks,
} from '@podkit/e2e-shared';

const results = await runPreflightChecks([
  checkCliBuilt,
  checkGpodTool,
  checkFfmpeg,
  checkFixtureSet('multi-format'),
  checkFixtureSet('video'),
]);

printResults(results);
process.exit(results.some((r) => !r.passed) ? 1 : 0);
```

Available checks:

| Check | Verifies |
| --- | --- |
| `checkCliBuilt` | `packages/podkit-cli/dist/main.js` exists |
| `checkGpodTool` | `gpod-tool` on `$PATH` |
| `checkFfmpeg` | `ffmpeg -version` runnable |
| `checkMetaflac` | `metaflac --version` runnable (FLAC artwork manipulation) |
| `checkFixtureSet(set)` | the named `@podkit/test-fixtures` set has been generated |
| `checkMountExists(path)` | the given mount path is accessible (real-iPod harnesses) |
| `checkWritePermissions(path)` | the given path is writable |

Harness-specific checks (real-iPod iTunesDB / Docker availability / Lima VM status) belong with the harness that knows about them, not here.

## Layout

```
test-packages/e2e-shared/
├── src/
│   ├── index.ts        # public API barrel
│   ├── cli-runner.ts   # runCli / runCliJson / temp config helpers
│   ├── cli-error.ts    # expectCliError + CliErrorJson type
│   └── preflight.ts    # composable PreflightCheck primitives
└── dist/               # built — emitted by `bun run build`
```

## Building

```bash
bun run --filter @podkit/e2e-shared build
```

Emits ESM declarations to `dist/lib.d.ts` and a single bundled `dist/index.js` (with `@podkit/gpod-testing` + `@podkit/test-fixtures` kept external so they resolve through the workspace).

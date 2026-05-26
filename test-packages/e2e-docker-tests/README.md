# @podkit/e2e-docker-tests

End-to-end tests for podkit features that require a Docker harness.

Today: Subsonic / Navidrome integration. Anything that needs a long-running container (database, alternative metadata server, etc.) belongs here. Host-only tests (CLI flow, mass-storage device adapter, audio transcode) live in `@podkit/e2e-host-tests`.

## Why a separate package

The cost of Docker isn't zero — pulling Navidrome, spinning up containers, waiting for the library scan to finish all add minutes to a test run. Keeping those tests out of the default `bun run test:e2e` flow means contributors who don't need them aren't paying that cost. Conversely, when these tests *do* run, missing Docker should fail loudly rather than silently skip every test.

Previously the same e2e package mixed both flavours, gated on `SUBSONIC_E2E=1`. The flag was a footgun: running `bun test` without it made every Docker test silently pass via `it.skipIf(!subsonicE2eEnabled)(...)`, which the reporter rendered as green. This package's split is the same fix the rest of the monorepo got — module-level throws instead of skip flags.

## Running

```bash
# Run the full suite. Will fail with an actionable error if Docker is missing.
bun run test:docker

# Or from the package directory
bun run --filter @podkit/e2e-docker-tests test

# Cleanup orphan containers from interrupted previous runs
bun run --filter @podkit/e2e-docker-tests cleanup
bun run --filter @podkit/e2e-docker-tests cleanup:list
bun run --filter @podkit/e2e-docker-tests cleanup:force
```

## Layout

```
test-packages/e2e-docker-tests/
├── src/
│   ├── docker/             # Container lifecycle, registry, orphan cleanup, signal handlers
│   ├── features/
│   │   ├── compilation-subsonic.e2e.test.ts   # COMPILATION tag round-trip via Navidrome
│   │   └── artwork-change.e2e.test.ts          # Artwork add/update/remove detection via Subsonic
│   ├── workflows/
│   │   └── subsonic-sync.e2e.test.ts          # Full sync workflow against Subsonic source
│   ├── helpers/
│   │   └── subsonic-config.ts                  # createSubsonicConfig helper
│   ├── scripts/
│   │   └── cleanup-containers.ts               # Orphan cleanup CLI
│   ├── setup/
│   │   └── preload.ts                          # bun:test preload — signal handlers + orphan check
│   └── subsonic-source.ts                      # SubsonicTestSource + isDockerAvailable
└── package.json
```

Shared concerns:
- **CLI runner, error-assertion helper, preflight checks** live in `@podkit/e2e-shared` and are imported here directly.
- **Audio + video fixtures** are owned by `@podkit/test-fixtures`. Tests call `ensureFixturesExist(set)` at module load to fail fast if the static set hasn't been generated.
- **Track/album catalogue + `withTarget`** live in `@podkit/e2e-host-tests` and are imported via subpath exports (`@podkit/e2e-host-tests/helpers/fixtures`, `@podkit/e2e-host-tests/targets`). The two packages are siblings — neither owns the other.

## Adding a new docker test

1. Drop the test file under `src/features/` or `src/workflows/`.
2. At the top: `requireBinary(...)` for any tools you exec inline, `ensureFixturesExist(...)` for the fixture sets you read from, and a `beforeAll` that calls `isDockerAvailable()` + throws if false.
3. Start your container via `startContainer({ image, source, ports, volumes, env })` from `./docker`. The harness registers it for cleanup automatically.
4. Use `withTarget` from `@podkit/e2e-host-tests/targets` to scope each test to a fresh iPod (dummy by default).

Do **not** add `it.skipIf(!someEnvFlag)(...)` or `if (!canRun()) return;` patterns. If the test can't run without something, fail at module load with a focused error.

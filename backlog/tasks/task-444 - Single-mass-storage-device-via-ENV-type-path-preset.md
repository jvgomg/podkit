---
id: TASK-444
title: Single mass-storage device via ENV (type + path + preset)
status: Done
assignee: []
created_date: '2026-06-27 19:04'
updated_date: '2026-07-07 22:27'
labels:
  - config
  - docker
  - mass-storage
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
modified_files:
  - packages/podkit-cli/src/config/env-device.ts
  - packages/podkit-cli/src/config/env-device.test.ts
  - packages/podkit-cli/src/config/defaults.ts
  - packages/podkit-cli/src/config/loader.ts
  - packages/podkit-cli/src/config/loader.test.ts
  - packages/podkit-cli/src/resolvers/device.ts
  - packages/podkit-cli/src/resolvers/device.test.ts
  - packages/podkit-daemon/src/env-device.ts
  - packages/podkit-daemon/src/env-device.test.ts
  - packages/podkit-daemon/src/main.ts
  - docs/reference/environment-variables.md
  - docs/getting-started/docker-daemon.md
  - .changeset/env-mass-storage-device.md
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today ENV can declare the music source and global settings but not a device/preset, so a single-mass-storage user is forced into a config file purely to name a preset. Add a single mass-storage device declaration via ENV (`type` + `path` + `preset`, preset defaulting to generic), giving iPod and mass-storage symmetric single-device daemon lanes.

This is the first slice of the broader ENV↔config parity direction (full multi-device/multi-collection parity is out of scope — see the Draft task). Implement as a pure **mass-storage ENV mapper**: env -> the same DeviceConfig shape the config file produces.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pure mass-storage ENV mapper: env -> DeviceConfig, unit-tested in isolation
- [x] #2 A single mass-storage device (type + path + preset) is fully configurable via ENV with no config file
- [x] #3 Preset defaults to generic when unspecified
- [x] #4 ENV-only daemon mode auto-syncs the declared single mass-storage device
- [x] #5 Documented in the environment-variables reference + Docker docs
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Handoff note (from TASK-447): TASK-447 (Tier-1 tests) depends on this. When you build the mass-storage ENV mapper, put it in a pure, table-tested module (external behavior, no impl coupling) so it satisfies TASK-447 AC#2/#3 — that's the Tier-1 unit test for this module. The unknown-model guard + readiness classifier are already done (440, 447).

Implemented (TDD). Pure CLI mapper packages/podkit-cli/src/config/env-device.ts: PODKIT_DEVICE_PATH triggers the declaration; PODKIT_DEVICE_TYPE = preset defaulting to generic, throws on 'ipod' (iPods need no declaration — same throw convention as the PLAYLIST env misuse, surfaces via loadConfig → main's error path); PODKIT_DEVICE_NAME underscores→hyphens, default 'default'. Wired into loadEnvConfig: merges into config.devices and sets defaults.device (mirrors the env-collection auto-default; env>file like all env overrides). 7 mapper tests + 3 loadEnvConfig wiring tests + 2 loadConfig file+env integration tests (default override, same-name deep-merge).

Key enabler beyond the mapper: matchPathToConfigDevice (resolvers/device.ts) gained a path-match fallback — after the UUID route, mass-storage entries (explicit type != ipod) match by normalized path. Folder-based players bind-mounted with no filesystem UUID could never satisfy the UUID-only Scenario B, which is why declared presets never applied to daemon path syncs (gap recorded in TASK-441 notes). UUID match keeps precedence; iPod entries excluded so a stale path can't hijack a bare-path sync. 4 resolver tests.

Daemon: pure massStorageEnvDevice(env) -> declared{path} | invalid-ipod-type | none (packages/podkit-daemon/src/env-device.ts, 5 tests); main.ts unions the declared path into mass-storage polling (deduped with PODKIT_MASS_STORAGE_PATHS) and warn-logs the invalid-ipod-type case instead of silently discarding. The CLI child inherits env, so sync -d <path> path-matches back to the declared preset — AC#4 without a second config parser in the daemon (only the two env var names are duplicated; sync-note comment points at ENV_KEYS).

Docs (AC#5): environment-variables.md new Device Variables section (incl. env-overrides-file-default caveat); docker-daemon.md Mass-Storage section rewritten — ENV single-device recipe, config-file multi-device recipe, path-matching mechanics incl. explicit-type requirement. Changeset: podkit minor + @podkit/daemon minor (combined — one feature across both).

Sonnet review applied: env-overrides-default docs sentence; daemon warn on ipod-typed declaration (discriminated return replaced the silent null); 2 loadConfig integration tests; renamed the misleading 'prefers UUID' resolver test (both Scenario B routes report source=path-matched); NAME-conversion doc loosened; explicit-type requirement documented. Verification: 1944 CLI + 110 daemon tests green, typecheck + root lint clean.
<!-- SECTION:NOTES:END -->

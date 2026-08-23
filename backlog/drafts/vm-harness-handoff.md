# Handoff — VM-harness consolidation (TASK-480 / doc-059)

_Phase A (P0 + P1) complete and on `main`. Phase B (P2→P3→P4) ready to pick up._

## Status

| Phase | Task | What | Status |
|-------|------|------|--------|
| P0 | 480.01 | Builder-VM start race → shared cross-process lock | ✅ Done — `e67f69ef` |
| P1 | 480.02 | Extract `@podkit/lima` substrate + re-export shim | ✅ Done — `16a02b0f` (+ `829a9e86` backlog) |
| P2 | 480.03 | Configs → registry + instance renames + `computeBaselineHash` (MF3) | ▫ To Do (unblocked) |
| P3 | 480.04 | Thin build scripts + `run-tests.sh` onto `podkit-vm`; atomic lock cutover (MF4) | ▫ To Do (unblocked) |
| P4 | 480.05 | vipod + abi-verify registry entries; docs + new ADR | ▫ To Do (unblocked) |
| — | 481 | Unpin `bun-types`/`@types/bun` (remove 1.3.14 override) | ▫ To Do (low) |

## What landed in Phase A

`@podkit/lima` (`test-packages/lima/`, **private**) now owns the Lima substrate:
- typed **VM registry** (`registry.ts`) — all 7 VMs, **current** names + yaml paths (renames/move are P2)
- **`podkit-vm` CLI** — `ensure|status|stop|destroy|recover|install|doctor|shell`, the single lock chokepoint
- **advisory lock** (`lock.ts`, `proper-lockfile`) — liveness-aware, stale-reclaiming, never auto-stops, no ref-counting
- `ensure*`/`recover` **lifecycle**, generic **transport** (`runInVm`/`copyOut`/`stageSourceTree`), `baseline-hash`, the docker-image runner

`@podkit/device-testing` consumes it via a **complete re-export shim** (`src/index.ts`) — no downstream import site changed. `SubprocessRunner` default impl moved `@podkit/core` → `@podkit/device-types` (re-exported from core), so **lima depends only on `@podkit/device-types` + `proper-lockfile`** (cycle-free, verified).

**Verification:** repo typecheck 38/38, oxlint 0/0, 56 lima tests (53 unit via scripted-runner seam + 3 real-process lock integration). VM-green: `test:vm` **232/0**, `docker-dist` + `docker-loopback` **9/0**. Sonnet review: **SHIP**, no must-fix.

## Binding references

- **Spec:** `doc-059` (RFC).
- **Decisions (authoritative):** `backlog/drafts/vm-harness-decisions.md` — D1–D15 + post-review resolutions + MF1–MF4. Overrides everything where they differ.
- **Impl plan:** `backlog/drafts/vm-harness-implementation-plan.md` — its P0/P1 sections are **superseded**; P2–P4 still guide.
- **Design context:** `backlog/drafts/vm-harness-package-design.md`. Reconciles with **ADR-016** (builder/test VM separation preserved; only orchestration + config centralized).

## Must-know for Phase B

- **Placement** is `test-packages/lima/` (D6 amended from `packages/`). `test-packages/*` is already a workspace glob; the `@podkit/lima` name is location-independent.
- **MF3 (P2, mandatory):** `computeBaselineHash` still takes a single `packageRoot`. When P2 moves the device YAML into lima, its two tracked files (`…/podkit-device-harness.yaml` + `apply-state.sh`) split across packages → the current signature **throws** (not "drift") on the first `vm:doctor`. Change to an explicit absolute tracked-file list (or `(coreRoot, deviceTestingRoot)`); update both callers (`harness.ts`, `vm-doctor.ts`); preserve declaration order for hash stability.
- **MF4 (P3):** the P0 bash lock (`vm-builder-lock.sh`, mkdir + owner-PID at `${TMPDIR}/podkit-vmlock-<vm>`) and the P1 `proper-lockfile` CLI lock **do not interoperate**. Migrate **all** starters of a given VM to the CLI in one atomic step; retire `vm-builder-lock.sh` at an explicit point.
- **Coordination is single-layer** — the shared lock only. **No turbo `ensure:<instance>` nodes** (amended D11/D13; a `cache:false` ensure node would boot VMs on cache hits).
- **Build-tooling boundary (D8):** `tools/prebuild/*` recipes stay put and must **not** import `@podkit/lima` — CI (`prebuild.yml`) runs them directly with no Lima.
- **GOTCHA proven in P1:** any lima module that resolves paths at **module-load** (anchoring on the `test-packages/lima` marker in `import.meta.url`) **crashes the compiled FunctionFS daemon** — its bunfs binary (`/$bunfs/root/…`) has no such path. Keep all `repoRoot()`/path anchoring **inside function bodies / lazy**. **Only full VM-green catches this class** — unit tests, typecheck, and review all pass from source.
- **Instance rename scheme (P2, D12):** `podkit-device-harness`→`podkit-device`; `podkit-linux-builder`→`podkit-builder-glibc`; `podkit-musl-builder`→`podkit-builder-musl`; `podkit-tests-debian-glibc`→`podkit-test-glibc`; `podkit-tests-alpine-musl`→`podkit-test-musl`; `podkit-virtual-ipod` + `podkit-abi-verify` kept. Registry `id`s are clean TS identifiers.

## Outside this epic (for the maintainer)

1. **`main` `quality` gate is red since Aug 18** — TASK-479 commit `947ee3cd` removed the fabricated MA147 iPod-Video identity, but the host e2e `device init/reset > modelName /Video/i` (`test-packages/e2e-tests/src/commands/device.test.ts`, dated Jun 23) wasn't updated → returns "Invalid". Fold that test update into **task-479.12/.13**. Until then, verify VM work via `test:vm` + docker surfaces directly, **not** full `quality`.
2. **bun-types pin** (1.3.14 via root `overrides`, TASK-481) — kept per maintainer steer; unpin when convenient (a floating `"latest"` now resolves to a persona-breaking 1.4.0).

## How to run / verify (until the quality gate is un-redded)

```bash
bun run harness:setup   # cold create (non-interactive), builds+installs, seals baseline
bun run test:vm         # → 232 pass / 0 fail  (device-testing 38 + e2e-vm-tests 194)
bunx turbo run @podkit/e2e-vm-tests#test:e2e:docker-dist @podkit/e2e-tests#test:e2e:docker-loopback
```

`bun run vm:*` shorthand + the `podkit-vm` CLI as a root command land in **P3**; for now the existing `harness:*` commands drive it (through lima under the hood).

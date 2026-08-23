# VM-harness consolidation — implementation plan (`@podkit/lima`)

**Status:** Draft for maintainer review — execution-ready. NOT yet started.
**Companions:** `vm-harness-package-design.md` (proposal) and `vm-harness-decisions.md` (binding decisions D1–D15). Where anything below diverges from the decisions doc, the decisions doc wins.
**Grounding:** every file/line reference was read first-hand (2026-08). Reviewers can spot-check.

This plan extracts a first-class VM-orchestration package `@podkit/lima` (at `packages/lima/`) that owns the Lima substrate — limactl wrapping, idempotent `ensure*` lifecycle, a cross-process advisory lock funnelled through one `podkit-vm` CLI, the typed VM config registry (all YAMLs), baseline/drift/`recover`, and generic transport — and refactors `@podkit/device-testing` to consume it while keeping everything domain-coupled (personas, system-states, `apply-state.sh`, daemon-gadget synthesis, `vm/` fixtures). Phasing follows the approved P0→P4.

---

## 0. Decision-conformance table

| # | Decision (abbrev.) | Where satisfied in this plan |
|---|---|---|
| **D1** | Full extraction; ship P0 race-fix standalone first | P0 (standalone), then P1 extracts the package |
| **D2** | Two-layer coordination: turbo `ensure` node + per-instance advisory lock via ONE CLI; `ensureRunning` never auto-stops; no refcount | P0 (turbo node), P1 (lock + `podkit-vm`), §"Advisory-lock design"; start-only contract in P1 lifecycle API |
| **D3** | No backward-compat freeze — rename mise/scripts/turbo IDs/instances freely | P1–P4 renames (root `harness:*`→`vm:*`, instances per D12); §"Ordering" notes suites keep semantic names |
| **D4** | abi-verify kept as manual on-demand registry entry (not deleted, not auto-CI) | P4 registry entry `podkit-abi-verify`, category `abi-verify`; no CI wiring |
| **D5** | Package name `@podkit/lima` | P1 package.json `"name": "@podkit/lima"` |
| **D6** | Placement `packages/lima/`, private/unpublished | P1 directory tree under `packages/lima/`, `"private": true` |
| **D7** | One core owns config + lifecycle; device-testing keeps domain; `lima-docker-image`→core; don't split config assets | P1 move list (§"P1 change list") + §"The cut" table; docker-image→core; single package holds `vms/` + code |
| **D8** | `tools/prebuild/*` recipes stay, never import core; CI `prebuild.yml` runs them direct (bash lines 72/109/182/256); only host wrappers become thin callers | P0 strips `limactl` from host wrappers; P3 thins them to `podkit-vm` calls; §"Risks" CI-invariant guard; verified prebuild.yml has no Lima |
| **D9** | Virtual-iPod: config into registry (`demo`), leave `vipod:*` + server where they are | P4 adds `podkit-virtual-ipod` registry entry; `mise` `vipod:*` untouched |
| **D10** | Typed TS registry over co-located YAML; arch stays runtime (`uname -m`) | P1 `VmDefinition[]` in `src/registry.ts`, YAML in `vms/`; arch stays in-VM (unchanged `vmArch()`/`uname -m`) |
| **D11** | `podkit-vm` bin + verbs; `bun run vm:*` replaces `harness:*`; turbo nodes `@podkit/lima#ensure:<instance>`; keep suite task names | P1 CLI + verbs; P1/P3 root scripts; P2 turbo ensure nodes renamed; suites (`test:vm`, `test:e2e:docker-dist`) unchanged |
| **D12** | Rename all instances to consistent scheme, keep `podkit-` prefix | P2 rename table + one-time destroy/re-provision |
| **D13** | P0 race-fix = turbo ordering node shared by the two `dependsOn:[]` glibc tasks; strip redundant `limactl start` | §"P0 detail" — exact turbo task + the two script edits |
| **D14** | Injected `SubprocessRunner` DI seam preserved; unit-test lock/ensure/registry with scripted runner; one real-process lock integration test | §"Test plan" + P1 keeps the scripted-runner seam already used in `lima-*.test.ts` |
| **D15** | Ship P0 now, standalone; P1+ waits for this plan + review | P0 marked ship-now; P1+ gated on approval |

---

## 1. Advisory-lock design (concrete)

The lock is the load-bearing piece of D2 and must be right. Requirements from D2: **liveness-aware, stale-reclaiming, no `flock(1)` (absent on macOS), and a single code path** that TS, shell, and turbo all funnel through.

**One code path via the CLI.** Every start-of-a-shared-VM goes through `bunx podkit-vm ensure <instance>`. There is no second lock implementation: shell wrappers (`build-*.sh`, `run-tests.sh`), the turbo `ensure:<instance>` nodes, and TS callers (`harness.ts`→`vm:up`, `lima-test-vm` runner `prepare()`, `vm-install.ts`) all invoke the CLI (or the same `ensureRunning()` function the CLI wraps). `ensureRunning()` acquires the lock, re-probes status, and starts only if not already `running`, then releases — so the whole check-then-start critical section is inside the lock and the double-`limactl start` window (today's `ha.pid` crash) closes.

**Lockfile location.** `${XDG_CACHE_HOME:-$HOME/.cache}/podkit/vm-locks/<instanceName>.lock` — one sentinel file per Lima instance. Per-instance (not global) so the glibc builder, musl builder, and device VM can be prepared concurrently without false contention; only two starts of the *same* instance serialize.

**Liveness / stale reclaim — recommended library: `proper-lockfile`.**
- Not currently a dependency (verified: absent from `bun.lock`). It is pure-JS (no native addon), cross-platform, and does exactly what D2 asks: acquires via atomic `mkdir`, writes an mtime, refreshes it on an interval (`update`), and treats a lock whose mtime is older than `stale` ms as reclaimable. A holder killed with `SIGKILL` (the classic wedge) is reclaimed after the `stale` window rather than deadlocking.
- Config: `{ stale: 120_000, update: 10_000, retries: { retries: 30, factor: 1, minTimeout: 1_000, maxTimeout: 2_000 } }` — a VM start can take minutes on cold create, so retry generously (~30–60s of polling) and set `stale` above the longest expected *hold that is still alive* (heartbeat keeps a live long-create from going stale).
- **Tradeoff / alternative:** a hand-rolled pidfile + `process.kill(pid, 0)` liveness check is dependency-free and gives exact liveness (vs. mtime heuristic), but re-implements retry/backoff/atomicity that `proper-lockfile` already hardened, and `kill(0)` doesn't cross the shell/TS boundary cleanly (the holder may be a `bunx turbo` grandchild). Recommendation: **`proper-lockfile`**, isolated behind `src/lock.ts` (`withInstanceLock(instanceName, fn)`) so the choice is swappable. Flagged as an open item to ratify.

**What the lock does NOT do.** It never auto-stops (D2 start-only), so there is no release-on-idle / refcount. Stop/destroy/recover are explicit verbs and take the same lock only to avoid racing a concurrent start.

**Later reuse (out of scope, noted).** The same lock keyed on the device instance can retire the hand-rolled two-phase `quality` vs `quality:rc` serialization in `run-mirror-body.ts` (Phase 2 is manually sequenced after Phase 1 because `test:vm` and `docker-dist` share the device VM). Not built here; called out so the follow-on is obvious.

---

## 2. Test plan (the core)

Per D14 the substrate is unit-testable with **no real VM**, reusing the scripted-`SubprocessRunner` seam already established in `test-packages/device-testing/src/runners/lima-test-vm.test.ts` (see `makeScriptedRunner()` there) and `resolve-rc-build.test.ts`.

- **Unit (scripted runner, no VM):** `instanceStatus` NDJSON parsing (running/stopped/missing/broken); `ensureRunning` start-only logic (no start when already running; start when stopped; recover when broken); `ensureExists` create-when-missing; registry `getVm`/`listVms` (unknown id throws, category filter); `computeBaselineHash` ordering + missing-file throw (port existing `baseline-hash` coverage); `runInVm`/`stageSourceTree` argv shape + rsync exit-24 tolerance; `transferBinary` sha256-skip. These move with their subjects into `packages/lima/src/**/*.test.ts`.
- **Lock unit:** `withInstanceLock` serializes two async callers in-process (second waits for first to release); stale reclaim path (simulate an old mtime).
- **Lock integration (the one real-process test):** spawn two child processes that both `podkit-vm ensure <fake-instance>` against a scripted/stubbed `limactl` (a shim on PATH that sleeps then exits), assert the two starts do not overlap (write timestamps to a file, assert non-overlap) and that a `SIGKILL`ed holder's lock is reclaimed. This is the only test that needs real processes; it needs no Lima.
- **Stays VM-tier e2e (unchanged, still gated by `preflight.ts`):** everything under `test-packages/device-testing/src/vm/**` and `@podkit/e2e-vm-tests` — persona synthesis, daemon lifecycle, docker-dist. The extraction must not change these; the re-export shim (P1) keeps their imports valid.

---

## 3. P0 detail — race fix (ship now; verify-if-already-landed)

> NOTE (D15): P0 is independently valuable and may already be committed by the time this plan is reviewed. Verified at plan time it is **not** yet present (no `ensure` task in `turbo.json`; `build-linux-prebuild.sh`/`build-gpod-tool-linux.sh` still each run `limactl` start/create). If it has since landed, treat this section as "verify the shape matches; adjust if not."

### 3.1 Root cause (confirmed in-tree)
- `turbo.json:334` `@podkit/device-testing#build:linux-prebuild` → `dependsOn: []`.
- `turbo.json:436` `@podkit/gpod-testing#build:linux-binary` → `dependsOn: []`.
- Both are prerequisites of `@podkit/device-testing#vm:install` (`turbo.json:252-256`).
- `scripts/build-linux-prebuild.sh:47-65` **creates+starts** `podkit-linux-builder` (`limactl start --name=…`).
- `scripts/build-gpod-tool-linux.sh:31-40` **errors if NotFound, `limactl start` if Stopped** on the same VM.
Turbo schedules the two `dependsOn:[]` tasks concurrently → two `limactl start podkit-linux-builder` fight over `ha.pid` (the reported `harness:setup` fatal), and on a cold tree gpod-tool can hard-fail `NotFound` before prebuild creates the VM.

### 3.2 Exact change
1. **New turbo ordering node** in `turbo.json` (initially package-scoped to `@podkit/device-testing`, per D13; it becomes `@podkit/lima#ensure:podkit-builder-glibc` in P2):
   ```json
   "@podkit/device-testing#ensure:linux-builder": {
     "dependsOn": [],
     "cache": false,
     "inputs": [
       "$TURBO_ROOT$/test-packages/device-testing/lima/podkit-linux-builder.yaml",
       "scripts/ensure-builder.sh"
     ],
     "outputs": []
   }
   ```
   `cache: false` — running-ness is runtime state (mirrors `vm:doctor` at `turbo.json:290`).
2. **New script** `test-packages/device-testing/scripts/ensure-builder.sh` — the *only* creator/starter. Move the status→create/start/recreate case block verbatim out of `build-linux-prebuild.sh:47-65` into it (it already handles Running/Stopped/NotFound/Broken).
3. **Point the two racing tasks at it** (add to each `dependsOn`):
   - `@podkit/device-testing#build:linux-prebuild` (`turbo.json:335`) → `dependsOn: ["@podkit/device-testing#ensure:linux-builder"]`.
   - `@podkit/gpod-testing#build:linux-binary` (`turbo.json:437`) → `dependsOn: ["@podkit/device-testing#ensure:linux-builder"]`.
   - `build:linux-binary` already chains via `build:linux-prebuild` (`turbo.json:361`) → transitively ordered; no direct edit needed.
4. **Strip `limactl start`/create from the wrappers (assume-running):**
   - `build-linux-prebuild.sh` — delete lines 47-65 (the case block); keep a cheap fail-fast guard (`limactl list … | status; if not Running → echo "run ensure:linux-builder first" && exit 1`).
   - `build-gpod-tool-linux.sh:31-40` — replace with the same assume-running guard (remove the `limactl start` on Stopped).
   - `build-linux-binary.sh:37-46` — same (remove the start-on-Stopped).
5. **Optional (symmetry, not the reported flake):** add `ensure:musl-builder` + strip `build-musl-prebuild.sh:32-50`. The musl builder is touched by only one `dependsOn:[]` task (`build:musl-prebuild`), so it does not currently race; defer to P1/P2 unless doing it now is cheap.

### 3.3 Verify
- **DAG (static, cheap):** `bunx turbo run @podkit/device-testing#vm:install --dry=text` (or `--graph`) — confirm both `build:linux-prebuild` and `@podkit/gpod-testing#build:linux-binary` now list `@podkit/device-testing#ensure:linux-builder` as a dependency, and the ensure node appears exactly once.
- **Cold concurrent build (real, proves the race gone):** `bun run harness:builder:destroy --yes` then `bunx turbo run @podkit/device-testing#vm:install --force` — succeeds with no `another hostagent may already be running` fatal; the builder is created exactly once.
- **Regression:** a normal `bun run harness:setup` on a clean tree completes.

### 3.4 Risk / rollback
- Low blast radius: one new node + one new script + three edited wrappers. Rollback = revert; the wrappers' old self-start logic is git-recoverable. Risk if a wrapper's start block is missed → race survives (mitigated: only three glibc-builder starters exist, all listed).

---

## P1 — Extract `@podkit/lima` core (+ lock + `podkit-vm` CLI + `SubprocessRunner` seam)

### Goal + exit criteria
- New private package `@podkit/lima` at `packages/lima/` owns the Lima substrate. `@podkit/device-testing/src/index.ts` re-exports every moved symbol so **no consumer import changes** (`@podkit/e2e-vm-tests` and the harness self-tests keep compiling).
- The `podkit-vm` bin exists with verbs `ensure|status|stop|destroy|recover|install|doctor|shell <instance>` and is the single lock chokepoint.
- **Green =** `bun run typecheck` and `bun run build` pass repo-wide; `bun test --filter @podkit/lima` (unit + lock integration) passes; `bun test --filter @podkit/device-testing` (non-VM) passes; `bunx turbo run @podkit/e2e-vm-tests#test:vm --dry=text` still resolves (imports intact). No YAML moves yet (that's P2) — instance names/paths still point at their current locations.

### The cut (D7) — what moves vs stays
| Moves to `@podkit/lima` | Stays in `@podkit/device-testing` |
|---|---|
| `src/runners/lima-limactl.ts` (`runLimactl`, `limactlError`, `shellQuote`) → `src/limactl.ts` | `personas/**`, `system-states/**`, `vm/**`, `rc-build/**`, `preflight.ts`, `runtime.ts`, `runners/registry.ts`, `runners/local-linux.ts` |
| `instanceStatus` (split out of `runners/lima-test-vm.ts`) → `src/status.ts` | `runners/lima-test-vm.ts` **minus** `instanceStatus`/resolvers: `createLimaTestVmRuntime`, `ensurePersonaSidecar`, `stageBackingFile`/`resetBackingFile`, `startDaemonForPersona`/`stopDaemon` (persona/daemon domain) |
| `runners/lima-test-vm-binary.ts` (`transferBinary`, `transferGpodTool`, `DEFAULT_*_VM_PATH`) → `src/transport.ts` (generic file→VM copy) | `runners/lima-test-vm-state.ts` (imports `SystemStateId` — domain), `runners/lima-test-vm-systemd.ts` (daemon unit — domain), `runners/lima-test-vm-backing-files.ts` (persona synthesis — domain) |
| The `resolveDefault*Binary` family (pure path helpers, zero domain-type imports) → `src/resolve-binaries.ts` | `scripts/apply-state.sh`, `scripts/harness.ts` (domain install steps), `scripts/vm-install.ts`, `scripts/vm-doctor.ts` (stay as scripts; re-point imports to `@podkit/lima`) |
| `src/baseline-hash.ts` → `src/baseline.ts` (`computeBaselineHash`, add `sealBaseline`/`checkDrift`/`recover` hooks) | `personas/sidecar*.ts`, `runtime.test.ts`, canary tests |
| `runners/lima-docker-image.ts` → `src/docker-image.ts` (D7 explicit — no persona/system-state coupling) | — |
| `runners/paths.ts` → `src/paths.ts`, **generalized** (see below) | — |
| `src/subprocess.ts` seam → `src/subprocess.ts` (see DI note) | — |
| **New:** `src/registry.ts` (`VmDefinition[]`, `getVm`, `listVms`), `src/lock.ts`, `src/lifecycle.ts` (`ensureExists`/`ensureRunning`/`stop`/`destroy`/`recover`), `src/cli.ts` + `bin/podkit-vm.ts` | — |

Dividing rule applied (D7): *imports `@podkit/core`/`device-types` domain or references personas/system-states → device-testing; pure Lima mechanics → core.* Note `lima-test-vm.ts` is a **mixed file** and must be split — `instanceStatus` + the `resolveDefault*Binary` helpers are pure mechanics (move); the `createLimaTestVmRuntime` factory and sidecar/backing/daemon helpers are persona/system-state domain (stay). `lima-docker-image.ts` currently imports `LIMA_DEVICE_HARNESS_VM_NAME` + the musl resolvers from `lima-test-vm.ts`; moving those resolvers to core (with docker-image) avoids a core→device-testing cycle.

### Package layout (`packages/lima/`)
```
packages/lima/
  package.json            # name @podkit/lima, private:true, bin.podkit-vm, dep: @podkit/device-types, proper-lockfile
  tsconfig.json, tsconfig.build.json
  bin/podkit-vm.ts        # #!/usr/bin/env bun → imports src/cli.ts
  src/
    index.ts              # barrel (public surface)
    registry.ts           # VmDefinition, VM_DEFINITIONS[], getVm(id), listVms(category?)
    limactl.ts            # runLimactl / limactlError / shellQuote          (from lima-limactl.ts)
    status.ts             # instanceStatus(): 'running'|'stopped'|'missing'|'broken'
    lock.ts               # withInstanceLock(instanceName, fn)               (proper-lockfile)
    lifecycle.ts          # ensureExists / ensureRunning / stop / destroy / recover  (all lock-guarded)
    transport.ts          # runInVm / stageSourceTree / copyOut + transferBinary / transferGpodTool
    baseline.ts           # computeBaselineHash / sealBaseline / checkDrift  (+ BASELINE_VM_HASH_PATH)
    docker-image.ts       # buildPodkitImageInVm / pullPodkitImageInVm / ensurePodkitImageInVm
    resolve-binaries.ts   # resolveDefaultPodkit/Debug/Daemon/Musl/GpodTool/DummyHcd binary paths
    paths.ts              # repoRoot() finder (generalized — anchor on workspace root, not a package marker)
    subprocess.ts         # SubprocessRunner seam + a local default runner (see DI note)
    cli.ts                # podkit-vm dispatcher
  vms/                    # EMPTY in P1; populated in P2
```

### `VmDefinition` registry shape (D10)
```ts
export type VmCategory = 'device' | 'builder' | 'test-runner' | 'demo' | 'abi-verify';
export interface VmDefinition {
  id: string;                     // clean TS id — free to choose: 'device','builderGlibc','builderMusl',
                                  //   'testGlibc','testMusl','virtualIpod','abiVerify'
  instanceName: string;           // Lima instance string (P1: current names; P2: renamed per D12)
  yamlPath: string;               // absolute path (P1: current lima/ dirs; P2: packages/lima/vms/)
  category: VmCategory;
  archRelevant?: boolean;         // records that the x86_64→x64 / aarch64→arm64 suffix convention applies
  trackedForBaseline?: string[];  // host files whose change ⇒ re-provision (device VM only, today)
}
export function getVm(id: string): VmDefinition;      // throws on unknown id
export function listVms(category?: VmCategory): VmDefinition[];
```
In P1 the registry can hold just the two builders + device VM with their **current** instance names/paths (so nothing breaks); P2 renames + moves the YAMLs. Arch stays a runtime `uname -m` concern (unchanged `vmArch()` and the in-VM `case "$(uname -m)"` blocks) — the registry only records `archRelevant`.

### Lifecycle API surface (start-only contract, D2)
```ts
// all of ensure*/stop/destroy/recover run inside withInstanceLock(vm.instanceName, …)
ensureExists(vm, { subprocess?, yamlPath? }): Promise<void>   // create if missing; else no-op
ensureRunning(vm, { subprocess? }): Promise<void>            // ensureExists + start if stopped + recover if broken; NEVER stops
stop(vm, { subprocess? }): Promise<void>                     // explicit
destroy(vm, { yes?, subprocess? }): Promise<void>            // explicit; limactl delete --force
recover(vm, { provision?, subprocess? }): Promise<void>      // destroy → create → start → provision hook → reseal baseline
status(vm | instanceName, subprocess?): Promise<Status>
// transport
runInVm(vm, argv, opts?), stageSourceTree(vm, { dest, excludes }), copyOut(vm, vmPath, hostPath)
// baseline
computeBaselineHash(vm), sealBaseline(vm), checkDrift(vm): { ok, reason? }
```
`recover` is promoted to first-class (today it is ad-hoc `limactl delete --force && start` inside each script's `*)` case, plus the manual `harness:destroy && harness:setup` that `vm-doctor.ts:50` prints; centralizing it means the **baseline reseal** — today only in `harness.ts:545 sealBaselineHash()` — can't be forgotten). The device VM's provision/reseal hook (the install steps) is supplied by device-testing, not baked into core.

### `SubprocessRunner` seam (D14) — important dependency decision
Today `test-packages/device-testing/src/subprocess.ts` re-exports `defaultSubprocessRunner` **from `@podkit/core`** and the `SubprocessRunner` interface from `@podkit/device-types`. `@podkit/core`'s dependency set is heavy (`@podkit/libgpod-node` native addon, `music-metadata`, `subsonic-api`, …). **`@podkit/lima` must not depend on `@podkit/core`** — that would drag the native libgpod binding into the VM substrate and violate the "low-level substrate, no domain deps" intent (proposal §2.1) and the spirit of D8 (build tooling stays lean).
- **Recommendation:** `@podkit/lima` depends **only on `@podkit/device-types`** (for the `SubprocessRunner` interface) and ships its own minimal default `execFile`-based runner in `src/subprocess.ts` (the real impl currently lives at `packages/podkit-core/src/subprocess-runner.ts` — port/duplicate the ~small execFile wrapper, not the package). `@podkit/core` can later re-export *lima's* default if de-duplication is wanted, but the dependency arrow must point core→lima or neither, never lima→core.
- The DI seam itself is preserved unchanged: every function keeps its `subprocess?: SubprocessRunner` last-arg, and tests inject scripted runners exactly as today.
- Flagged as an open item to ratify (see §Open items): "where does the default runner live."

### `paths.ts` generalization
`runners/paths.ts:25` anchors on the substring `/test-packages/device-testing/`. In core that marker is wrong. Replace with a workspace-root finder (walk up for `bun.lock`/`turbo.json`, or accept an injected root). `resolve-binaries.ts` and `transport.ts` consume `repoRoot()`; they must resolve the same repo root regardless of which package they run from.

### Re-export shim (completeness is a release-blocker risk)
`@podkit/device-testing/src/index.ts` (read in full) currently exports the moved symbols at these barrel sites — the shim must re-export **all** of them from `@podkit/lima` so downstream (`@podkit/e2e-vm-tests`) is untouched:
- `transferBinary, transferGpodTool, DEFAULT_PODKIT_VM_PATH, DEFAULT_PODKIT_DEBUG_VM_PATH, DEFAULT_GPOD_TOOL_VM_PATH` (index.ts:97-104)
- `instanceStatus, resolveDefaultPodkitBinary, resolveDefaultPodkitDebugBinary, resolveDefaultDaemonLinuxBinary, resolveDefaultPodkitMuslBinary, resolveDefaultDaemonLinuxMuslBinary, resolveDefaultDummyHcdDaemonBinary, resolveDefaultGpodToolBinary, LIMA_DEVICE_HARNESS_VM_NAME, DEFAULT_DUMMY_HCD_DAEMON_VM_PATH` (index.ts:131-150 — note `createLimaTestVmRuntime`/`limaTestVmRunner`/sidecar/backing helpers STAY and are re-exported from their in-package location)
- `buildPodkitImageInVm, pullPodkitImageInVm, ensurePodkitImageInVm, DEFAULT_PODKIT_IMAGE_TAG, DOCKER_DIST_IMAGE_ENV, BUILD_CONTEXT_VM_DIR` + their types (index.ts:153-166)
- `SubprocessRunner, SubprocessRunOpts, SubprocessRunResult, defaultSubprocessRunner` (index.ts:185-186)
- `LIMA_DEVICE_HARNESS_VM_NAME` also consumed by `scripts/harness.ts:35`, `scripts/vm-doctor.ts:36`, `scripts/vm-install.ts:39`, `src/preflight.ts:32` — these device-testing scripts import it directly from `runners/lima-test-vm.js` today; re-point them to `@podkit/lima` (or keep via the barrel). After P2, `LIMA_DEVICE_HARNESS_VM_NAME` should resolve to `getVm('device').instanceName` (single source), with the constant kept as a shim alias.

**Verification of shim completeness:** `bun run typecheck` across the repo + `bunx turbo run @podkit/e2e-vm-tests#test:vm --dry=text` (resolves imports without running the VM). Any missing re-export fails typecheck.

### Turbo `inputs` repoint (moved files — P1 subset)
`vm:install` (`turbo.json:259-274`) and `vm:doctor` (`turbo.json:280-288`) list moved source files as inputs:
- `src/runners/lima-limactl.ts`, `src/subprocess.ts`, `src/baseline-hash.ts`, `src/runners/lima-test-vm.ts` (the parts used by these scripts) → now under `$TURBO_ROOT$/packages/lima/src/**`. Repoint these globs (or broaden to `$TURBO_ROOT$/packages/lima/src/**` + keep the device-testing-local script + apply-state inputs). `lima/podkit-device-harness.yaml` and `scripts/apply-state.sh` inputs stay in device-testing until P2.

### Ordering / parallelization (within P1)
1. Scaffold `packages/lima/` (package.json, tsconfig, empty `src/index.ts`), add to workspace, `bun install`.
2. Move the **leaf** mechanics first (no domain imports): `limactl.ts`, `paths.ts`, `subprocess.ts`, `status.ts`, `resolve-binaries.ts`, `transport.ts`, `baseline.ts`, `docker-image.ts` — with their `.test.ts` files. (These can be moved in parallel by file; they only import each other.)
3. Add `registry.ts` (current names), `lock.ts` (+ tests), `lifecycle.ts` (+ tests), `cli.ts`, `bin/podkit-vm.ts`.
4. Split `lima-test-vm.ts` in device-testing: delete the moved symbols, import them from `@podkit/lima`; keep the runtime factory + domain helpers.
5. Write the re-export shim in `device-testing/src/index.ts`; re-point device-testing scripts (`harness.ts`, `vm-install.ts`, `vm-doctor.ts`, `preflight.ts`) and `lima-docker-image` consumers.
6. Repoint P1-subset turbo inputs; add a changeset if any distributed package's build inputs change (none published here, but note in the PR).

### Verification
- Static: `bun run lint`, `bun run typecheck`, `bun run build` (repo-wide), `bunx turbo run @podkit/e2e-vm-tests#test:vm --dry=text`.
- Unit: `bun test --filter @podkit/lima` (moved unit tests + lock unit + lock integration) and `bun test --filter @podkit/device-testing`.
- Behavioural (infra): one `bun run vm:up` (new alias → `podkit-vm ensure podkit-device-harness`) + `bunx turbo run @podkit/device-testing#vm:doctor` to confirm the moved baseline/status code still drives a real VM.

### Risks + rollback
- **Shim incompleteness** (highest) → typecheck/e2e DAG break. Mitigation: the enumerated export list above; typecheck is the gate.
- **Accidental `@podkit/lima`→`@podkit/core` edge** (via the subprocess default) reintroduces heavy deps into build tooling. Mitigation: dep-only-on-device-types rule; add a `manypkg`/lint check or a package.json review note.
- **`lima-test-vm.ts` split** mis-slices a domain vs mechanic symbol → cycle. Mitigation: the explicit split list; `bun run build` catches cycles.
- Rollback = revert the package + restore the barrel (git). No data/VM state touched in P1 (names/paths unchanged), so nothing to re-provision.

---

## P2 — Consolidate all YAMLs into the registry + rename instances (D12)

### Goal + exit criteria
- All 7 YAMLs live under `packages/lima/vms/`; the registry `yamlPath` fields point there; instance names renamed per D12. Every turbo `inputs` glob and every hardcoded instance literal (TS/shell/mise) that referenced the old locations/names is repointed.
- **Green =** `bunx turbo run <vm-touching tasks> --dry=text` shows the new `packages/lima/vms/**` inputs; a cold `bun run vm:up` + `harness:install` + `vm:doctor` cycle re-provisions and seals cleanly on the renamed `podkit-device` instance; `bun run quality` (or a scoped subset) passes.

### YAML → new-instance mapping (D12)
| Registry `id` | current file | new file (`packages/lima/vms/`) | new Lima instance | was |
|---|---|---|---|---|
| `device` | `test-packages/device-testing/lima/podkit-device-harness.yaml` | `podkit-device.yaml` | `podkit-device` | `podkit-device-harness` |
| `builderGlibc` | `test-packages/device-testing/lima/podkit-linux-builder.yaml` | `podkit-builder-glibc.yaml` | `podkit-builder-glibc` | `podkit-linux-builder` |
| `builderMusl` | `test-packages/device-testing/lima/podkit-musl-builder.yaml` | `podkit-builder-musl.yaml` | `podkit-builder-musl` | `podkit-musl-builder` |
| `testGlibc` | `tools/lima/podkit-tests-debian-glibc.yaml` | `podkit-test-glibc.yaml` | `podkit-test-glibc` | `podkit-tests-debian-glibc` |
| `testMusl` | `tools/lima/podkit-tests-alpine-musl.yaml` | `podkit-test-musl.yaml` | `podkit-test-musl` | `podkit-tests-alpine-musl` |
| `virtualIpod` | `tools/lima/podkit-virtual-ipod.yaml` | `podkit-virtual-ipod.yaml` | `podkit-virtual-ipod` (keep) | — |
| `abiVerify` | `test-packages/device-testing/lima/podkit-abi-verify.yaml` | `podkit-abi-verify.yaml` | `podkit-abi-verify` (keep) | — |
(virtual-iPod + abi-verify registry *entries* land in P4 per phasing, but their YAMLs can move in P2 with the rest; only the entries/lifecycle wiring wait.)

### Turbo `inputs` globs to repoint (exhaustive — grepped)
Every occurrence of a lima yaml path in `turbo.json`:
- `@podkit/device-testing#test:vm` inputs (`turbo.json:245`): `.../device-testing/lima/**` → `$TURBO_ROOT$/packages/lima/vms/**` (or narrow to `podkit-device.yaml`). Keep the `apply-state.sh` input (`turbo.json:246`) — stays in device-testing.
- `@podkit/device-testing#vm:doctor` inputs (`turbo.json:286`): `lima/podkit-device-harness.yaml` → `$TURBO_ROOT$/packages/lima/vms/podkit-device.yaml`; keep `scripts/apply-state.sh` (`:287`).
- `@podkit/e2e-vm-tests#test:vm` inputs (`turbo.json:307`) and `#test:e2e:docker-dist` inputs (`turbo.json:328`): `.../device-testing/lima/**` → `packages/lima/vms/**`; keep the `apply-state.sh` inputs.
- `@podkit/device-testing#build:linux-prebuild` inputs (`turbo.json:346`): `.../lima/podkit-linux-builder.yaml` → `packages/lima/vms/podkit-builder-glibc.yaml`.
- `@podkit/device-testing#build:linux-binary` inputs (`turbo.json:374`): same yaml → `podkit-builder-glibc.yaml`.
- `@podkit/device-testing#build:musl-prebuild` inputs (`turbo.json:401`): `.../podkit-musl-builder.yaml` → `podkit-builder-musl.yaml`.
- `@podkit/device-testing#build:musl-binary` inputs (`turbo.json:424`): same → `podkit-builder-musl.yaml`.
- `@podkit/gpod-testing#build:linux-binary` inputs (`turbo.json:441`): `.../podkit-linux-builder.yaml` → `podkit-builder-glibc.yaml`.
- P0's `ensure:linux-builder` input (§P0) → `packages/lima/vms/podkit-builder-glibc.yaml`, and rename the node to `@podkit/lima#ensure:podkit-builder-glibc` (D11).

### baseline-hash tracked-file paths (one-time re-provision)
`src/baseline.ts` (was `baseline-hash.ts:46-49`) tracks **two files that now live in different packages**:
- `lima/podkit-device-harness.yaml` → `packages/lima/vms/podkit-device.yaml` (now in core).
- `scripts/apply-state.sh` → **stays in `@podkit/device-testing`** (domain, D7).
So the device VM's baseline set spans packages. Represent it via `VmDefinition.trackedForBaseline` holding **resolved absolute paths** (core resolves its yaml; device-testing contributes `apply-state.sh` when it calls `sealBaseline`/`checkDrift`, or the registry entry records both absolute paths). Changing these paths changes the combined hash → **a one-time drift** → the first `vm:doctor` after P2 fails and the developer runs `vm:recover` (or `harness:destroy && setup`) once. This is expected and bounded (the same one-time cost the decisions doc accepts). Preserve declaration order (yaml then apply-state.sh) so the hash only changes because of the path move, not a reorder.

### Instance-name literals to repoint (TS/shell/mise)
- TS const `LIMA_DEVICE_HARNESS_VM_NAME = 'podkit-device-harness'` (`lima-test-vm.ts:62`) → registry-derived `getVm('device').instanceName = 'podkit-device'`; keep the exported constant as a shim alias.
- `harness.ts:68` `BUILDER_VM = 'podkit-linux-builder'` → `getVm('builderGlibc').instanceName`.
- Shell env defaults: `build-*.sh` `${BUILDER_VM_NAME:-podkit-linux-builder}` / `${MUSL_BUILDER_VM_NAME:-podkit-musl-builder}` → new names (these scripts get thinned in P3; at minimum update the defaults in P2, or fold into P3).
- `run-tests.sh:149-159` literals `podkit-tests-debian-glibc` / `podkit-tests-alpine-musl` → new names (P3 thins this; update literals here or in P3).
- `mise.toml` literals: `test:linux:stop`/`:destroy`/`:cache:clear` (lines 83, 87, 92-93) reference the old test-VM names; `vipod:*` reference `podkit-virtual-ipod` (unchanged). Update the test-VM literals to `podkit-test-glibc`/`podkit-test-musl`.

### Ordering / parallelization
1. `git mv` the YAMLs into `packages/lima/vms/` (rename files to the new basenames).
2. Update `registry.ts` `yamlPath` + `instanceName` for all entries.
3. Repoint all turbo `inputs` (mechanical; one commit).
4. Update `baseline.ts` tracked-file resolution to the cross-package set.
5. Update instance-name literals (TS shim alias + shell/mise defaults).
6. Do this at a quiet point (it invalidates VM-build caches once and forces one re-provision).

### Verification
- `bunx turbo run @podkit/device-testing#vm:install @podkit/e2e-vm-tests#test:e2e:docker-dist --dry=text` — every input now shows `packages/lima/vms/**`; no dangling `device-testing/lima/**` or `tools/lima/*.yaml` references remain (`grep -rn "device-testing/lima\|tools/lima/podkit-" turbo.json mise.toml **/*.sh **/*.ts` returns only intended/none).
- Cold re-provision: destroy the renamed instances, `bun run vm:up` (device) → `harness:install` → `vm:doctor` seals + passes; `mise run test:linux:debian` boots `podkit-test-glibc`.
- Regression: `bun run quality` (or scoped `qa` + `test:e2e:docker-dist`).

### Risks + rollback
- **One-time cache invalidation + re-provision** (the headline P2 risk): first VM builds re-run (no cache hit) and the device VM must be recreated once for the baseline reseal. Mitigation: schedule at a quiet point; call it out in the PR/changeset; `vm:recover` is now a one-liner.
- **Missed literal** (an old instance name left in a shell/mise string) → a task targets a now-nonexistent VM. Mitigation: the grep sweep above; the `--dry=text` + a real boot per category.
- Rollback: revert the moves (git) — but if instances were already renamed+re-provisioned, the old-named VMs are gone; rollback means re-provisioning under old names. Prefer forward-fix.

---

## P3 — Thin the host build scripts + `run-tests.sh` to call `podkit-vm` (D8)

### Goal + exit criteria
- The host **orchestration wrappers** (`build-linux-prebuild.sh`, `build-linux-binary.sh`, `build-musl-prebuild.sh`, `build-musl-binary.sh`, `build-gpod-tool-linux.sh`) and `tools/lima/run-tests.sh` no longer contain their own status→start/create case blocks or bespoke rsync-exclude lists; they call `bunx podkit-vm ensure <instance>` for lifecycle and `podkit-vm run … --stage`/`copyOut` (or the shared rsync helper) for transport. **`tools/prebuild/*` recipes are untouched and never import core** (D8).
- **Green =** the builder/test/musl builds still produce identical artifacts; `.github/workflows/prebuild.yml` still runs `tools/prebuild/*.sh` directly with no Lima (unchanged); `mise run test:linux` still boots + tests both VMs.

### Which `limactl start`/create call sites are stripped and what replaces them
| Script | strip | replace with |
|---|---|---|
| `build-linux-prebuild.sh:47-65` (create/start case) | whole block (P0 already removed most) | `bunx podkit-vm ensure podkit-builder-glibc` (or rely on turbo `ensure` dep + assume-running) |
| `build-linux-binary.sh:37-46` (start-if-stopped) | block | assume-running (turbo `ensure` dep) or `podkit-vm ensure` |
| `build-gpod-tool-linux.sh:31-40` | block | assume-running (turbo `ensure` dep) |
| `build-musl-prebuild.sh:32-50` (create/start case) | block | `bunx podkit-vm ensure podkit-builder-musl` + new turbo `@podkit/lima#ensure:podkit-builder-musl` node |
| `build-musl-binary.sh:50-58` (start-if-stopped) | block | assume-running (turbo `ensure` dep) |
| `run-tests.sh:28-59` `ensure_vm()` | whole function | `bunx podkit-vm ensure podkit-test-glibc` / `podkit-test-musl` |
| `mise.toml` `test:linux:stop`/`:destroy` raw `limactl` | (optional) | `podkit-vm stop/destroy <instance>` for one code path |
The shared **rsync-to-`/tmp`-VM-local** pattern (duplicated across all five build scripts + `run-tests.sh` with subtly different exclude lists — e.g. `build-linux-prebuild.sh:96-110`, `build-gpod-tool-linux.sh:65-77`, `run-tests.sh:78-106`, `mise.toml` `vipod:install:129-142`) collapses to `stageSourceTree(vm, { excludes })` in `@podkit/lima/src/transport.ts`, with the exit-24 tolerance centralized. Reconcile the exclude lists into one canonical set (they drifted; unify).

### D8 invariant (must hold)
`tools/prebuild/build-linux-glibc.sh`, `build-linux-musl.sh`, `build-static-deps.sh`, `get-cflags.sh`, `get-ldflags.sh` stay put and gain **no** import of `@podkit/lima`. `prebuild.yml` invokes them directly (verified: `bash tools/prebuild/build-static-deps.sh` at lines 72/182/256, `bash tools/prebuild/build-linux-glibc.sh` at line 109 — no `limactl`, no Lima). The host wrappers call `podkit-vm ensure` then `runInVm(vm, 'bash tools/prebuild/build-linux-glibc.sh')` — the recipe remains callable without a VM (the "one recipe, two callers" rule from ADR-016).

### Ordering / parallelization
Per script, independently: swap the lifecycle block for `podkit-vm ensure`, swap the inline rsync for `stageSourceTree`, keep the in-VM recipe invocation + `copyOut`. Do `run-tests.sh` last (two VMs, most surface). Parallelizable across scripts.

### Verification
- `bunx turbo run @podkit/device-testing#build:linux-prebuild --force` and `#build:musl-prebuild --force` produce the same `packages/libgpod-node/prebuilds/**` artifacts.
- `bun run harness:install` (drives `build:linux-binary` + gpod-tool) succeeds; `podkit --version` inside the device VM works.
- `mise run test:linux` boots `podkit-test-glibc` + `podkit-test-musl` and runs the suite.
- **CI-invariant check:** `grep -rn "podkit-vm\|@podkit/lima\|limactl" tools/prebuild/` returns nothing; `prebuild.yml` diff is empty.

### Risks + rollback
- **A wrapper's rsync exclude semantics change** during unification → a needed file leaks or a needed file is dropped from the VM build. Mitigation: diff the unified exclude set against each script's current set; keep the union unless a specific exclude is proven safe to drop.
- **`podkit-vm` not on PATH** inside CI/host context where a wrapper runs → `bunx podkit-vm` (workspace bin) must resolve; verify the bin is linked (see open item on publish/link).
- Rollback: per-script revert; the recipes are untouched so CI is never at risk.

---

## P4 — Virtual-iPod config into registry; abi-verify manual entry; docs + ADR

### Goal + exit criteria
- Registry contains `virtualIpod` (category `demo`) and `abiVerify` (category `abi-verify`) entries. `vipod:*` mise lifecycle + the in-VM `@podkit/virtual-ipod-server` app are **unchanged** (D9). abi-verify is a manual on-demand entry, **not** auto-wired into CI (D4).
- Docs updated; a new ADR reconciles with ADR-016.
- **Green =** `mise run vipod:create` still works against the registry-recorded YAML; `podkit-vm ensure podkit-abi-verify` boots the ABI VM on demand; docs build.

### Registry entries + wiring
- `virtualIpod`: `{ id:'virtualIpod', instanceName:'podkit-virtual-ipod', yamlPath: vms/podkit-virtual-ipod.yaml, category:'demo' }`. `mise.toml vipod:create` (line 103) can optionally call `bunx podkit-vm ensure podkit-virtual-ipod`, but per D9 leaving the raw `limactl` lifecycle is acceptable — at minimum repoint the YAML path literal to `packages/lima/vms/`.
- `abiVerify`: `{ id:'abiVerify', instanceName:'podkit-abi-verify', yamlPath: vms/podkit-abi-verify.yaml, category:'abi-verify' }`. No CI. It becomes reachable via `podkit-vm ensure/shell podkit-abi-verify` for the documented manual ldd/ABI check (TASK-410 AC#7). Formalizing an automated ldd gate is a future task (D4).

### Docs + ADR list
- `agents/device-testing.md` — replace `harness:*` quick-start with `vm:*`; document `podkit-vm` verbs; note the registry as the single source of VM names/configs.
- `test-packages/device-testing/lima/README.md` — now that YAMLs moved, either delete or leave a stub pointing to `packages/lima/vms/`.
- `tools/lima/README.md` — same; point test-runner + demo YAMLs to `packages/lima/vms/`.
- `packages/lima/README.md` (new) — the substrate's own doc: registry, `podkit-vm`, lock, `ensure*` contract.
- `documents/architecture/testing/vm-build-orchestration.md` — update §6 "Builder-VM lifecycle … No turbo involvement" (now there IS a turbo `ensure` node + a lock) and §7 "Multiple VMs … the same pattern should be lifted into a shared helper" (now realized — mark done, link `@podkit/lima`).
- Root `AGENTS.md` Quick Reference + "Entry Points" table — swap `harness:*` for `vm:*`; add `@podkit/lima` entries (registry, `podkit-vm`, lifecycle).
- **New ADR** (e.g. `adr/adr-0NN-vm-orchestration-package.md`) — records the `@podkit/lima` extraction + lock + registry; explicitly reconciles with **ADR-016**: physical builder/test/device VM separation is **preserved** (no VMs merged — `podkit-builder-glibc`, `podkit-builder-musl`, `podkit-device` remain distinct instances with distinct provisioning; the ABI-masking guarantee is untouched), and ADR-016's "one recipe, two callers" rule for `tools/prebuild/*` is preserved (D8). Only *orchestration + config ownership* is centralized. File it Accepted when P1 lands (or retroactively reference P1); this P4 step ensures it's written even if deferred.

### Verification
- `mise run vipod:create` + `vipod:destroy` round-trip; `podkit-vm shell podkit-abi-verify` after `ensure`.
- `bun run docs:build` (Starlight) passes; markdown links resolve.
- ADR present + linked from the touched architecture doc.

### Risks + rollback
- Low. Docs/registry-metadata only; no build-path or lock changes. Rollback = revert docs + registry entries.

---

## 4. Global sequencing + what can parallelize
- **P0** ships immediately, standalone (D15). Independent of P1+.
- **P1** is the big lift; gated on this plan's approval. Within P1, leaf-mechanic moves parallelize; the `lima-test-vm.ts` split + shim are the serial critical path.
- **P2** depends on P1 (registry must exist). Its file moves + input repoints are mechanical but incur the one-time re-provision — schedule at a quiet point.
- **P3** depends on P2 (renamed instances + `podkit-vm` CLI). Per-script, parallelizable.
- **P4** depends on P2 (registry) for the two entries; docs/ADR can be drafted in parallel with P3.

## 5. Open items to flag (do not invent — for implementer / follow-up)
1. **Lock library choice (D2).** Recommendation: `proper-lockfile` (pure-JS, mtime staleness + heartbeat, no native dep) behind `src/lock.ts`. Alternative: hand-rolled pidfile + `kill(0)`. Ratify before P1 (it's a new dependency in `bun.lock`). Tradeoff documented in §1.
2. **Where the default `SubprocessRunner` lives.** To keep `@podkit/lima` free of an `@podkit/core` dependency (core pulls the native `@podkit/libgpod-node` + `music-metadata` + `subsonic-api`), the default runner should be ported into `@podkit/lima` (dep only on `@podkit/device-types` for the interface) or into `@podkit/device-types` itself. Confirm the direction; ensure the arrow never points lima→core.
3. **Is `podkit-vm` published/linked?** The package is private (D6), but the `bin` must be resolvable by shell wrappers + turbo (`bunx podkit-vm`). Decide: workspace `bin` link (bun resolves workspace bins) vs. invoking via `bun run --cwd packages/lima podkit-vm`. Affects P3 wrappers + CI PATH.
4. **Re-export shim deprecation timeline.** D3 permits removing the shim eventually and migrating `@podkit/e2e-vm-tests` (+ any other consumer) to import Lima symbols from `@podkit/lima` directly. Decide whether P1 keeps the shim indefinitely or a later task rewrites import sites and drops it.
5. **`trackedForBaseline` cross-package representation.** The device VM's baseline spans `@podkit/lima` (yaml) + `@podkit/device-testing` (`apply-state.sh`). Decide whether the registry entry records both absolute paths, or core exposes `sealBaseline(vm, extraFiles)` and device-testing supplies `apply-state.sh`. Either works; pick one before P2 so the hash is stable.
6. **Optional `ensure:musl-builder` in P0 vs P1.** The musl builder is not currently raced (one `dependsOn:[]` starter). Decide whether to add the ensure node in P0 for symmetry or defer to P1/P2.
7. **`quality` vs `quality:rc` serialization retirement (D2 follow-on).** Once the device-instance lock lands, `run-mirror-body.ts`'s manual two-phase sequencing can be replaced by the lock. Explicitly out of scope here; file as a follow-on task.
8. **`vipod:*` lifecycle adoption of `podkit-vm` (D9).** Left as raw `limactl` for now; revisit if the demo VM grows a `test:vm`-style suite.

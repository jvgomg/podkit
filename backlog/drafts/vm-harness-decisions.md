# VM-harness consolidation — settled design decisions

Companion to `vm-harness-package-design.md` (the proposal). These are the maintainer-approved
decisions from a grilling session; they OVERRIDE the proposal wherever they differ. The
implementation plan must conform to these.

## Ambition, phasing, coordination
- **D1 — Full extraction.** Extract a new first-class VM-orchestration package (not a
  minimum-viable helper inside `@podkit/device-testing`). Ship the **P0 race-fix standalone first**,
  before the package work.
- **D2 — Two-layer coordination + start-only contract.** (1) a turbo `ensure:<vm>` ordering node
  that is the ONLY place a shared VM is created/started; (2) a per-instance **advisory lock**
  (liveness-aware, stale-reclaiming — no `flock(1)` on macOS) wrapping check-then-start, invoked
  through ONE shared CLI so TS + shell + turbo hit a single lock code path. `ensureRunning`
  **never auto-stops** a shared VM; **no reference-counting** (only explicit ops stop VMs; the
  Lima builders are macOS-local-only, CI builds run natively so nothing needs auto-teardown).
  The same lock keyed on the device VM can later retire the hand-rolled `quality` vs `quality:rc`
  serialization — follow-on, not scope.
- **D3 — No backward-compat constraint.** Free to rename mise tasks, `bun run` scripts, turbo task
  IDs, and VM instance names. (Turbo task-suite *semantics* like `test:vm` stay meaningful, but no
  name is frozen for compat.)

## Scope of the package
- **D4 — abi-verify kept as a manual on-demand registry entry.** Not deleted (it's a real,
  documented manual ABI check — TASK-410 AC#7, README run steps), not auto-wired into CI yet.
  Formalizing it into an automated ldd gate is a future task.
- **D5 — Package name: `@podkit/lima`.** Names the substrate precisely; frees "harness"/"vm"/
  "device-testing" for higher-level test concepts. Accepts coupling the name to the Lima backend
  (podkit's VM story is Lima-on-macOS; no realistic second backend).
- **D6 — Placement: `test-packages/lima/` (AMENDED).** The maintainer reconsidered: the package is
  private test/build infra, so `test-packages/` is the honest home (not `packages/*`, which is
  published-adjacent). `test-packages/*` is already a workspace glob, so no root `package.json`
  workspaces change is needed, and the `@podkit/lima` package name is independent of directory.
  (Earlier this was `packages/lima/`; the package location moved, name unchanged.)
- **D7 — The cut (one core owns config + lifecycle).** `@podkit/lima` owns the Lima **substrate**:
  limactl wrapping (`lima-limactl`), idempotent `ensure*` lifecycle + advisory lock + the shared
  CLI, the **VM config registry (all YAMLs)**, `baseline-hash` + drift + `recover`, and generic
  transport (`runInVm`/`stageSourceTree`/`copyOut`). `@podkit/device-testing` KEEPS everything
  domain-coupled: personas, system-states, `apply-state.sh`, the daemon-gadget synthesis
  (`device-testing-daemon`), `vm/` fixtures, and runners that reference those domain types
  (`lima-test-vm-state`, `-systemd`). Dividing line: **imports `@podkit/core`/`device-types` or
  references personas/system-states → stays in device-testing; pure Lima mechanics → core.**
  `lima-docker-image` (pull/build an image *in* a VM) → **core** (no persona/system-state coupling).
  ONE core package owns both config and lifecycle (do not split config-assets into a separate pkg).
- **D8 — Build-tooling boundary.** In-VM build **recipes** (`tools/prebuild/*`) STAY put and never
  import the core — CI's `prebuild.yml` runs them directly with no Lima (verified: bash calls at
  prebuild.yml lines 72/109/182/256), and ADR-016's "one recipe, two callers" must hold. Only the
  **host orchestration wrappers** (`build-linux-prebuild.sh`, `build-linux-binary.sh`,
  `build-musl-*`, `build-gpod-tool-linux.sh` — the "ensure builder VM + rsync + run recipe inside +
  copy out" parts, where the race lives) become thin callers of the core.
- **D9 — Virtual-iPod: config only.** Fold `podkit-virtual-ipod.yaml` into the core registry as a
  `demo` category entry; leave the `vipod:*` lifecycle tasks and the in-VM `@podkit/virtual-ipod-server`
  app where they are (bespoke gadget serving, different cadence). Revisit if it grows a
  `test:vm`-style suite.

## Config + naming
- **D10 — Config registry mechanism: typed TS registry over co-located declarative YAML.**
  `VmDefinition[]` (id, instanceName, yaml-asset path, category, arch-relevance,
  tracked-for-baseline) in typed TS; the actual Lima spec stays native YAML in the core's `vms/`
  (readable, yamllint-able, no codegen). Arch stays a RUNTIME in-VM concern (`uname -m`), not a
  config-generation axis.
- **D11 — Naming taxonomy.** Core CLI bin **`podkit-vm`** (the single lock chokepoint), verbs
  `ensure|status|stop|destroy|recover|install|doctor|shell <instance>`. Developer commands
  **`bun run vm:*`** replace `bun run harness:*` (`vm:up`, `vm:down`, `vm:status`, `vm:recover`,
  `vm:shell`), thin wrappers over `podkit-vm`. **AMENDED (consequence of the D13 amendment): NO turbo
  `@podkit/lima#ensure:<instance>` nodes** — a `cache:false` ensure node boots the VM on cache hits.
  Coordination is the **shared cross-process lock only** (P0 `vm-builder-lock.sh` → P1 `podkit-vm`
  CLI on proper-lockfile); every start path (build scripts, `harness.ts`, `run-tests.sh`, the CLI)
  funnels through that one lock. This makes the design single-layer, not the two-layer model the
  plan/D2 originally described.
  Keep test-suite task names (`test:vm`, `test:e2e:docker-dist`). `mise run test:linux` stays as a
  suite name; its ensure-VM step routes through `podkit-vm`.
- **D12 — Instance renaming: rename all to a consistent scheme.** Registry `id`s are clean TS
  identifiers (free); Lima instance strings renamed per below (one-time destroy+re-provision, which
  P2's config moves already incur). Keep the `podkit-` prefix (collision avoidance).

  | role | new Lima instance | was |
  |---|---|---|
  | device-synthesis harness | `podkit-device` | `podkit-device-harness` |
  | glibc builder | `podkit-builder-glibc` | `podkit-linux-builder` |
  | musl builder | `podkit-builder-musl` | `podkit-musl-builder` |
  | glibc test runner | `podkit-test-glibc` | `podkit-tests-debian-glibc` |
  | musl test runner | `podkit-test-musl` | `podkit-tests-alpine-musl` |
  | demo | `podkit-virtual-ipod` (keep) | — |
  | manual ABI check | `podkit-abi-verify` (keep) | — |

## Testing + sequencing
- **D13 — P0 race-fix = shared cross-process lock (AMENDED; the turbo ordering-node was rejected on
  investigation).** The originally-approved turbo `ensure:<vm>` node does not work here: an ensure
  node must be `cache: false` (a side-effect), so turbo runs it on *every* invocation — booting the
  builder VM even when all prebuilds are cache hits (a regression: slower, and fails on a
  sleep-corrupted builder we don't otherwise need). And neither task can be the *sole* starter,
  because turbo caching means `gpod-testing#build:linux-binary` can independently be a cache-miss
  while `build:linux-prebuild` is a cache-hit (VM never started) — so both genuinely need a start
  path. The correct fix is therefore **mutual exclusion on the start, not ordering.**
  **Shipped P0 (commit e67f69ef):** a shared `vm-builder-lock.sh` (mkdir-atomic, liveness-aware via
  owning-shell PID, stale-reclaiming) wrapping the *lazy* check-then-start in
  `build-linux-prebuild.sh` + `build-gpod-tool-linux.sh`, with VM status read INSIDE the lock. This
  preserves lazy start (no VM boot on cached builds), fixes the race, needs no turbo-DAG change, and
  is the literal prototype of P1's `podkit-vm` lock (pulls D2's lock forward). Lock logic verified
  without a VM (concurrent serialize / stale reclaim / live-holder-blocks). NOTE: the plan file's P0
  section predates this and still describes the turbo-node — treat that section as superseded by this
  amendment.
- **D14 — Core test seam: injected `SubprocessRunner` DI.** The core preserves the scripted-runner
  DI seam (as in `lima-*.test.ts` / `resolve-rc-build.test.ts`) so lock + `ensure*` + registry
  logic is unit-tested with scripted `limactl` outputs, no real VMs. The lock's actual
  two-process mutual-exclusion gets a small real-process integration test.
- **D15 — Ship P0 now, standalone.** P0 lands immediately (independently valuable, stops a live
  intermittent failure). Everything P1+ waits for the implementation plan + maintainer review.

## Phasing (from the proposal, conformed to the above)
- **P0** race fix (D13, amended: shared cross-process lock, NOT a turbo node) — shipped, commit e67f69ef.
- **P1** extract `@podkit/lima` core (+advisory lock +`podkit-vm` CLI +`SubprocessRunner` seam);
  re-export shim from `@podkit/device-testing/src/index.ts` keeps import sites stable.
- **P2** consolidate all YAMLs into the core registry + rename instances (D12); accept the one-time
  cache-invalidation / re-provision.
- **P3** thin the host build scripts + `run-tests.sh` to call `podkit-vm`.
- **P4** virtual-iPod config into registry; abi-verify as manual registry entry; update
  `agents/device-testing.md`, both `lima/README.md`s, `vm-build-orchestration.md`; file a new ADR
  reconciling with ADR-016 (separation preserved; only orchestration + config centralized).

## Post-review resolutions (after independent plan review)

- **Lock library = `proper-lockfile`** (resolves plan open-item #1). New `bun.lock` dep; used for the
  P1 `podkit-vm` lock. We do NOT unify with the existing `packages/podkit-core/src/lib/pid-file.ts`
  device-sync lock — that stays separate (different context: FAT32/exFAT device mass-storage, where
  pid-file's start-time liveness + non-flock choice is deliberate). Two locks, two contexts, by choice.
- **Default `SubprocessRunner` home = `@podkit/device-types`** (resolves open-item #2). The interface
  already lives there (`device-types/src/subprocess.ts:53`); move the trivial `defaultSubprocessRunner`
  impl (only `node:child_process` execFile + the type) out of `@podkit/core` into `device-types`
  next to its interface, and re-export it from `@podkit/core`'s barrel so existing core consumers
  (ffmpeg, video-encoder, linux/macos platforms, usb-*) keep working. This breaks the disqualified
  `@podkit/lima → @podkit/core` edge (core pulls native `@podkit/libgpod-node` + `music-metadata` +
  `subsonic-api`). Note: this gives `device-types` its first runtime behaviour (accepted).

### Review must-fixes to fold into the plan before executing
- **MF1 — Plan P0 (§3) + conformance rows are stale.** Rewrite the plan's P0 to the SHIPPED bash lock
  (commit e67f69ef); drop the turbo-ensure-node prescription; fix the D2/D13 rows; delete plan
  open-item #6 (moot).
- **MF2 — Coordination is single-layer (lock only).** Strip every `@podkit/lima#ensure:<instance>`
  reference from the plan (§1, P2 rename, D11 row) to match the amended D11/D13.
- **MF3 — `computeBaselineHash` signature change is mandatory for P2 (hard crash, not drift).**
  `computeBaselineHash(packageRoot)` (`baseline-hash.ts:76`) joins BOTH tracked files
  (`lima/podkit-device-harness.yaml` + `scripts/apply-state.sh`) under ONE root and throws on a
  missing file. After P2 the yaml lives in `@podkit/lima` and `apply-state.sh` stays in
  device-testing → different roots → guaranteed throw on the first `vm:doctor`. Change the signature
  to an absolute-path list (or `(coreRoot, deviceTestingRoot)`), update BOTH callers
  (`harness.ts:546`, `vm-doctor.ts:83`), and preserve declaration order for hash stability.
- **MF4 — Lock cutover must be atomic (P3).** The bash lock (`mkdir`+owner-PID at
  `${TMPDIR}/podkit-vmlock-<VM>`) and the proper-lockfile CLI lock do NOT interoperate. When P3
  migrates the builder scripts onto the CLI, ALL starters of a given VM must flip in one step (or the
  CLI lock reuses the bash path/algorithm during transition). `vm-builder-lock.sh` stays authoritative
  until its scripts flip together; state its explicit removal point.

### Should-fix (P0 hardening — optional, low value since P1 replaces the bash lock)
- Residual UNLOCKED starters of the glibc builder: `build-linux-binary.sh:45` (DAG-ordered after
  prebuild, so not raced within a turbo run — only a manual concurrent invocation races). Musl
  starters (`build-musl-prebuild.sh`, `build-musl-binary.sh`) are unlocked but not currently raced
  (single `dependsOn:[]` starter). The P1 CLI lock covers all of these comprehensively.
- P0 lock nits: `600s` timeout can abort a legit >10-min cold create while the holder is alive
  (only time out while `kill -0 holder` fails); empty-owner permanent wedge if a holder is SIGKILLed
  in the `mkdir`→`echo $$` window; reclaim `rm`+`mkdir` TOCTOU. All low-probability; the P1 JS lock
  must not inherit them.

# Design Proposal: A first-class VM-harness package

**Status:** Draft for maintainer review — NOT an implementation plan.
**Author:** Agent investigation, grounded in repo read-through (2026-08).
**Scope:** Consolidate podkit's Lima-VM testing/build machinery into a first-class dependency that owns both (a) VM lifecycle/orchestration and (b) VM configuration definitions.

---

## TL;DR

- **Root cause is missing ownership, not a single bug.** Seven Lima VMs are driven by ~7 independent re-implementations of the same "check status → start/create/recreate" logic, across TypeScript (`harness.ts`, `lima-test-vm.ts`) and shell (`build-*.sh`, `run-tests.sh`), with **zero cross-process locking anywhere in the tree** (verified). The `harness:setup` hostagent-pidfile crash is one visible symptom of that gap; config scatter across two directories is another.
- **Recommendation: a small family, not one mega-package.** Extract a thin **VM-orchestration core** (`@podkit/lima`, working name) that owns limactl wrapping, idempotent `ensure(exists|running|installed)` primitives, **cross-process locking**, a **single VM registry + config directory**, and baseline-drift/recovery. Leave the **device-test runtime** (personas, system-states, `apply-state.sh`, daemon-gadget synthesis, `vm/` fixtures) in `@podkit/device-testing`, now *consuming* the core. Keep per-libc build recipes (`tools/prebuild/*`) where they are; make the host-side build scripts thin callers of the core.
- **Fix the race properly with belt-and-suspenders:** an explicit turbo ordering node (`ensure-linux-builder`) that both racing tasks depend on, PLUS a per-instance advisory lock in the core so manual/parallel invocations turbo can't see are still serialized. Keep the existing "start-only, never auto-stop a shared VM" contract (no refcount needed) and promote destroy+setup+reseal to a first-class `recover` operation.
- **Config becomes single-source-of-truth:** all YAMLs move under the core's `vms/` directory behind a typed registry (role → name, yaml, category, arch handling). Instance names (today scattered as consts, env defaults, and mise string literals) collapse to one place.
- **Preserve the public seams.** `bun run harness:*`, `mise run test:linux`, and every `turbo` task **name** stay stable — only the implementation moves. This keeps the blast radius (turbo DAG, quality gate, docs) small.

**The 7 open questions for the maintainer are at the very bottom.**

---

## 1. Problem framing

### 1.1 What exists today (verified inventory)

**Seven Lima VMs, configs split across two directories:**

| VM instance | Config location | Role | Driven by |
|---|---|---|---|
| `podkit-device-harness` | `test-packages/device-testing/lima/podkit-device-harness.yaml` | `test:vm` — dummy_hcd USB-gadget synthesis (FunctionFS + mass-storage) via the device-testing-daemon; also hosts `vm-docker-image` builds | `harness.ts`, `createLimaTestVmRuntime`, `lima-docker-image.ts`, `vm:install`/`vm:doctor` |
| `podkit-linux-builder` | `test-packages/device-testing/lima/podkit-linux-builder.yaml` | glibc prebuild + podkit/daemon binary + gpod-tool build | `build-linux-prebuild.sh`, `build-linux-binary.sh`, `build-gpod-tool-linux.sh` |
| `podkit-musl-builder` | `test-packages/device-testing/lima/podkit-musl-builder.yaml` | musl prebuild + binary | `build-musl-prebuild.sh`, `build-musl-binary.sh` |
| `podkit-abi-verify` | `test-packages/device-testing/lima/podkit-abi-verify.yaml` | **Orphaned.** A one-off ABI spike from TASK-321.07; referenced only in its own header comment — no code, turbo, or mise path uses it. | (nothing) |
| `podkit-tests-debian-glibc` | `tools/lima/podkit-tests-debian-glibc.yaml` | `mise run test:linux:debian` cross-libc test runner | `tools/lima/run-tests.sh` (`ensure_vm`) |
| `podkit-tests-alpine-musl` | `tools/lima/podkit-tests-alpine-musl.yaml` | `mise run test:linux:alpine` (Docker/musl parity) | `tools/lima/run-tests.sh` (`ensure_vm`) |
| `podkit-virtual-ipod` | `tools/lima/podkit-virtual-ipod.yaml` | Virtual-iPod demo VM (USB gadget + REST/WS server) | `mise.toml` `vipod:*` tasks |

### 1.2 Duplicated lifecycle logic (the sprawl)

The same "probe status → `Running`/`Stopped`/`NotFound`/`Broken` → start / create / delete+recreate" case block is re-implemented independently in **at least seven places**:

- `test-packages/device-testing/scripts/harness.ts` — the TS dispatcher (create/start/stop/destroy/shell/status/install/setup + `builder:stop`/`builder:destroy`).
- `test-packages/device-testing/src/runners/lima-test-vm.ts` — `createLimaTestVmRuntime().prepare()` re-does the status→start dance for the harness VM.
- `test-packages/device-testing/scripts/build-linux-prebuild.sh`
- `test-packages/device-testing/scripts/build-linux-binary.sh`
- `test-packages/device-testing/scripts/build-musl-prebuild.sh`
- `test-packages/device-testing/scripts/build-musl-binary.sh`
- `test-packages/device-testing/scripts/build-gpod-tool-linux.sh`
- `tools/lima/run-tests.sh` — `ensure_vm()`.

Each carries its own copy of: the `limactl list --format '{{.Status}}'` probe, the arch-suffix mapping (`x86_64→x64`, `aarch64→arm64`), the rsync-to-`/tmp` VM-local staging pattern (with subtly different exclude lists), and the "exit 24 is benign" rsync convention. `lima-limactl.ts` centralizes *invocation* for the TS side only; the shell scripts share nothing.

### 1.3 The race (root-caused)

`bun run harness:setup` intermittently dies:

```
[hostagent] level=fatal msg="another hostagent may already be running with pid …
(pidfile .../podkit-linux-builder/ha.pid)"
```

Confirmed cause in `turbo.json`:

- `@podkit/device-testing#build:linux-prebuild` → `dependsOn: []`
- `@podkit/gpod-testing#build:linux-binary` → `dependsOn: []`
- Both are transitive prerequisites of `@podkit/device-testing#vm:install`.
- `build:linux-prebuild.sh` and `build-gpod-tool-linux.sh` **both run `limactl start podkit-linux-builder`** on the shared builder VM.

Because neither task depends on the other and neither takes a lock, turbo schedules them **concurrently**, and two `limactl start` invocations fight over the same `ha.pid` hostagent pidfile. (`build-linux-binary.sh` is a third starter of the same VM, ordered only via its `dependsOn: build:linux-prebuild`.) `grep` for `flock|lockfile|pidfile|mutex` across the VM machinery returns **nothing** — there is no serialization by design.

This is a *symptom*. The **root cause** is that no single component owns "make VM X running" — so every call site re-derives it, and none coordinate.

**The builders are not the only shared VM.** The `podkit-device-harness` VM is *also* a shared, mutable-state resource: `test:vm` and `@podkit/e2e-vm-tests#test:e2e:docker-dist` both drive it and would collide on gadget/mount state if run concurrently, and the `quality` vs `quality:rc` mirrors are deliberately split into two phases in `run-mirror-body.ts` for exactly this reason. That coordination exists today only as *manual sequencing inside one script* — there is no primitive enforcing it. So "coordinate access to a shared VM" is a general need, not a builder-only patch.

### 1.4 Config scatter & conceptual blur

- YAMLs live in two trees with no rule for which goes where (test-runner + demo VMs in `tools/lima`; builder + harness + orphan in `test-packages/device-testing/lima`).
- Instance names are hardcoded in three different idioms: TS consts (`LIMA_DEVICE_HARNESS_VM_NAME`), shell env defaults (`${BUILDER_VM_NAME:-podkit-linux-builder}`), and raw mise string literals (`podkit-virtual-ipod`, `podkit-tests-debian-glibc`).
- `@podkit/device-testing`'s public surface (`src/index.ts`) already blurs four unrelated concerns: generic Lima infra (`lima-limactl`, `instanceStatus`, transfer helpers), device-domain fixtures (personas, system-states, sidecar), VM test fixtures (`vm/`), and release-candidate discovery (`rc-build`). The Lima infra is the part that wants to be a shared substrate.

### 1.5 Existing precedent in-repo

The architecture doc `documents/architecture/testing/vm-build-orchestration.md` already anticipates this consolidation:

- **§6 Scope boundaries:** "Builder-VM lifecycle. The `podkit-linux-builder` VM auto-creates on first use … **No turbo involvement.**" — i.e. the builder VM is explicitly *outside* any coordinated owner today.
- **§7 Open work → Multiple VMs:** "Only `podkit-device-harness` is in scope. The Linux test VMs … have their own lifecycles; **if any acquires a test:vm-style suite, the same pattern should be lifted into a shared helper.**"

That "shared helper" is precisely the core this proposal recommends. (See ADR-016 "Linux VM test harness" and ADR-025 "canonical test taxonomy" for the framing this builds on.)

**Reconciling with ADR-016 (the governing decision).** A backlog/ADR sweep found **no prior design** for consolidating this machinery or for VM locking — this is net-new ground. The one governing precedent is **ADR-016**, which *mandates physical separation* of the builder VM (full toolchain) from the test VM (stock, no dev libs), so a hidden dynamic-linkage regression surfaces as a test failure. TASK-464 later added the musl builder as a *third* VM explicitly "don't conflate builder + test roles." **This proposal is fully compatible with that invariant:** it consolidates the *lifecycle code and config ownership*, and does **not** merge any VMs — builder, musl-builder, and device-harness stay distinct instances with distinct provisioning. ADR-016 also established a "one build implementation, two callers" rule (the `tools/prebuild/*` recipes are shared verbatim between the local Lima builder and `.github/workflows/prebuild.yml`); §3.3 preserves that. There is a loose in-repo precedent for advisory locking — TASK-404 added a cross-process advisory lock for concurrent device *sync* — which the §4 VM lock can mirror in spirit. (TASK-410 hardened `build:linux-prebuild --force` against stale *intermediates*, not concurrency.)

---

## 2. Scope decision — what the harness should own

The machinery currently blurs six concerns. The key design move is to **cut the seam between generic VM orchestration and device-test domain logic**, and to recognize that the builder VMs are **build infrastructure for distributed artifacts**, not merely test infra.

| # | Concern | Today | Recommended owner |
|---|---|---|---|
| (a) | VM **config definitions** (YAMLs) | split `tools/lima` + `device-testing/lima` | **Core** — single `vms/` dir + typed registry |
| (b) | VM **lifecycle/orchestration + locking** | 7 copies, no lock | **Core** — the reason it exists |
| (c) | **Per-libc build tooling** (prebuilds/binaries) | `device-testing/scripts/build-*.sh` (host orchestration) + `tools/prebuild/*` (in-VM recipes) | **Split:** in-VM recipes stay in `tools/prebuild`; host scripts become thin callers of Core's `runInVm`/`ensureBuilder` |
| (d) | **Device-test runtime** (personas, system-states, `apply-state.sh`, daemon-gadget, `vm/` fixtures) | `@podkit/device-testing` | **Stays in `@podkit/device-testing`**, consuming Core |
| (e) | **Linux test runners** (`mise test:linux`) | `tools/lima/run-tests.sh` | Consumer of Core; test VMs become registry entries |
| (f) | **Virtual-iPod demo VM** | `tools/lima` + `mise vipod:*` | Config into registry (category `demo`); lifecycle can stay mise-driven initially |

### 2.1 Recommendation: a small family (one core + existing consumers)

**Create one new package — the VM-orchestration Core — and refactor the existing packages to consume it.** Do **not** fold the device-test domain into it.

**Why keep (d) out of the Core.** Personas and system-states depend on `@podkit/core` and `@podkit/device-types` (device capability/identity domain). The Core must be a *low-level substrate* with essentially no domain deps (just `limactl` + a subprocess seam + locking). Merging them would (1) drag domain deps into build tooling that runs on CI builders, (2) recreate the same "everything in one index.ts" blur we're trying to cut, and (3) risk a dependency tangle (build scripts pulling in `@podkit/core`). The device-test *runtime* is a legitimate, cohesive package; it should get **thinner**, not absorb a substrate.

**Why the Core owns config (a) and not just lifecycle (b).** Config and lifecycle are the two halves of "make VM X exist and run." Splitting them keeps the exact scatter we have now (names in one place, yamls in another). One registry that maps *role → {name, yaml, category, arch}* is the single source of truth every consumer reads.

### 2.2 Main alternative — and why not

**Alternative A: "Minimum viable" — no new package.** Just (1) add a turbo ordering node + a shared `ensure-vm` shell helper with `flock`-style locking inside `@podkit/device-testing`, and (2) dedupe the build scripts against it. This *fixes the race* and removes most duplication with far less churn.

- *Pros:* smallest blast radius; no cache-invalidating file moves; lands in days.
- *Cons:* leaves config split across two trees; leaves the conceptual blur in `device-testing/src/index.ts`; the "shared helper" ends up living inside a package named for one specific VM (`device-testing`) while also serving builders, test-runners, and the demo — the ownership story stays muddy. It treats the symptom (race) without establishing the owner (root cause).

**Alternative B: "One mega-package" — Core absorbs personas/system-states/runtime too.** Rejected for the dependency and cohesion reasons in §2.1.

**Recommendation:** ship Alternative A's race fix **first as a standalone step** (it's independently valuable and low-risk — see §6 Phase 0), then proceed with the Core extraction. The two are complementary, not competing: Phase 0 is the lock; the Core is the owner.

---

## 3. Proposed package boundary + public interface

### 3.1 Name & placement

Working name **`@podkit/lima`** (the VM substrate). Alternatives: `@podkit/vm-harness`, `@podkit/vm-orchestration`. Note "harness" is already overloaded (device-harness), so a Lima-specific or "orchestration" name reads cleaner. **Placement is a genuine question (see Q2):** it is *both* test infra and build infra (builder VMs produce the `libgpod-node` prebuilds that ship in distributed binaries), so `test-packages/` slightly undersells it. Options: keep under `test-packages/` for proximity to its biggest consumer, or introduce a `tooling/` workspace. It stays **private** either way (nothing here publishes to npm).

### 3.2 Public interface (illustrative)

```ts
// @podkit/lima — VM registry
export type VmCategory = 'device-harness' | 'builder' | 'test-runner' | 'demo';
export interface VmDefinition {
  id: string;              // logical role, e.g. 'linux-builder'
  instanceName: string;    // Lima instance name, e.g. 'podkit-linux-builder'
  yamlPath: string;        // absolute path into this package's vms/ dir
  category: VmCategory;
  baseline?: string[];     // files whose change means "re-provision" (drift)
}
export function getVm(id: string): VmDefinition;
export function listVms(category?: VmCategory): VmDefinition[];

// Idempotent lifecycle primitives — the single implementation of the
// status→start/create dance, guarded by a per-instance cross-process lock.
export function ensureExists(vm: VmDefinition, opts?): Promise<void>;
export function ensureRunning(vm: VmDefinition, opts?): Promise<void>;   // acquires lock, re-checks, starts
export function status(vm: VmDefinition): Promise<'missing'|'running'|'stopped'|'broken'>;
export function stop(vm: VmDefinition): Promise<void>;
export function destroy(vm: VmDefinition, opts?): Promise<void>;

// Command + build execution inside a VM (absorbs the rsync-to-/tmp pattern).
export function runInVm(vm, argv, opts?): Promise<{stdout;stderr;exitCode}>;
export function stageSourceTree(vm, opts?): Promise<string>;   // the shared rsync-with-excludes
export function copyOut(vm, vmPath, hostPath): Promise<void>;

// Provisioning-baseline drift + recovery (generalized from baseline-hash.ts).
export function computeBaseline(vm): { combinedSha; files };
export function sealBaseline(vm): Promise<void>;
export function checkDrift(vm): Promise<{ ok: boolean; reason?: string }>;
export function recover(vm): Promise<void>;   // destroy + create + start + (re-provision hook) + reseal

// A single CLI so shell/turbo callers share the ONE lock implementation:
//   bunx podkit-vm ensure linux-builder
//   bunx podkit-vm run   linux-builder -- make -C tools/gpod-tool
//   bunx podkit-vm recover device-harness
```

### 3.3 How it composes with existing packages

- **`@podkit/device-testing`** keeps personas/system-states/`vm/`/`apply-state.sh`/rc-build, but its `runners/lima-*.ts`, `lima-limactl.ts`, `instanceStatus`, transfer helpers, and `baseline-hash.ts` move to (or re-export from) `@podkit/lima`. `harness.ts` becomes a thin CLI over Core primitives + the device-harness-specific install steps (binary/daemon/gpod-tool/unit transfer stay here — they're harness domain). The package's own `src/index.ts` re-exports the Core symbols it used to export, so **downstream import sites (`@podkit/e2e-vm-tests`) don't churn**.
- **`@podkit/gpod-testing`** — its `build:linux-binary` script calls `ensureBuilder`/`runInVm` from Core instead of its own `limactl` block. The turbo task **name stays**; it gains a `dependsOn` on the shared ensure node (§4).
- **`@podkit/device-testing-daemon`** — unchanged (host-built static binary; no VM start). It remains an independent package; the harness install path in Core/device-testing references its build output.
- **Docker surfaces** — `lima-docker-image.ts` (builds the image *inside* the device-harness VM) moves to or consumes Core's `ensureRunning(device-harness)` + `runInVm`; `packages/podkit-docker/test/image-smoke.sh` is a host-only surface and is untouched.
- **`tools/prebuild/*`** — stays put. These are **realm-agnostic in-VM build recipes** (`build-linux-glibc.sh`, `build-linux-musl.sh`, `build-static-deps.sh`, `get-cflags/ldflags`). Core provides the *transport* (`runInVm`) and *locking*; `tools/prebuild` provides the *recipe*. That separation is already latent and worth preserving — and it is **required** by ADR-016's "one implementation, two callers" rule: these recipes are invoked both by the local Lima builder *and directly by `.github/workflows/prebuild.yml`* in CI (no Lima there). The Core wraps only the *local* transport; it must never become a prerequisite for the CI path, or the recipes stop being callable without a VM.

---

## 4. VM lifecycle coordination (fixing the race properly)

### 4.1 Two layers of defense

1. **Turbo-level ordering (removes the common-path concurrency).** Introduce a single ensure node per shared VM, e.g. `@podkit/lima#ensure-linux-builder` (and `#ensure-musl-builder`). Make **every** task that boots that VM depend on it:
   - `@podkit/device-testing#build:linux-prebuild` → `dependsOn: [..., @podkit/lima#ensure-linux-builder]`
   - `@podkit/gpod-testing#build:linux-binary` → `dependsOn: [..., @podkit/lima#ensure-linux-builder]`
   - `@podkit/device-testing#build:linux-binary` already chains via `build:linux-prebuild`; it now transitively shares the ensure node.
   The ensure node is `cache: false` (VM running-ness is runtime state, mirroring `vm:doctor`) and is the **only** place a builder VM is created/started. Downstream build scripts then assume-running and never call `limactl start` themselves.

2. **Cross-process advisory lock (defends against what turbo can't see).** Turbo ordering only helps within one `turbo run`. A developer running `bun run harness:install` while a `bunx turbo …` is mid-flight, or two shells, still races. So `ensureRunning` in Core takes a **per-instance lock** before its status→start critical section:
   - Lock file at a stable per-instance path (e.g. `~/.cache/podkit/vm-locks/<instanceName>.lock`).
   - **Liveness-aware** (pid + mtime staleness reclaim) so a killed holder can't wedge the lock — a `proper-lockfile`-style implementation, since macOS has no `flock(1)` and we want one code path.
   - Acquire → re-probe status → start only if not already running → release. Because the whole check-then-start is inside the lock, the double-`limactl start` window closes.

**Single lock implementation via one CLI.** Both TS consumers and shell/turbo callers go through `bunx podkit-vm ensure <id>`, so there is exactly one lock code path (the CLI's), not a TS lock plus a shell lock that can disagree.

**The same lock serves the device-harness contention** (§1.3): a per-instance lock keyed on `podkit-device-harness` gives the `test:vm`-vs-`docker-dist` and `quality`-vs-`quality:rc` collisions a real primitive instead of relying on manual phase-sequencing in `run-mirror-body.ts`. (An in-repo precedent exists — TASK-404's advisory lock for concurrent device sync — so this pattern is not foreign to the codebase.)

### 4.2 Ownership contract: start-only, explicit stop

Keep today's implicit contract explicit: **`ensureRunning` never stops a shared VM.** Builder/test/demo VMs are left running between invocations; only explicit operations (`harness:builder:stop`, `mise test:linux:stop`, `vipod:stop`) or the developer stop them. This means **no reference counting is needed** for the common path — the hard part of shared-resource management (who stops it) is sidestepped by never auto-stopping. (If a future CI needs auto-teardown, that's when a refcount/lease belongs in Core — flagged, not built now.)

### 4.3 Idempotent, named semantics

- `ensureExists` — create if `missing`; no-op otherwise.
- `ensureRunning` — `ensureExists` + start if `stopped`; recover if `broken`; no-op if `running`. Locked.
- `ensureInstalled` — (device-harness) transfer binaries/unit iff sha256 differs (today's `harness.ts install` logic, already idempotent).
- These map cleanly onto the existing `vm:install` (freshness) / `vm:doctor` (drift) turbo tasks, which stay as-is but call Core.

### 4.4 Sleep-corruption recovery as a first-class op

Today the recovery from a `Broken`/sleep-corrupted VM is either an ad-hoc `limactl delete --force && start` inside each script's `*)` case, or the manual `bun run harness:destroy && bun run harness:setup` that `vm-doctor.ts` prints. Promote this to **`recover(vm)`** in Core: destroy → create → start → run the provisioning hook → **reseal baseline**. `vm:doctor`'s remediation text and `harness.ts` both call the same primitive, so the reseal can't be forgotten (today it lives only in `harness.ts`'s `cmdSetup`).

---

## 5. Config consolidation

### 5.1 Single source of truth

Move **all** VM YAMLs into `@podkit/lima`'s `vms/` directory and describe them in one typed registry (§3.2). Result:

- `tools/lima/{podkit-tests-debian-glibc,podkit-tests-alpine-musl,podkit-virtual-ipod}.yaml` → `vms/`
- `test-packages/device-testing/lima/{podkit-device-harness,podkit-linux-builder,podkit-musl-builder}.yaml` → `vms/`
- `podkit-abi-verify.yaml` → **delete** (orphaned spike) unless the maintainer wants it formalized (Q6).

Instance names stop being three idioms and become registry fields. `LIMA_DEVICE_HARNESS_VM_NAME`, `${BUILDER_VM_NAME:-…}`, and mise literals all resolve to `getVm(id).instanceName`.

### 5.2 Templated bits

- **Arch** is handled at *runtime* today (in-VM `uname -m` → `x64`/`arm64`), not templated into YAML — keep that; the registry just records the arch-suffix convention once so the seven copies collapse to one helper.
- **Instance name** is the only real template and now lives in the registry.
- The YAMLs are otherwise static; no templating engine is warranted. (If Debian/Alpine test VMs ever need per-host tweaks, a small overlay mechanism can be added — not now.)

### 5.3 Non-test configs (virtual-iPod)

The demo VM is a *product* concern, not test infra, but it's still a Lima VM whose config wants a home. Recommendation: put its YAML in the registry under `category: 'demo'` so discovery/naming is uniform, but **leave its `vipod:*` lifecycle in mise initially** (it can later call `bunx podkit-vm ensure virtual-ipod`). This gets single-source-of-truth for config without entangling the demo's bespoke lifecycle (USB plug/unplug/wipe REST calls) into the Core.

### 5.4 Turbo input paths

Several turbo tasks list `$TURBO_ROOT$/test-packages/device-testing/lima/**` and `.../scripts/apply-state.sh` as `inputs`. Moving the YAMLs updates these globs (a mechanical, one-time change) and will invalidate those caches once. The **baseline-hash** tracked files (`lima/podkit-device-harness.yaml`, `scripts/apply-state.sh`) change path → a one-time VM re-provision on first `harness:setup` after the move. Both are expected, bounded costs (see §6 risk).

---

## 6. Migration & risk (light — detailed plan is a later step)

**Sequencing (each phase independently shippable):**

- **Phase 0 — Fix the race now (no new package).** Add `@podkit/lima#ensure-linux-builder` / `#ensure-musl-builder` turbo nodes (initially a tiny script living in `device-testing/scripts`), point the racing tasks at them, and remove the `limactl start` blocks from the downstream build scripts. Optionally add the advisory lock. **This alone stops the `harness:setup` crash** and is worth landing before anything else.
- **Phase 1 — Extract the Core.** Move `lima-limactl.ts`, `instanceStatus`, transfer helpers, `baseline-hash.ts`, and the ensure/run/recover primitives into `@podkit/lima`. `@podkit/device-testing` re-exports them so import sites don't move. Add the lock + single CLI.
- **Phase 2 — Consolidate configs.** YAMLs → `vms/`; update turbo `inputs`, mise literals, `run-tests.sh`, and the build scripts to read `getVm(id)`. Accept the one-time cache/re-provision hit.
- **Phase 3 — Thin the consumers.** `build-*.sh` and `run-tests.sh` become thin callers of `ensure`/`runInVm`/`stageSourceTree` (dedupe the rsync-exclude drift too).
- **Phase 4 — Tidy edges.** virtual-iPod config into registry; delete/formalize `abi-verify`; update `agents/device-testing.md`, `tools/lima/README.md`, `test-packages/device-testing/lima/README.md`, and `documents/architecture/testing/vm-build-orchestration.md` (§6/§7 explicitly foretell this helper).

Because this introduces a new package and a lifecycle-ownership convention, it warrants a **new ADR** that records the decision and explicitly reconciles with ADR-016 (physical builder/test separation is *preserved*; only orchestration + config ownership is centralized) — filed at Phase 1, marked Accepted when Phase 1 lands.

**What moves vs stays:**
- *Moves to Core:* generic Lima lifecycle + limactl wrapper + locking + baseline-hash + all YAMLs + arch/rsync helpers.
- *Stays in `@podkit/device-testing`:* personas, system-states, `apply-state.sh`, `vm/` fixtures, sidecar, rc-build, the device-harness-specific install steps.
- *Stays put:* `tools/prebuild/*` (in-VM recipes), `@podkit/device-testing-daemon`, docker host-only smoke.

**Backward-compat to preserve deliberately:**
- `bun run harness:*` script names (developer muscle memory + docs).
- `mise run test:linux[:debian|:alpine|:stop|…]` and `vipod:*` task names.
- **Every turbo task ID** (`@podkit/device-testing#build:linux-binary`, `#vm:install`, `#vm:doctor`, `@podkit/gpod-testing#build:linux-binary`, `@podkit/e2e-vm-tests#test:e2e:docker-dist`, …). These are wired into the `qa`/quality DAG and referenced across docs; renaming is a large, avoidable blast radius. **Move implementation, keep names.**

**Biggest risks:**
1. **Turbo cache invalidation & VM re-provision** from moving YAML/`apply-state.sh` paths — bounded, one-time, but will surprise anyone mid-work; sequence Phase 2 at a quiet point and call it out in the changeset.
2. **The single-CLI lock must actually be honored by every start path.** If one straggler script keeps its own `limactl start`, the race survives. Migration must be exhaustive (grep-verified: the 7 sites in §1.2).
3. **Import-surface regressions** — `@podkit/e2e-vm-tests` and the harness self-tests import a large symbol set from `@podkit/device-testing`; the re-export shim must be complete or the typecheck/test DAG breaks.
4. **Naming/placement churn** if Q1/Q2 aren't settled before Phase 1 (renaming a package mid-migration is costly).

---

## 7. Open questions for the maintainer

1. **Package name.** `@podkit/lima` (substrate-honest) vs `@podkit/vm-harness` vs `@podkit/vm-orchestration`? "Harness" already means the device-harness VM — reusing it may confuse.
2. **Placement / status.** It's *both* test infra and **build infra for distributed prebuilds**. Keep it under `test-packages/` (proximity to biggest consumer) or introduce a `tooling/` workspace so it isn't mislabeled as test-only? (Private either way — confirm nothing here should ever publish.)
3. **How far to consolidate.** Confirm the recommended cut: device-test *runtime* (personas/system-states/`vm/`/`apply-state.sh`) **stays** in `@podkit/device-testing` and only the Lima substrate extracts. Or do you want the Core to own more?
4. **Does per-libc build tooling belong in the Core?** Recommendation keeps `tools/prebuild/*` recipes out and only shares transport+lock. Alternatively the whole per-libc build (which produces `libgpod-node` prebuilds) could be re-homed under `libgpod-node` or the Core. Where should "build the distributed prebuild" ownership sit?
5. **Virtual-iPod scope.** Fold only its *config* into the shared registry (recommended) and leave `vipod:*` lifecycle in mise, or bring the demo VM fully under Core lifecycle too?
6. **`podkit-abi-verify`.** Delete the orphaned spike VM, or formalize it as a real `abi-verify` consumer of the Core (an ldd/ABI gate in CI)?
7. **Locking approach & teardown contract.** Endorse the two-layer design (turbo ordering node + advisory lock via one CLI) and the **start-only / never-auto-stop / no-refcount** contract for shared VMs? Or do you foresee a CI need for leased/auto-torn-down builders that would justify reference counting now?

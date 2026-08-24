# Handoff — VM-harness consolidation (TASK-480 / doc-059)

_Epic complete. All phases landed on branch `vm-harness-phase-b`, not yet merged to `main`._

## Status

| Phase | Task | What | Status |
|-------|------|------|--------|
| P0 | 480.01 | Builder-VM start race → shared cross-process lock | ✅ Done — `e67f69ef` (on `main`) |
| P1 | 480.02 | Extract `@podkit/lima` substrate + re-export shim | ✅ Done — `16a02b0f` (on `main`) |
| P2 | 480.03 | Configs → registry + instance renames + `computeBaselineHash` (MF3) | ✅ Done — `f863005c` |
| P3 | 480.04 | Build wrappers + `run-tests.sh` onto the CLI; atomic lock cutover (MF4) | ✅ Done — `695875fe` |
| P4 | 480.05 | Registry entries verified; docs + ADR-027 | ✅ Done — `e1e0b852` |
| — | 481 | Unpin `bun-types`/`@types/bun` | ✅ Done — `248743fe` |

Branch commits, oldest first: `7d01bc7f` (e2e assertion fix) · `248743fe` (bun-types) · `f863005c` (P2) · `32b18c0c` (CLI tests) · `66ed3179` (backlog) · `695875fe` (P3) · `de76d15b` (backlog) · `e1e0b852` (P4).

## Where things live now

`@podkit/lima` (`test-packages/lima/`, private) owns the Lima substrate. **Read `test-packages/lima/README.md` first** — it is the substrate's own doc. **ADR-027** records the decision and its reconciliation with ADR-016.

- All 7 VM YAMLs: `test-packages/lima/vms/`
- Registry: `src/registry.ts` — the only place an instance name is spelled
- CLI: `src/cli.ts`, verbs `ensure|status|stop|destroy|recover|shell|install|doctor|stage`
- Lock: `src/lock.ts` — one advisory lock, every start funnels through it

Instances: `podkit-device`, `podkit-builder-glibc`, `podkit-builder-musl`, `podkit-test-glibc`, `podkit-test-musl`, `podkit-virtual-ipod`, `podkit-abi-verify`.

Developer commands: `bun run vm:up|down|destroy|status|recover|shell <id>`. `harness:setup`/`install`/`status` remain — they do device-specific work (binary staging, systemd unit, baseline seal) the substrate deliberately does not.

## Traps for the next person

- **Invoke the CLI as `bun "$REPO_ROOT/test-packages/lima/src/cli.ts" <verb>`.** `bunx podkit-vm` does NOT work: there is no `node_modules/@podkit` and no linked workspace bin, so bunx falls through to npm and 404s. The old implementation plan says `bunx podkit-vm` in ~7 places; it is wrong.
- **Keep path resolution lazy.** Anything in `@podkit/lima` that resolves a repo path at module load crashes the compiled FunctionFS daemon — its bunfs paths (`/$bunfs/root/…`) carry no source-tree marker. Unit tests, typecheck and review all pass when this is broken; only a full VM run catches it. `registry.ts`'s `yamlPath` getter is pinned by a test for this reason.
- **The guests' `/bin/sh` is dash** (busybox ash on Alpine). No `pipefail`. This silently broke `stageSourceTree` for its entire pre-adoption life.
- **The lock guards VM starts, not source staging.** Two builder tasks still `rsync --delete` into the same VM directory concurrently — TASK-484.
- **`podkit-device-harness` still appears legitimately** as in-VM guest paths (`/var/lib/…`, two `/etc/` conf files, a udev rule filename) and inside env-var *names*. Only the Lima instance was renamed. Grep before you sed.

## Open follow-ups

- **TASK-482** (high) — `@podkit/device-testing#test:unit` executes **zero tests**; a `preflight` `process.exit(0)` during bunfig preload kills the run. The runner and persona suites have not been running. Verify that package from the repo root until fixed.
- **TASK-483** (high) — `@podkit/e2e-vm-tests#test:vm` flakes under full `quality` parallelism (leaked persona daemon blocks the next gadget bind). Green standalone at 232/0. **This is why `bun run quality` is still red.**
- **TASK-484** (medium) — the shared staging-dir race above.
- `adr/index.md` is missing rows for ADR-016, 017, 018, 025, 026 (pre-existing). The docs site has no ADR sync wiring, so `/developers/adr/…` links resolve to nothing published.

## Verify

```bash
bun run harness:setup    # works on a cold host in one invocation now
bun run test:vm          # → 232 pass / 0 fail
bunx turbo run @podkit/e2e-vm-tests#test:e2e:docker-dist @podkit/e2e-tests#test:e2e:docker-loopback  # → 9/0
mise run test:linux:debian   # → 63/63 tasks on podkit-test-glibc
```

`bun run quality` is red only on TASK-483. The `/Video/i` host-e2e failure that blocked it since Aug 18 is fixed on this branch.

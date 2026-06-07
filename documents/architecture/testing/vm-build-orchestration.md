---
title: VM Build Orchestration
description: How `bun run test:vm` guarantees a fresh podkit binary lands in the device-harness VM and detects baseline drift between the running VM and its yaml/apply-state.sh sources.
sidebar:
  order: 1
---

Describes the orchestration around `bun run test:vm` so that VM tests are
**always** observed against a current production build of podkit, with
explicit drift detection between the running VM and the source-of-truth
provisioning scripts.

Companion reading:
[adr/adr-016 — Linux VM test harness](../../../adr/adr-016-linux-vm-test-harness.md).

---

## 1. Map

Two coupled concerns sit between `bun run test:vm` and a meaningful test
result:

1. **Binary freshness.** The VM under `podkit-device-harness` runs the
   Linux binary at `/usr/local/bin/podkit`. That binary was built from a
   host source tree at some past time. If `packages/podkit-core/src/**` or
   `packages/podkit-cli/src/**` (etc.) have changed since the binary was
   compiled, every VM test runs against stale code — false RED or false
   GREEN cells with no signal in the failure message.

2. **VM baseline drift.** The running VM was provisioned from
   `test-packages/device-testing/lima/podkit-device-harness.yaml` at some
   past `harness:setup`. If the yaml has changed (new apt package, new
   kernel module, new fstab line) the VM is missing pieces; tests fail
   with apparent symptoms that are really provisioning gaps. Similarly,
   `test-packages/device-testing/scripts/apply-state.sh` is the runtime
   realisation of SystemStates; if a state definition was added to the
   TypeScript registry but apply-state.sh hasn't been re-shipped to the
   VM, the runner cannot reach the new state.

The orchestration here owns the contract `test:vm` makes about both
concerns. It does not own how the binary is built (the existing turbo
tasks `@podkit/device-testing#build:linux-binary`,
`@podkit/device-testing-daemon#build`, and
`@podkit/gpod-testing#build:linux-binary` do); it owns when those tasks
must run before `test:vm` proceeds, and how baseline drift is detected.

---

## 2. Primitives

### `@podkit/device-testing#vm:install` (turbo task — new)

Wraps the existing harness install flow as a turbo-cached task. Its
`inputs` are the same files that should invalidate the in-VM binaries:

- The compiled binaries themselves (declared as the outputs of the
  build-linux tasks listed under `dependsOn`).
- `scripts/harness.ts` — changes to install logic must invalidate.
- `src/runners/lima-test-vm-binary.ts`,
  `src/runners/lima-test-vm-systemd.ts` — the transfer helpers.

Its `outputs` is a single marker file `.turbo/vm-install-marker` that
captures the sha256 of every artefact transferred plus the Lima instance
name; turbo treats this as the "cached effect" of the task. The body
invokes the existing install code via `bun run scripts/harness.ts install`.

`dependsOn`:

- `@podkit/device-testing#build:linux-binary`
- `@podkit/device-testing-daemon#build`
- `@podkit/gpod-testing#build:linux-binary`

When turbo replays a cache hit, `vm:install` is skipped — but
`harness.ts install` is itself idempotent via per-binary sha256 probes,
so a manual re-run is always safe.

### `@podkit/device-testing#vm:doctor` (turbo task — new)

A short preflight script (`scripts/vm-doctor.ts`) that hashes
`podkit-device-harness.yaml` + `apply-state.sh` and compares to a hash
file inside the VM at `/var/lib/podkit-device-harness/baseline-hash`.
Inputs are the yaml + script + the doctor script itself; no outputs (the
task asserts a condition, it doesn't produce artefacts).

`cache: false` — drift is a runtime property of the VM and the
on-disk-hash, not of the inputs. A cache hit for "yaml unchanged" would
ignore the case where someone destroyed the VM after `harness:setup` and
recreated it manually.

`dependsOn: []` — this is a pure check; nothing builds it. It runs as a
sibling of `vm:install`.

### `test:vm` wiring

The two VM-test packages (`@podkit/device-testing` and
`@podkit/e2e-vm-tests`) gain a `dependsOn` on both `vm:install` and
`vm:doctor`. The harness preflight already gates VM reachability; turbo
now gates binary freshness and baseline drift before bun even loads the
test file.

---

## 3. Responsibility boundaries

| Concern | Owner |
|---------|-------|
| Compiling Linux binaries from current source | `@podkit/device-testing#build:linux-binary` (and siblings) — unchanged. |
| Knowing **when** to re-compile | Turbo (existing inputs/outputs declarations on the build tasks). |
| Transferring binaries into the VM | `scripts/harness.ts install` — unchanged. |
| Knowing **when** to re-transfer | `vm:install` turbo task (new). |
| Detecting VM baseline drift | `scripts/vm-doctor.ts` + `vm:doctor` turbo task (new). |
| Writing the baseline hash | `harness.ts setup` (modified to seal the hash post-install). |
| Surfacing remediation to the developer | `vm-doctor.ts` error text — explicit `harness:destroy && harness:setup` instructions. |

The harness scripts remain the single point of binary transfer; the
turbo layer above orchestrates **when** that point is reached and
guarantees a **drift check** runs first.

---

## 4. Conventions for new contributors

- Any new file whose change should invalidate the VM binary belongs in
  the `inputs` glob of `@podkit/device-testing#build:linux-binary`. The
  glob already covers `packages/*/src/**`; new packages must be added to
  it (or to a transitive `^build` dependency). The same rule applies if
  a new install step lands in `harness.ts` — list it in `vm:install`
  inputs.

- Any new line in `podkit-device-harness.yaml` (apt package, module,
  fstab entry) or `apply-state.sh` (new state, new helper) automatically
  contributes to the baseline hash; no further wiring needed.

- Do NOT auto-rebuild the VM on drift. The cost is minutes; the
  remediation message points the developer at the explicit
  `harness:destroy && harness:setup` flow. Save destructive operations
  behind explicit flags.

- `vm:install` and `vm:doctor` must remain idempotent — re-running
  `bun run test:vm` with no source changes must hit cache and not touch
  the VM.

---

## 5. Error semantics

| Condition                                                | What happens |
|----------------------------------------------------------|--------------|
| Source under `packages/*/src/**` changed                 | Turbo invalidates `build:linux-binary` → `vm:install` re-runs → fresh binary lands in VM. |
| `harness.ts` or transfer helpers changed                 | Turbo invalidates `vm:install` → re-runs (binaries unchanged → sha256 probe skips the actual copies; marker file is rewritten). |
| Marker file deleted but inputs unchanged                 | Turbo cache hit; the install is not re-run (this is fine — the in-VM binary still matches the build output). |
| VM destroyed + recreated manually without `setup`        | `vm:doctor` reads the VM's hash file (absent), reports drift, exits 1 with remediation. |
| `podkit-device-harness.yaml` changed since last setup    | `vm:doctor` reports drift with the file name and exits 1. |
| `apply-state.sh` changed since last setup                | Same as yaml. |
| Both VM running + hashes match + binaries current        | `vm:doctor` exits 0, `vm:install` cache hit, tests proceed. |

`vm:doctor` failure messages name the files that drifted and the exact
remediation command (`bun run harness:destroy && bun run harness:setup`).
No silent recovery, no auto-rebuild.

---

## 6. Scope boundaries

This orchestration does **not** cover:

- **Builder-VM lifecycle.** The `podkit-linux-builder` VM auto-creates
  on first use of `build:linux-binary` and is otherwise developer-managed
  via `harness:builder:stop`/`harness:builder:destroy`. No turbo
  involvement.
- **Test discovery.** Whether a given `.e2e.test.ts` file runs is
  governed by `bun test`'s path glob; the orchestration only ensures the
  binary it observes is current.
- **Runtime state of SystemStates.** `apply-state.sh` itself is
  invoked per-test by the runner; the drift check confirms the script
  shipped into the VM matches host, not that the right state is currently
  applied.
- **Cross-arch caching.** `PODKIT_HOST_ARCH` is already hashed into the
  build cache key by `build:linux-binary`; nothing else is needed here.

---

## 7. Open work

- **Marker file format.** Today the marker is a single sha256-of-sha256s
  line. If a future test needs to know which artefact was last shipped
  (e.g. for a manual ldd probe), the marker can be extended to JSON.
- **Multiple VMs.** Only `podkit-device-harness` is in scope. The Linux
  test VMs (`podkit-tests-debian-glibc`, `podkit-tests-alpine-musl`,
  `podkit-virtual-ipod`) have their own lifecycles; if any acquires a
  test:vm-style suite, the same pattern should be lifted into a shared
  helper.

---

## 8. References

- `turbo.json` — task definitions.
- `test-packages/device-testing/scripts/harness.ts` — install
  implementation.
- `test-packages/device-testing/scripts/vm-doctor.ts` — drift preflight.
- `test-packages/device-testing/lima/podkit-device-harness.yaml` —
  baseline yaml.
- `test-packages/device-testing/scripts/apply-state.sh` — state runtime.
- `adr/adr-016-linux-vm-test-harness.md` — overall VM-test split.

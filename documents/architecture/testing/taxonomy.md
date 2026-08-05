---
title: Test Taxonomy
description: The canonical vocabulary for podkit's tests — Depth (Unit/Integration/E2E) crossed with E2E Surface (Runtime × Source × Device). Replaces the ad-hoc "Tier N" numbering that collided across subsystems.
sidebar:
  order: 0
---

The one place that names podkit's test categories. Every test has exactly
one **Depth**; every end-to-end test additionally has one **Surface**.
There is deliberately **no "Tier N" numbering** — see
[§7](#7-what-is-not-a-test-tier) for why the numbers were removed and what
the old labels map to.

Use this doc to answer three questions: *what kind of test is this?*,
*what infrastructure do I need to run it?*, and *where are we not
testing?* (the [coverage grid](#4-coverage-grid) — empty cells are gaps).

---

## 1. The two axes

A test is classified on two orthogonal axes:

- **Depth** — how much of the system a test exercises: `Unit` →
  `Integration` → `E2E`. Applies to *every* test, repo-wide.
- **Surface** — for E2E tests only: *where the binary/image runs* and
  *what it is driven against*. Named, never numbered.

The axes are independent. "A daemon unit test" and "a full image-in-VM
sync" are not points on one ladder — they differ in **Depth**. Two E2E
tests that both sync a real device differ only in **Surface**. Conflating
these two axes into a single "Tier 1..5" number line is exactly what
produced the collisions this taxonomy retired.

---

## 2. Depth

| Depth | What it exercises | Suffix / marker |
|---|---|---|
| **Unit** | Pure logic, all deps mocked. In-process, no subprocess, no device. | `*.test.ts` (bare) |
| **Integration** | Several real modules/deps in one process (ffmpeg, libgpod-node, real `entrypoint.sh` against stubs). No full binary, no device. | `*.integration.test.ts`, `*.bats` |
| **E2E** | The built `podkit` **binary or Docker image** driven as a black box. | `*.e2e.test.ts` (+ Surface, see §3) |

`*.perf.test.ts` (performance benchmarks) and the OS tags
`*.darwin.test.ts` / `*.linux.test.ts` are *modifiers*, not depths — a
perf test is still a Unit or Integration test that happens to measure
timing. See [agents/testing.md](../../../agents/testing.md) for the
per-OS tagging convention.

---

## 3. Surface (E2E only)

An E2E test's Surface is a triple: **Runtime × Source × Device**.

- **Runtime** — where podkit executes:
  | Value | Meaning |
  |---|---|
  | `host-binary` | the compiled binary on the dev/CI host |
  | `host-docker-image` | the shipped Docker **image** run as a container on the host |
  | `vm-binary` | the binary inside the `podkit-device-harness` Lima VM |
  | `vm-docker-image` | the shipped Docker image run as a container **inside** the VM |
- **Source** — where the music comes from:
  | Value | Meaning |
  |---|---|
  | `local-dir` | a local fixture directory |
  | `docker-sidecar` | a Navidrome/Subsonic source **server** in a companion container |
- **Device** — what podkit syncs *to*:
  | Value | Meaning |
  |---|---|
  | `none` | no device (smoke: does the artifact boot?) |
  | `dir` | a temp-directory "device" (dummy iPod tree) |
  | `loopback-fat` | a FAT image mounted via `losetup` as a block device |
  | `usb-synth` | a synthesized USB iPod (dummy_hcd + FunctionFS) |

The Runtime tells you the **infrastructure cost** (nothing → Docker →
VM → Docker-in-VM). The Device tells you which of podkit's device code
paths is under test. The Source is independent of both — a
`docker-sidecar` is an integration *dependency*, not podkit's runtime.

---

## 4. Coverage grid

Each populated cell is a real place tests live. **Empty combinations
that plausibly should exist are coverage gaps** — the right-hand notes
call the interesting ones out.

> **The `Where` column reflects the surface-by-directory layout**
> ([ADR-025](../../../adr/adr-025-canonical-test-taxonomy.md)). The
> the `docker-source/`, `vm-docker/`, and `docker-loopback/` directories all
> now exist.

| Runtime | Source | Device | Where | Depth |
|---|---|---|---|---|
| `host-binary` | `local-dir` | `dir` | `e2e-tests/` feature dirs (`commands/`, `features/`, `workflows/`, …) | E2E |
| `host-binary` | `docker-sidecar` | `dir` | `e2e-tests/src/docker-source/` | E2E |
| `host-docker-image` | `local-dir` | `none` | `packages/podkit-docker/test/image-smoke.sh` | E2E |
| `host-docker-image` | `local-dir` | `loopback-fat` | `e2e-tests/src/docker-loopback/` — **CLI** device ops (trust-disk verification, hard-error-on-generic — task-450) | E2E |
| `vm-binary` | `local-dir` | `usb-synth` | `e2e-vm-tests/` (root) + `device-testing/src/vm/` (harness self-tests) | E2E |
| `vm-docker-image` | `local-dir` | `usb-synth` | `e2e-vm-tests/src/vm-docker/` | E2E |

Also classified here (not device E2E surfaces):

| Category | Where | Depth |
|---|---|---|
| Daemon decision logic | `packages/podkit-daemon/src/*.test.ts` | Unit |
| Entrypoint routing | `packages/podkit-docker/test/entrypoint.bats` | Integration |

**Notable gaps the grid exposes:**

- `vm-*` × `docker-sidecar` × `usb-synth` — no test sources a
  dockerized Navidrome into a VM device. The full
  source-server-to-real-device path is only ever proven with a
  `local-dir` source.
- **Daemon _device_ e2e is USB-gated → `usb-synth` (VM) only.** The daemon's
  poller excludes `loop`-type devices and requires an Apple USB vendor id
  read from `/sys` (`packages/podkit-daemon/src/device-poller.ts`), by design —
  it must only ever sync provably-real iPods, never a stray FAT device. So a
  `loopback-fat` device **cannot** drive daemon detect→mount→sync→eject; that
  path (plus SIGTERM drain + Apprise notify) lives only in the
  `vm-docker-image` · `usb-synth` cell (see task-474). The `loopback-fat` cell
  is a **CLI** device surface (task-450), not a daemon one — the CLI is
  transport-agnostic and operates on a mounted iPod filesystem via on-disk
  identity, so it needs no USB.

Record a new gap here whenever you notice one; delete the note when a
cell fills.

---

## 5. Directory & file convention

**Depth is encoded by suffix. Surface is encoded by directory.**

The rule that makes surface-by-directory coexist with feature-based
package layout:

> **The default surface for a package lives at the package root (in its
> existing feature directories). Every *non-default* surface gets its own
> subdirectory.**

This mirrors the precedent already set by `e2e-vm-tests`, where the
default `vm-binary` tests sit at the root and only the image variant was
foldered off.

| Package | Default surface (root) | Non-default surfaces (subdirs) |
|---|---|---|
| `test-packages/e2e-tests` | `host-binary` · `local-dir` · `dir` | `docker-source/`, `docker-loopback/` *(the latter still planned — task-450)* |
| `test-packages/e2e-vm-tests` | `vm-binary` · `local-dir` · `usb-synth` | `vm-docker/` |

> **Not a surface directory:** `test-packages/e2e-tests/src/docker/`
> holds container-lifecycle **helpers** (`container-manager.ts`,
> `navidrome.ts`, …), not tests. It is unrelated to the `docker-source/`
> surface directory — the similar names are a hazard; do not merge them.

Gating follows directories: a Surface's turbo/package task selects (or
excludes) its subdirectory. A test's Surface is therefore always legible
from its path — no need to open the file.

The mechanics differ by runner but the semantics are identical:

- **VM (`e2e-vm-tests`)** — bun natively globs paths, so `test:vm`
  excludes `**/vm-docker/**` and `test:e2e:docker-dist` selects
  `src/vm-docker/`.
- **Host (`e2e-tests`)** — the custom `gpod-tests-parallel` runner walks
  the tree and matches `--pattern` / `--exclude` against the **basename
  only**, so it grew a directory-aware `--exclude-path <substr>` flag
  (and honours a positional path substring for inclusion). `test:e2e`
  excludes `docker-source/` and `docker-loopback/`; `test:e2e:docker`
  selects `docker-source/`. The `bun test`-based variants
  (`test:e2e:serial`, `test:e2e:real`) gate the same directories via
  bun's own `--path-ignore-patterns`.

Because host gating is now purely directory-based, the moved
`docker-source/` files are bare `*.test.ts` (the redundant `.docker`
token was dropped). The `docker-loopback/` exclusion is wired into the
default host gate ahead of task-450, so that task only has to drop files
into the directory.

> **Known inconsistency (pre-existing):** `e2e-tests` marks E2E by
> *package membership* (its files are bare `*.test.ts`, gated by the
> package's `test:e2e` glob), whereas `e2e-vm-tests` marks E2E by the
> `*.e2e.test.ts` *suffix*. Normalising every host E2E file to the
> `.e2e.` suffix is a separate, optional cleanup — tracked, not done
> here — because it is a wide mechanical rename with no behavioural
> payoff beyond consistency.

---

## 6. Enumerating cases per cell

There is no single runner across all cells (bun, bats, shell), so
enumeration is per-mechanism. Ad-hoc commands:

```bash
# Unit / Integration / E2E bun cases in a directory (it()/test() count)
grep -rhcE "^\s*(it|test)\(" <dir>/**/*.test.ts | awk '{s+=$1} END{print s}'

# Entrypoint bats cases
grep -cE "^\s*@test" packages/podkit-docker/test/entrypoint.bats

# Image-smoke assertions
grep -cE "docker run" packages/podkit-docker/test/image-smoke.sh

# Host E2E, default surface (excludes the non-default surface dirs)
find test-packages/e2e-tests/src -name '*.test.ts' \
  -not -path '*/docker-source/*' -not -path '*/docker-loopback/*'

# Host E2E, docker-sidecar source
find test-packages/e2e-tests/src/docker-source -name '*.test.ts'

# VM E2E, vm-docker-image
find test-packages/e2e-vm-tests/src/vm-docker -name '*.test.ts'
```

The host runner can also print its own selection without executing:
`gpod-tests-parallel <the task's flags> --list`. Keep these as commands,
not a committed script: the counts drift, and a stale hardcoded number
reads as truth. Run the command when you need the number.

---

## 7. What is NOT a test tier

The word "tier" is used elsewhere in podkit for concepts that have
**nothing to do with test depth or surface**. They are legitimate domain
vocabulary; they are listed here only so nobody wires them into a test's
classification:

| Concept | Labels | Home |
|---|---|---|
| Device access | `syncable` / `read-only` / `none` | [ADR-024](../../../adr/adr-024-device-access-tiers.md) |
| `device add` verification | `verify` / `trust-disk` / `config-inject` | [doc-045](../../../backlog/docs/) |
| Quality presets | `fast` / `optimized` / `portable` | [ADR-010](../../../adr/adr-010-quality-preset-redesign.md) |
| Docker privilege ladder | `--device` → `-v /dev` → cgroup-rule → `--privileged` | task-165 (historical). **These are passthrough modes, not test tiers** — the completed task numbers them "Tier 1–4"; that numbering is dead and must not be revived. |

If you find a document numbering *tests* "Tier N", it predates this
taxonomy — map it via §8 and fix the reference.

---

## 8. How the old labels map

The retired [doc-053](../../../backlog/docs/) "five tiers" and the old
"Tier-3" alias for VM tests translate as follows:

| Retired label | Canonical classification |
|---|---|
| doc-053 **Tier 1** (daemon unit) | **Unit** |
| doc-053 **Tier 2** (entrypoint bats) | **Integration** |
| doc-053 **Tier 3** (image smoke) | **E2E** · `host-docker-image` · `local-dir` · `none` |
| doc-053 **Tier 4** (loopback) | **E2E** · `host-docker-image` · `local-dir` · `loopback-fat` |
| doc-053 **Tier 5** (image + USB in VM) | **E2E** · `vm-docker-image` · `local-dir` · `usb-synth` |
| ADR-016 / vm-testing **"Tier-3"** | **E2E** · `vm-binary` · `local-dir` · `usb-synth` |

Note that doc-053's Tier 1 and Tier 5 land in *different depths* (Unit
vs E2E) — the clearest illustration of why a single 1–5 number line was
the wrong model.

doc-053 remains the *strategy/rollout* document for the Docker vertical;
it no longer owns a numbering. ADRs are frozen at decision time and are
not rewritten — [ADR-016](../../../adr/adr-016-linux-vm-test-harness.md)
keeps its "three-tier" language, with a forward pointer to this doc.

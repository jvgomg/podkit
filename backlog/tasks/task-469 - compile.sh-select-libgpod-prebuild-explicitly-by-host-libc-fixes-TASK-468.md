---
id: TASK-469
title: 'compile.sh: select libgpod prebuild explicitly by host libc (fixes TASK-468)'
status: In Progress
assignee: []
created_date: '2026-08-04 15:16'
updated_date: '2026-08-04 15:35'
labels:
  - build
  - libgpod-node
  - bug
milestone: m-23
dependencies: []
references:
  - adr/adr-026-dual-libc-linux-distribution.md
  - doc-057
  - packages/podkit-cli/scripts/compile.sh
  - test-packages/device-testing/scripts/build-linux-binary.sh
priority: high
ordinal: 229000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`packages/podkit-cli/scripts/compile.sh:34-40` selects the libgpod `.node` prebuild by iterating `["${PLATFORM}-${ARCH}-musl", "${PLATFORM}-${ARCH}"]` and taking the **first dir that exists** — musl-first. On the glibc builder, a stray host-side `prebuilds/linux-${ARCH}-musl` (present from any prior musl build; `build-linux-binary.sh:86-98` rsyncs the source tree into the VM without excluding `prebuilds/`) shadows the glibc dir and gets embedded into the glibc binary → `libc.musl-aarch64.so.1: cannot open` on the Debian harness VM. This is TASK-468.

Fix: make the gpod-prebuild selection **explicit by the host libc** — detect musl vs glibc via `ldd /bin/sh | grep -q musl` (the exact logic already used for the `usb` prebuild at `compile.sh:75`) and pick the matching prebuild dir only.

Do NOT "exclude `prebuilds/` from the rsync" — the glibc `.node` is *delivered* into the VM by that rsync (`build-linux-binary.sh:154-158`); excluding it leaves no prebuild and `compile.sh:49-55` hard-fails. (Excluding only the wrong-libc prebuild dir is acceptable as belt-and-suspenders.)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 compile.sh selects the libgpod prebuild by detected host libc (musl vs glibc), not first-dir-wins
- [x] #2 A glibc build with a stray musl prebuild present embeds the glibc .node (regression test for TASK-468)
- [x] #3 The rsync in build-linux-binary.sh still delivers the correct .node (build does not regress)
- [ ] #4 Verified on the Debian harness VM: the installed binary loads the libgpod binding (no libc.musl error)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Extracted the gpod prebuild selection out of compile.sh into a sourceable helper `packages/podkit-cli/scripts/select-gpod-prebuild.sh` (two functions: `gpod_prebuild_dir` resolves the dir by host libc; `find_gpod_prebuild` finds the *.node within it). compile.sh now sources it and does `PREBUILD_DIR=$(gpod_prebuild_dir ...)` / `PREBUILD=$(find_gpod_prebuild "$PREBUILD_DIR")` — no more first-dir-wins loop.

Selection is explicit by host libc, mirroring the existing `usb` prebuild probe: on Linux, `ldd /bin/sh | grep -q musl` → `linux-{arch}-musl`, else `linux-{arch}`. Non-Linux (darwin) has no libc split and always resolves the bare `{platform}-{arch}` dir. Only the matching-libc dir is ever considered; a stray wrong-libc dir is never a fallback.

Also fixed the dead `$PREBUILD_DIR` reference in the no-native-binding error message — it now prints the actually-searched dir (the real var). Local-build fallback (`build/Release/gpod_binding.node`) and hard-fail behaviour left intact.

Regression test: `packages/podkit-cli/test/select-gpod-prebuild.bats` (9 tests, matches the existing bats convention in @podkit/docker). Fixture prebuild dirs hold BOTH `linux-{arch}` and `linux-{arch}-musl` variants; a fake `ldd` on PATH pins the apparent host libc. The key test asserts a glibc host with a stray musl dir present selects the glibc `.node`. Verified it FAILS against the old first-dir-wins logic (reproduced separately) and PASSES with the fix. Wired via `podkit` package.json: `test` script → `bats test/`, added `bats@^1.11.1` devDep (same as docker); runs inside the existing turbo `test` task.

AC#3: confirmed compatible — build-linux-prebuild.sh writes the glibc prebuild to the bare `prebuilds/linux-$arch/` dir, which is exactly what the glibc host now selects; build-linux-binary.sh's rsync still delivers it (prebuilds/ is not excluded there).

Quality gates (all pass): shellcheck -x compile.sh (exit 0), shellcheck select-gpod-prebuild.sh (clean), `bun run test --filter podkit` (67 bun + 9 bats pass), typecheck (pass), oxlint (0 warnings/0 errors).

AC#4 left unchecked — VM runtime verification (harness:setup + test:vm on the Debian glibc VM) is the team lead's step.
<!-- SECTION:NOTES:END -->

---
id: TASK-536
title: >-
  Musl podkit binary intermittently embeds a glibc-linked libgpod binding
  (`fcntl64: symbol not found`)
status: Done
assignee: []
created_date: '2026-10-03 18:54'
updated_date: '2026-10-03 21:57'
labels:
  - build
  - docker
  - flaky
milestone: m-20
dependencies: []
references:
  - test-packages/device-testing/package.json
  - packages/libgpod-node/prebuilds/
modified_files:
  - packages/podkit-cli/scripts/select-gpod-prebuild.sh
  - packages/podkit-cli/scripts/compile.sh
  - packages/podkit-cli/test/select-gpod-prebuild.bats
  - test-packages/device-testing/src/build-jobs/jobs.ts
  - test-packages/device-testing/src/build-jobs/jobs.test.ts
  - tools/prebuild/build-linux-musl.sh
  - .changeset/musl-binding-libc-guard.md
priority: medium
type: bug
ordinal: 306000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In 1 of 3 forced `test:e2e:docker-dist` runs on the remote substrate (2026-10-03), every daemon cell in the musl image failed the same way:

```
Sync failed for /ipod: Failed to open iPod: Failed to open database: Failed to load native binding:
Error relocating /tmp/.bun-0-<hash>.node: fcntl64: symbol not found
```

`fcntl64` is a glibc symbol, so the musl binary carried a libgpod binding linked against glibc. The other two runs were clean, and one of them was on unmodified HEAD.

What is known:
- Every build task had **identical turbo hashes** across the good and bad runs (`musl-prebuild 6466ba0f`, `linux-binary af688b3e`, `musl-binary 438398a1`), so the cache key does not capture whatever differed.
- Both builds were forced on `builderRemote`. They stage into separate dirs (`glibc-prebuild`, `musl-prebuild`, `glibc-binary`, `musl-binary`) and collect into separate host dirs (`prebuilds/linux-x64/`, `prebuilds/linux-x64-musl/`). Both report `OK: prebuild is statically linked`.
- The only visible difference was task start order on the shared builder: in the bad run `musl-prebuild` staged before `linux-prebuild` and `gpod-tool`.

Suspects: a shared path on the builder or host that one build writes and the other reads, such as `packages/libgpod-node/build/Release` staged with `.` before it is cleaned, or bun `--compile` resolving the binding from a location that is not the musl prebuild. The static-link check only proves the `.node` has no dynamic deps. It does not prove which libc's symbol versions it references.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The race or shared path is identified and reproduced deliberately
- [x] #2 The musl build verifies that the binding it embeds references no glibc-only symbols, and fails the build if it does
- [x] #3 Repeated forced docker-dist runs show no `Error relocating` at runtime
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce: bats test — host_is_musl under `set -o pipefail` with an ldd that writes in more than one burst. `grep -q` exits on the first musl line, ldd takes SIGPIPE (141), pipefail turns the probe false, and compile.sh selects the bare linux-{arch} (glibc) prebuild that rides along in the binary job's stage.
2. Fix the probe so it captures ldd's whole output (no early-closing pipe).
3. Guard: compile.sh asserts the staged binding's DT_NEEDED libc matches the target libc (libc.musl-* vs libc.so.6) and fails the build otherwise. Build jobs declare the libc explicitly (PODKIT_TARGET_LIBC) so the guard has a truth independent of the probe.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause (probable, reproduced): `host_is_musl` was `ldd /bin/sh | grep -q musl`, and compile.sh sources it under `set -euo pipefail`. Alpine's ldd (`ld-musl --list`) prints each line with its own `writev` (confirmed with strace in alpine:3.21). `grep -q` exits on the first line, ldd can take SIGPIPE on the second, and pipefail turns the probe false. compile.sh then selects the bare `linux-{arch}` prebuild, which rides along in the musl-binary stage (binary jobs don't prune prebuilds/). The usb prebuild variant flipped the same way. This explains why turbo hashes were identical (runtime timing, outside the cache key) and why it correlated with start order (builder load).

Reproduction: a bats test with a two-burst fake ldd under pipefail failed before the fix. On real alpine:3.21 with 1 CPU and 6 busy loops, the old probe returned false in 1 of 3000 runs and the new one in 0 of 3000. The field rate on a loaded builder may differ, so this is probable rather than proven against the original run. `build/Release` as a shared path was not ruled out directly, but the new guard rejects a wrong-libc binding from any source.

Guard: compile.sh now runs `assert_binding_libc` on the staged binding. The check uses readelf DT_NEEDED and requires `libc.musl-*` for musl and `libc.so.6` for glibc, rejecting the other. I chose DT_NEEDED over GLIBC_ version tags because the arm64 musl prebuild legitimately references GLIBC_2.0 through libgcc_s. Build jobs export PODKIT_TARGET_LIBC, which `target_libc` cross-checks against the probe. Verified against the real prebuilds with real binutils in alpine:3.21 and debian:12.

CI was not touched. Its readelf `| grep -q` checks run under Actions' default `bash -e` (no pipefail) or Alpine `sh -e`, so they are not exposed. CI's musl `bun run compile` *was* exposed, because compile.sh sets pipefail itself, so shipped musl/Docker binaries could have been affected. That is why there is a changeset.

AC#3 is still open: it needs repeated forced `test:e2e:docker-dist` runs on the remote substrate.

AC#3 verification (2026-10-03):

**Three forced `bun run test:e2e:docker-dist --force` runs on builderRemote and the remote substrate.** Each ran 24 of 24 tasks and the docker-dist tests went 6 pass, 0 fail. No run logged `Error relocating` at runtime or `fcntl64`. The only `Error relocating` lines come from the musl prebuild's own `ldd "$PREBUILD" || true` diagnostic, which lists unresolved `napi_*` symbols on a bare `.node` and is expected. Every run logged `Verified binding links glibc` twice and `Verified binding links musl` twice (production and debug).

**Root cause confirmed under real load.** During run 1, 30k iterations of the old and new probe ran in the builder's `podkit-musl-builder:local` container. The old probe returned false 1592 times in 30,000; the new one returned false 0 times. Almost all of the old failures fell while the builds loaded the builder (load average about 2.3 to 2.8), where the rate was about 14 to 16%. compile.sh probes more than once per musl compile, so a 1-in-3 bad-run rate fits.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The musl podkit binary sometimes embedded the glibc libgpod binding. The cause was `host_is_musl` (`ldd /bin/sh | grep -q musl`) running under compile.sh's pipefail. musl's ldd writes each line separately, so grep could exit and SIGPIPE ldd. Under builder load the probe then reported glibc about 15% of the time, and the glibc prebuild already sitting in the stage got embedded.

Fix:
- The probe now captures ldd's output before matching it.
- Build jobs declare PODKIT_TARGET_LIBC, which is cross-checked against the probe.
- compile.sh refuses any binding whose readelf DT_NEEDED libc doesn't match the target.
- The same probe fix went into build-linux-musl.sh.
- A patch changeset was added for `podkit`, because CI's musl release compile was exposed too.

Verification:
- New bats tests: 21 total.
- New jobs.test case.
- The guard was checked against the real prebuilds in alpine and debian containers.
- The probe was stress-tested in the real builder's musl container: old 1592 of 30k false, new 0.
- Three forced docker-dist runs all passed with no runtime relocation errors.
<!-- SECTION:FINAL_SUMMARY:END -->

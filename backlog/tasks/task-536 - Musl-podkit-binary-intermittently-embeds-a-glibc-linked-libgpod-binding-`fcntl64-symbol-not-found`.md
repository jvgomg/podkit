---
id: TASK-536
title: >-
  Musl podkit binary intermittently embeds a glibc-linked libgpod binding
  (`fcntl64: symbol not found`)
status: To Do
assignee: []
created_date: '2026-10-03 18:54'
labels:
  - build
  - docker
  - flaky
milestone: m-20
dependencies: []
references:
  - test-packages/device-testing/package.json
  - packages/libgpod-node/prebuilds/
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
- [ ] #1 The race or shared path is identified and reproduced deliberately
- [ ] #2 The musl build verifies that the binding it embeds references no glibc-only symbols, and fails the build if it does
- [ ] #3 Repeated forced docker-dist runs show no `Error relocating` at runtime
<!-- AC:END -->

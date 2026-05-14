---
id: TASK-322.03
title: Binary transfer mechanism (host turbo cache → test VM)
status: In Progress
assignee: []
created_date: '2026-05-12 08:19'
updated_date: '2026-05-13 22:54'
labels:
  - testing
  - vm-coverage
  - lima
  - tier-3
milestone: m-19
dependencies:
  - TASK-322.01
  - TASK-321.07
parent_task_id: TASK-322
priority: high
ordinal: 430
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the mechanism that copies the turbo-cached podkit linux-x64 binary from the host into the test VM and places it at `/usr/local/bin/podkit`. The test VM has no source tree and no dev toolchain — the binary is the only podkit artifact that exists inside it.

**Transfer mechanism:**
- Small TypeScript helper (or shell wrapper) that:
  1. Resolves the path to the latest `podkit-linux-x64` binary from the turbo cache output of `build:linux-binary` (TASK-321.07)
  2. Runs `limactl copy <host-path> <vm-name>:/usr/local/bin/podkit`
  3. Sets execute permissions inside the VM: `limactl shell <vm-name> chmod +x /usr/local/bin/podkit`
- **Atomic**: copy to a temp path then rename, so a partial transfer never leaves a broken binary at `/usr/local/bin/podkit`
- **Idempotent**: if the binary at `/usr/local/bin/podkit` matches the host binary (SHA-256 comparison), skip the transfer

**When it runs:**
- Called by the `lima-test-vm` TestRuntime's `prepare()` method (TASK-322.04) before any test commands execute
- Can also be invoked standalone: `mise run device-testing:transfer-binary` (or equivalent) for developer convenience

**Why not a Lima mount:**
Lima `mounts:` would expose the entire host filesystem subtree to the VM, reintroducing the dev-library shadowing risk. `limactl copy` transfers only the named binary — nothing else from the host is visible inside the VM.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 transferBinary(vmName, binaryPath) helper exported from @podkit/device-testing; performs limactl copy + chmod atomically
- [x] #2 Idempotent: transferBinary skips the copy if the VM already has an identical binary (SHA-256 match)
- [x] #3 Atomic: copies to a temp path then renames; partial transfer never corrupts /usr/local/bin/podkit
- [ ] #4 After transfer, `limactl shell <vm> podkit --version` returns a non-empty version string
- [x] #5 Standalone mise task (or npm script) allows developers to run the transfer without running the full test suite
- [x] #6 No Lima mounts: entries added to the test-vm.yaml by this task
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation (m-19 Phase 3a)

Shipped `transferBinary` + `transferGpodTool` in `packages/device-testing/src/runners/lima-test-vm-binary.ts`, exported from `@podkit/device-testing`'s public surface (`src/index.ts`). Mise task `device-testing:transfer-binary` drives a TypeScript script (`packages/device-testing/scripts/transfer-binary.ts`) so the helper has exactly one source of truth.

### Transfer pipeline

For each call: `limactl shell <vm> -- sh -c 'sha256sum <vmPath>'` → if hash matches the host file, skip and return `skipped: true`. Otherwise: `limactl copy <host> <vm>:/tmp/podkit-transfer-<uuid>` → `limactl shell <vm> -- sudo install -m 0755 <tmp> <vmPath>` → `limactl shell <vm> -- rm -f <tmp>`. The `install` call is POSIX-atomic (writes-then-renames) so a partial transfer can never leave a corrupt file at `vmPath`. On install failure we still issue the `rm -f` cleanup before propagating, so the VM `/tmp` is not left dangling.

### Path resolution

- Podkit linux binary: resolved from `packages/podkit-cli/bin/podkit-linux-${arch}` (matches the `outputs` glob declared for `@podkit/device-testing#build:linux-binary` in `turbo.json`). Override via `PODKIT_LINUX_BINARY=<path>`.
- gpod-tool: host-side cross-build is not yet wired up (noted in `tools/device-testing/lima/README.md §"gpod-tool sourcing"`). The script looks at `tools/gpod-tool/gpod-tool-linux` (override via `PODKIT_GPOD_TOOL_BINARY`); if absent, the script warns and exits 0 — podkit transfer alone is the supported path until a future host build pipeline lands. `transferGpodTool` itself does NOT build; it transfers and throws a clear error pointing at the README section if the source is missing.

### Testing

Unit tests in `lima-test-vm-binary.test.ts` use a scripted fake `SubprocessRunner` (DI seam already present in the package) — 14 tests covering: happy path, custom vmPath, sha256 skip, sha256 mismatch, unique temp-path-per-call, cleanup on install failure, no `install` after copy failure, missing host binary, ENOENT (`limactl` not on PATH), non-zero probe exit, missing `vmName`, gpod-tool defaults, missing gpod-tool source, gpod-tool idempotency.

End-to-end smoke (host-side) confirmed: `mise run device-testing:transfer-binary` resolves the binary path correctly, surfaces a clean error when the binary is missing, and proxies through to real `limactl` (verified by triggering a "VM does not exist" error from `limactl shell`).

### AC status

- AC1 ✅ — `transferBinary` exported; performs `limactl copy` + `sudo install -m 0755` + cleanup.
- AC2 ✅ — sha256 idempotency probe via `sha256sum | awk`. Tested.
- AC3 ✅ — temp path uses `randomUUID()`; `install` is atomic; cleanup runs on install failure; no `install` runs on copy failure.
- AC4 ⏳ — requires a real test VM; the script will surface a non-empty version string via `--version` once a real binary is in place. Cannot verify without TASK-322.04's runner orchestrating a live VM boot.
- AC5 ✅ — Mise task `device-testing:transfer-binary` + npm script `transfer-binary` in `@podkit/device-testing`.
- AC6 ✅ — No `mounts:` change to `test-vm.yaml`; the helper uses `limactl copy` end-to-end.

### Files touched

- `packages/device-testing/src/runners/lima-test-vm-binary.ts` (new)
- `packages/device-testing/src/runners/lima-test-vm-binary.test.ts` (new)
- `packages/device-testing/src/index.ts` (added exports)
- `packages/device-testing/package.json` (added `transfer-binary` script)
- `packages/device-testing/scripts/transfer-binary.ts` (new driver)
- `mise.toml` (added `device-testing:transfer-binary` task)

### Quality gates

- `bun run test --filter @podkit/device-testing` → 95 pass / 0 fail / 2 skip
- `bunx tsc --noEmit` inside `packages/device-testing/` → clean
- `bunx oxlint` on the new files → 0 warnings, 0 errors

### Open items / handoff

- AC4 closes when TASK-322.04 (`lima-test-vm` runner) lands; the runner's `prepare()` will call `transferBinary` then assert `podkit --version` exits 0.
- Host-side Linux gpod-tool build remains an open contract — once a build artefact exists, the driver picks it up automatically (or via `PODKIT_GPOD_TOOL_BINARY`).
<!-- SECTION:NOTES:END -->

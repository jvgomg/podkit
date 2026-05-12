---
id: TASK-322.03
title: Binary transfer mechanism (host turbo cache → test VM)
status: To Do
assignee: []
created_date: '2026-05-12 08:19'
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
- [ ] #1 transferBinary(vmName, binaryPath) helper exported from @podkit/device-testing; performs limactl copy + chmod atomically
- [ ] #2 Idempotent: transferBinary skips the copy if the VM already has an identical binary (SHA-256 match)
- [ ] #3 Atomic: copies to a temp path then renames; partial transfer never corrupts /usr/local/bin/podkit
- [ ] #4 After transfer, `limactl shell <vm> podkit --version` returns a non-empty version string
- [ ] #5 Standalone mise task (or npm script) allows developers to run the transfer without running the full test suite
- [ ] #6 No Lima mounts: entries added to the test-vm.yaml by this task
<!-- AC:END -->

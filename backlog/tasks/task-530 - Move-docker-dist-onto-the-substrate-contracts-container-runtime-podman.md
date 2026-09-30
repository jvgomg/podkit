---
id: TASK-530
title: Move docker-dist onto the substrate contract's container runtime (podman)
status: In Progress
assignee: []
created_date: '2026-09-29 21:55'
updated_date: '2026-09-30 21:17'
labels:
  - testing
  - infrastructure
milestone: m-20
dependencies:
  - TASK-517
  - TASK-533
references:
  - test-packages/e2e-vm-tests/src/vm-docker/
  - test-packages/device-testing/src/runners/shipped-image.ts
  - test-packages/device-testing/scripts/substrate-contract.sh
modified_files:
  - test-packages/device-testing/src/runners/shipped-image.ts
  - test-packages/device-testing/src/runners/shipped-image.test.ts
  - test-packages/device-testing/src/index.ts
  - test-packages/e2e-vm-tests/src/vm-docker/daemon.docker-dist.test.ts
  - test-packages/e2e-vm-tests/src/vm-docker/image.docker-dist.test.ts
  - test-packages/e2e-vm-tests/src/vm-docker/container-helpers.ts
  - test-packages/e2e-vm-tests/src/vm-docker-loopback/harness.ts
  - >-
    test-packages/e2e-vm-tests/src/vm-docker-loopback/device-add-trust-disk.docker-loopback.test.ts
  - test-packages/lima/vms/podkit-device.yaml
  - docs/agents/docker.md
priority: medium
type: task
ordinal: 300000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split out of TASK-517.

TASK-517 added `podman` to the substrate contract and moved the `vm-docker-image` · `loopback-fat` cell onto it. The sibling `vm-docker-image` · `usb-synth` cell (`test:e2e:docker-dist`, `src/vm-docker/`) still drives `sudo nerdctl …` — which only exists on a **Lima** substrate, because Lima installs nerdctl-full by default. The remote Proxmox substrate has no nerdctl, so `test:e2e:docker-dist` cannot run there today.

The image build/pull (`shipped-image.ts`) already runs over `SubstrateLink` and takes the runtime as a parameter; the two docker-dist test files pass `runtime: 'nerdctl'` explicitly. What remains is the ~15 raw `sudo nerdctl run/logs/inspect/stop/rm` command strings in `daemon.docker-dist.test.ts` and `image.docker-dist.test.ts`, plus `container-helpers.ts` comments.

Watch for Podman/nerdctl differences on the flags these tests use: `--device`, `--network host`, `stop --time`, `inspect -f '{{.State.ExitCode}}'`. Once nothing uses nerdctl, consider disabling Lima's default containerd in `podkit-device.yaml` so the substrate carries one runtime.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 docker-dist builds, pulls and runs the image with the contract runtime rather than nerdctl
- [ ] #2 test:e2e:docker-dist passes on the remote substrate
- [x] #3 test:e2e:docker-dist still passes on a Lima substrate
- [x] #4 Nothing in the harness depends on nerdctl, or what still does is named and justified
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Done (commit `test(docker-dist): run the shipped image with the contract's podman`)

**Code changes**
- Every `sudo nerdctl …` call in docker-dist now uses `SUBSTRATE_CONTRACT_RUNTIME`.
- The flags work unchanged under rootful podman: `--device`, `--network host`, `stop --time`, `inspect -f '{{.State.ExitCode}}'`.
- `shipped-image.ts` is podman-only. The `runtime` option, the `SubstrateContainerRuntime` type and the containerd/buildkit service table are removed.
- The runtime-presence probe moved into `ensurePodkitImageInVm`, so both shipped-image cells get the remedy message.
- `podkit-device.yaml` sets `containerd: {system: false, user: false}`. The yaml is a Lima seal input and only applies at create time, so an existing VM needs `vm:destroy device` + `harness:setup`. The remote seal uses the cloud-init template and is unaffected.

**AC #3 — Lima**
- On a recreated VM with no nerdctl: docker-dist 6/6, docker-loopback 3/3.

**AC #4 — what still mentions nerdctl, and why**
- `lima/src/link.ts` and `link.test.ts` use a captured `nerdctl` logrus line as a fixture for the fatal-log classifier. It is a log-format example, not a dependency.
- `e2e-tests/src/docker/runtime.test.ts` uses `'nerdctl'` as an arbitrary value for the *host* `PODKIT_CONTAINER_RUNTIME` override. That is a different surface.

**AC #2 — remote: not met.** 4/6 pass. Both failures are remote-substrate issues rather than podman ones; see TASK-533:
- In-container USB inquiry `LIBUSB_TRANSFER_STALL` → SIE not written.
- The 120-track Apprise sync outruns its 90 s wait on 2 vCPU.

A podman-vs-nerdctl A/B is impossible there because the remote never had nerdctl.

**Latent risk (not a failure today)**
- Both cells now share podman's image store.
- `buildPodkitImageInVm` runs `system prune -af`, so whichever cell builds second removes the other's image. Both force-build in `beforeAll`, so this is fine sequentially; running the two cells concurrently would break.
<!-- SECTION:NOTES:END -->

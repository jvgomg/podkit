---
id: TASK-530
title: Move docker-dist onto the substrate contract's container runtime (podman)
status: To Do
assignee: []
created_date: '2026-09-29 21:55'
labels:
  - testing
  - infrastructure
milestone: m-20
dependencies:
  - TASK-517
references:
  - test-packages/e2e-vm-tests/src/vm-docker/
  - test-packages/device-testing/src/runners/shipped-image.ts
  - test-packages/device-testing/scripts/substrate-contract.sh
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
- [ ] #1 docker-dist builds, pulls and runs the image with the contract runtime rather than nerdctl
- [ ] #2 test:e2e:docker-dist passes on the remote substrate
- [ ] #3 test:e2e:docker-dist still passes on a Lima substrate
- [ ] #4 Nothing in the harness depends on nerdctl, or what still does is named and justified
<!-- AC:END -->

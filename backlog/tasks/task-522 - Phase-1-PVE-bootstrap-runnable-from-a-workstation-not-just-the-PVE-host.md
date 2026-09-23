---
id: TASK-522
title: 'Phase-1 PVE bootstrap runnable from a workstation, not just the PVE host'
status: In Progress
assignee: []
created_date: '2026-09-23 17:31'
updated_date: '2026-09-23 17:43'
labels:
  - testing
  - infrastructure
  - ready-for-human
milestone: m-20
dependencies:
  - TASK-493
references:
  - docs/environments/device-substrate-proxmox.md
  - docs/environments/builder-proxmox.md
  - test-packages/device-testing/substrate/proxmox/pveum-recipe.sh
priority: high
type: feature
ordinal: 292000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split the Proxmox setup into a **privileged bootstrap that happens once** and a **low-privilege lifecycle that happens constantly**, and make the first one runnable from wherever the privileged human actually sits.

Today `pveum-recipe.sh` hard-fails unless it is running on the PVE host, and two further steps — placing the cloud-init snippet and fetching the pinned qcow2 — are loose `sed`/`curl` lines in a playbook that also assume a root shell there. So the whole of phase 1 is "ssh to the hypervisor and follow a document".

**Three things need root on the PVE host, and only three.** The `pveum` grant (that binary exists nowhere else), the cloud-init snippet (PVE's storage-upload API accepts `iso`, `vztmpl` and `import` — not `snippets`, so no token can place one), and the base image (`import-from=` needs the file already on the host). Everything after that is either the pool-scoped token or plain ssh to a guest.

Drawing that boundary sharply is what makes the rest of the model work: once those three exist, creating, starting, stopping, destroying and recreating VMs are all inside the committed token's ACL, and applying the contract, installing binaries and running tests need no PVE rights at all.

**The script is also the documentation.** A `--print-only` mode emits the exact command sequence for someone who would rather paste it by hand or read it before trusting it — which means the automation and the runbook cannot drift, because they are one file.

Deliberately NOT here: creating the VMs. That is inside the token's rights, so it belongs to TASK-515 with the rest of the lifecycle, not to the privileged phase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Phase 1 runs unchanged whether invoked on the PVE host or from a workstation with ssh to it
- [x] #2 It performs exactly the three steps that require root on the PVE host: the pveum grant, the cloud-init snippet, and the pinned image
- [x] #3 --print-only emits the equivalent command sequence without running anything, so the runbook and the automation cannot drift
- [x] #4 It is idempotent: a second run changes nothing and reports why
- [x] #5 The pinned image URL it uses is asserted against @podkit/substrate rather than restated freely
- [x] #6 It prepares snippets for the substrate and the builder profiles from the one shared template
- [x] #7 Both playbooks point at it for step 1 and keep the by-hand sequence only as the fallback it prints
- [x] #8 No hostname, pool, storage, bridge, key or credential appears in any committed file
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The privilege boundary, drawn in one script

`test-packages/device-testing/substrate/proxmox/bootstrap-pve.sh`. One transport function, two modes, so every step is written once whether the human is sitting on the hypervisor or on their laptop:

```bash
bash bootstrap-pve.sh                        # on the PVE host
bash bootstrap-pve.sh --pve-host root@<pve>  # from anywhere
bash bootstrap-pve.sh --print-only           # emit the runbook instead
```

Payloads are **piped on stdin** rather than copied and cleaned up — `cat pveum-recipe.sh | ssh host 'env … bash -s'` — so nothing is left on the hypervisor and there is no temp file to forget. The snippet is rendered on the *workstation* side and piped, so the public key never lands in a file on the host other than the snippet itself.

### Why exactly three steps

The script does the `pveum` grant, the cloud-init snippets, and the pinned image. Nothing else, and the reason each one is here is that **no token can do it**:

- `pveum` exists on no machine but a PVE host, and creating roles/pools/tokens is root by definition.
- PVE's storage-upload API accepts `iso`, `vztmpl` and `import` content — **not `snippets`**. Placing one is a filesystem write on the host or nothing. This is the sharpest constraint and the one that most justifies a separate privileged phase.
- `import-from=` reads a file on the host, so the qcow2 has to be there first.

It deliberately **creates no VM**, and there is a test asserting no `qm create` appears in its output. Creating a guest is inside the committed token's `VM.Allocate` on the pool, so it belongs to the low-privilege half (TASK-515). Letting it drift back here would quietly re-privilege the thing the split exists to de-privilege.

### `--print-only` is a runbook, and it had to be made pasteable

The mode exists because a reader may reasonably want to paste the commands by hand, or read them before trusting a script with their hypervisor. Generating both from one file is what stops the runbook drifting from the automation.

That only works if what it prints parses, and the first version did not. It emitted

```
ssh host 'mkdir -p $(… sed -n 's/…/p')/snippets'
```

where the inner `sed` quotes closed the outer `ssh` quoting early. Run mode was unaffected — it resolves the path on the client side and never emits that string — so this was invisible except to someone pasting it. A runbook that is subtly unpasteable is worse than none, because the reader trusts it. Fixed with a `quote_for_display` helper using the `'\''` idiom, and pinned by `pve-bootstrap.test.ts`, which pipes the emitted commands through `bash -n` in both modes.

### Verified against a faked PVE

Not just linted. Ran both modes in a `debian:12` container with stub `pveum`/`pvesh`/`pvesm`/`curl` and an `ssh` that executes locally:

- **local mode** — recipe invoked with pool/storage/bridge correctly propagated, both snippets rendered with hostname and key substituted and **zero placeholders remaining**, image fetch attempted
- **idempotence** — second run reports `already present` and re-fetches nothing
- **remote mode** — every host-touching command routed through ssh (10 invocations), snippets landed identically

Six unit tests cover the print-only half, including that local mode spawns no `ssh` at all and remote mode reaches the host through nothing else.

### The pinned image URL is restated but checked

`bootstrap-pve.sh` carries the URL literally because it runs on a PVE host, which has neither TypeScript nor a clone of this repo. `debian-image.test.ts` now asserts it equals `substrateDebianImageUrl('amd64')`.

Read by **regex, not by sourcing** — unlike the two box contracts, which `shell-contract.ts` sources. That distinction is deliberate and worth keeping: a contract is a declarations-only file that promises to be side-effect free, while this is an executable script with `set -eu` and top-level logic. Sourcing it to read one variable would run it.

### Where VMIDs live

`.env.example` gains `PODKIT_PVE_VMID_DEVICE_REMOTE` / `PODKIT_PVE_VMID_BUILDER_REMOTE`, with the reasoning: PVE addresses a guest by **VMID**, and a VMID is a fact about someone's hypervisor rather than about podkit — the same argument that keeps the ssh alias out of the repo. The registry declares the role; the developer's env declares which guest fills it.

This also dissolves a mismatch I had expected to have to fix. The registry's `instanceName` for the ssh entries (`podkit-device-remote`) disagrees with the guest name the playbooks create (`podkit-substrate`). Since nothing resolves a guest by name, that is a documentation wrinkle rather than a defect — noted on TASK-515 so its client does not reach for the name.

### Not done

Running it against the real host. It needs the PVE address and root there, neither of which this machine has.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: claude
created: 2026-09-23 17:43
---
All eight ACs are ticked against a **faked** PVE, not a real one. Ticked rather than left open because each AC is a property of the script — modes, step coverage, print-only parseability, idempotence, the URL pin, both profiles, the playbooks, no committed secrets — and every one of those is verifiable without a hypervisor. None of them says "works on a real PVE host".

That claim is deliberately NOT made, and the task stays In Progress until someone makes it. The handoff brief is on TASK-520; the one thing most likely to be wrong is the storage-path resolution:

```
pvesh get /storage/<id> --output-format json | sed -n 's/.*"path":"\([^"]*\)".*/\1/p'
```

That regex assumes a `path` key in the JSON for a directory storage. Stubbed here, never observed. If it returns empty the script fails loudly with an actionable message rather than writing a snippet somewhere PVE never reads — which was the point of resolving the path rather than assuming `/var/lib/vz/snippets` — but a fix may still be needed.

Also unobserved: the `pvesm status --content snippets` check, which warns rather than fails. `snippets` is off by default on every storage including `local`, so that warning is expected to fire on a fresh host and is the most likely first surprise.
---
<!-- COMMENTS:END -->

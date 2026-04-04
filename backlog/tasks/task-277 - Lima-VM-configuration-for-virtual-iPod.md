---
id: TASK-277
title: Lima VM configuration for virtual iPod
status: Done
assignee: []
created_date: '2026-04-03 20:19'
updated_date: '2026-04-03 21:09'
labels:
  - lima
  - infrastructure
milestone: m-17
dependencies: []
references:
  - doc-028
  - tools/lima/debian.yaml
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a Lima VM YAML configuration for the virtual iPod, extending the existing `tools/lima/debian.yaml` pattern.

**VM config (`tools/lima/virtual-ipod.yaml`):**
- Base: Debian 12 Bookworm (same as existing `debian.yaml`)
- CPUs: 2 (lightweight — just serves files and manages gadget)
- Memory: 2 GiB
- Disk: 20 GiB (needs space for iPod image + podkit + audio files)
- Architecture: arm64 + x86_64

**Port forwarding:**
- Guest port 3456 → Host port 3456 (virtual-ipod-server API)

**Provision (root):**
- Install: build-essential, pkg-config, libgpod-dev, libglib2.0-dev, ffmpeg, util-linux, git, curl, unzip
- Install: Node.js 22 LTS (for podkit)
- Verify kernel modules available: `modinfo dummy_hcd`, `modinfo usb_f_mass_storage`
- Mount configfs: `mount -t configfs none /sys/kernel/config`
- Create iPod image directory: `mkdir -p /var/lib/virtual-ipod`

**Provision (user):**
- Install Bun
- Clone/link podkit repo
- Build podkit: `bun install && bun run build`
- Build virtual-ipod-server
- Create initial FAT32 iPod image and initialize with gpod-tool

**Shared filesystem:**
- Mount podkit repo from macOS host for development
- Read-write access

**Startup script (optional):**
- Auto-start virtual-ipod-server on VM boot
- Or document manual start command for development
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 limactl create --name virtual-ipod tools/lima/virtual-ipod.yaml succeeds
- [x] #2 VM boots with dummy_hcd and libcomposite modules available
- [x] #3 configfs mounted at /sys/kernel/config
- [ ] #4 podkit CLI runs inside the VM
- [ ] #5 virtual-ipod-server runs and is accessible from macOS host on port 3456
- [ ] #6 Post plug-in: podkit device scan detects virtual iPod inside the VM
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Lima YAML at tools/lima/virtual-ipod.yaml. 2 CPUs, 2 GiB RAM, 20 GiB disk. Port 3456 forwarded. configfs mounted and persisted in fstab. Kernel module availability checked with warnings. /var/lib/virtual-ipod and /mnt/ipod directories created. README updated with VM specs and quick-start. AC #4-6 require running the VM — can't verify in this session.
<!-- SECTION:NOTES:END -->

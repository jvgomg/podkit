---
id: TASK-172
title: Docker image crashes with "Illegal instruction" on minimal x86_64 CPUs
status: Done
assignee: []
created_date: '2026-03-19 20:46'
updated_date: '2026-03-23 14:57'
labels:
  - bug
  - docker
  - bun
milestone: 'M3: Production Ready (v1.0.0)'
dependencies: []
references:
  - packages/podkit-docker/Dockerfile
  - .github/workflows/docker.yml
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The podkit Docker image (Alpine/musl, built with Bun) crashes immediately with "Illegal instruction (core dumped)" on x86_64 systems that lack modern CPU instruction sets.

### Reproduction

Run the image on a QEMU VM with `kvm64` or `qemu64` CPU type (only SSE2, no SSE4/AVX):

```bash
docker run --rm ghcr.io/jvgomg/podkit:latest --version
# Illegal instruction (core dumped)
```

The crash happens before any podkit code runs — the Bun runtime itself requires CPU features not present on this hardware.

### CPU flags on the crashing system

```
flags: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ht syscall nx lm constant_tsc nopl xtopology cpuid tsc_known_freq pni cx16 x2apic hypervisor lahf_lm cpuid_fault pti
```

Notable absences: no `sse4_1`, `sse4_2`, `avx`, `avx2`.

### Root cause

Bun's compiled binaries require at least SSE4.2 (and possibly AVX). This is a known Bun baseline requirement. The crash occurs in the Bun runtime, not in podkit or libgpod-node native code.

### Affected environments

- Proxmox VMs with `kvm64` or `qemu64` CPU type (the default)
- Older x86_64 hardware (pre-Nehalem / pre-2008)
- Some budget cloud VPS instances with minimal CPU emulation

### Not affected

- Synology NAS (real AMD/Intel CPUs with full instruction sets)
- Proxmox VMs with `host` CPU type
- Bare metal Linux
- Any modern x86_64 hardware (2010+)

### Resolution options

1. **Document the minimum CPU requirement** — note that VMs should use `host` CPU type or at least `x86-64-v2`
2. **Investigate Bun's baseline** — confirm exact CPU feature requirements and document them
3. **Long-term:** if Bun ever supports a lower baseline build, switch to it

### Discovered during

Synology NAS / Debian VM validation (TASK-165). VM was a Proxmox QEMU instance with default CPU type.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Minimum CPU requirements are documented in Docker docs (SSE4.2 minimum, recommend host CPU type for VMs)
- [x] #2 Docker troubleshooting section covers the Illegal instruction error with fix (change VM CPU type)
- [x] #3 Bun's exact baseline CPU requirement is confirmed and documented
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
CPU requirements (SSE4.2 minimum) and "Illegal instruction" troubleshooting documented in `docs/getting-started/docker-daemon.md`, including Proxmox VM CPU type guidance.
<!-- SECTION:FINAL_SUMMARY:END -->

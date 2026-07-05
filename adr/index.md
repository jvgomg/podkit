---
title: Architecture Decision Records
description: Index of Architecture Decision Records documenting significant technical decisions for podkit.
sidebar:
  order: 1
---

# Architecture Decision Records

This section contains Architecture Decision Records (ADRs) documenting significant technical decisions for the podkit project.

## ADR Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](/developers/adr/adr-001-runtime) | Runtime Choice (Bun/Node) | Accepted (refined by ADR-021) | 2025-02-22 |
| [ADR-002](/developers/adr/adr-002-libgpod-binding) | libgpod Binding Approach | Proposed | 2025-02-22 |
| [ADR-003](/developers/adr/adr-003-transcoding) | Transcoding Backend | Proposed | 2025-02-22 |
| [ADR-004](/developers/adr/adr-004-collection-sources) | Collection Source Abstraction | Accepted | 2025-02-22 |
| [ADR-005](/developers/adr/adr-005-test-ipod-environment) | iPod Test Environment | Accepted | 2026-02-22 |
| [ADR-006](/developers/adr/adr-006-video-transcoding) | Video Transcoding | Accepted | 2026-03-08 |
| [ADR-007](/developers/adr/adr-007-subsonic-collection-source) | Subsonic Collection Source | Proposed | 2026-03-08 |
| [ADR-008](/developers/adr/adr-008-multi-collection-device-config) | Multi-Collection Device Config | Proposed | 2026-03-08 |
| [ADR-009](/developers/adr/adr-009-self-healing-sync) | Self-Healing Sync | Accepted | 2026-03-14 |
| [ADR-012](/developers/adr/adr-012-artwork-change-detection) | Artwork Change Detection | Accepted | 2026-03-16 |
| [ADR-013](/developers/adr/adr-013-ipod-artwork-corruption-diagnosis-and-repair) | iPod Artwork Corruption — Diagnosis and Repair | Draft | 2026-03-20 |
| [ADR-014](/developers/adr/adr-014-device-capability-architecture) | Device Capability Architecture (m-18) | Accepted | 2026-05-06 |
| [ADR-015](/developers/adr/adr-015-cli-error-output-shape) | CLI Error Output Shape | Accepted | 2026-05-09 |
| [ADR-019](/developers/adr/adr-019-music-pipeline-engine-symmetry) | MusicPipeline ↔ engine/executor Symmetry | Proposed | 2026-06-12 |
| [ADR-020](/developers/adr/adr-020-ipod-identity-structured-fields) | Structured iPod Identity Fields | Accepted | 2026-06-20 |
| [ADR-021](/developers/adr/adr-021-cli-bun-binary-distribution) | CLI Distributes as a Bun Binary Only | Accepted | 2026-06-22 |
| [ADR-022](/developers/adr/adr-022-sync-tag-sole-quality-truth) | The Sync Tag Is the Sole Quality Truth | Accepted | 2026-06-27 |
| [ADR-023](/developers/adr/adr-023-lossy-reduction-down-only) | Lossy Reduction Is a Down-Only, Transfer-Mode-Defaulted Axis | Accepted | 2026-06-30 |
| [ADR-024](/developers/adr/adr-024-device-access-tiers) | Device Support Is a Tri-State Access Tier With Orthogonal Verification Provenance | Accepted | 2026-07-05 |

## What is an ADR?

An ADR captures a significant architectural or technical decision, the context that led to it, the options considered, and the consequences. ADRs create a decision log that helps current and future contributors understand *why* the codebase is structured a certain way.

## When to Create an ADR

Create a new ADR when:

- **Researching approaches** for a significant technical problem
- **Choosing between** libraries, patterns, or architectural approaches
- **Making breaking changes** to existing architecture
- **Establishing conventions** that affect how code is written

## ADR Lifecycle

```
Draft -> Proposed -> Accepted -> [Superseded|Deprecated]
```

| Status | Meaning |
|--------|---------|
| **Draft** | Work in progress, not ready for review |
| **Proposed** | Ready for discussion, decision not yet made |
| **Accepted** | Decision made, implementation can proceed |
| **Superseded** | Replaced by a newer ADR (link to replacement) |
| **Deprecated** | No longer relevant (explain why) |

## ADR Template

```markdown
# ADR-NNN: Title

## Status

**Draft|Proposed|Accepted|Superseded|Deprecated**

## Context

What is the issue that motivates this decision?

## Decision Drivers

- Key factor 1
- Key factor 2

## Options Considered

### Option A: Name
Description, pros, cons.

### Option B: Name
Description, pros, cons.

## Decision

Which option was chosen and why.

## Consequences

### Positive
- Benefit 1

### Negative
- Drawback 1

## Related Decisions

- Links to related ADRs

## References

- External links, documentation
```

## Naming Convention

ADRs are numbered sequentially: `ADR-001`, `ADR-002`, etc.

To create a new ADR:
1. Find the highest existing number
2. Create `adr-{next}-{short-kebab-title}.md`
3. Add entry to this index

## Referencing ADRs

- In markdown: `See [ADR-001](/developers/adr/adr-001-runtime)`
- In task descriptions: `Implements decision from ADR-002`
- In code comments: `// Per ADR-003, we use FFmpeg for transcoding`

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
| [ADR-001](/developers/adr/adr-001-runtime) | Runtime Choice (Bun/Node) | Proposed | 2025-02-22 |
| [ADR-002](/developers/adr/adr-002-libgpod-binding) | libgpod Binding Approach | Proposed | 2025-02-22 |
| [ADR-003](/developers/adr/adr-003-transcoding) | Transcoding Backend | Proposed | 2025-02-22 |
| [ADR-004](/developers/adr/adr-004-collection-sources) | Collection Source Abstraction | Accepted | 2025-02-22 |
| [ADR-005](/developers/adr/adr-005-test-ipod-environment) | iPod Test Environment | Accepted | 2026-02-22 |
| [ADR-006](/developers/adr/adr-006-video-transcoding) | Video Transcoding | Accepted | 2026-03-08 |
| [ADR-007](/developers/adr/adr-007-subsonic-collection-source) | Subsonic Collection Source | Proposed | 2026-03-08 |
| [ADR-008](/developers/adr/adr-008-multi-collection-device-config) | Multi-Collection Device Config | Proposed | 2026-03-08 |

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

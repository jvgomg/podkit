# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) documenting significant technical decisions for the podkit project.

## ADR Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](ADR-001-runtime.md) | Runtime Choice (Bun/Node) | Proposed | 2025-02-22 |
| [ADR-002](ADR-002-libgpod-binding.md) | libgpod Binding Approach | Proposed | 2025-02-22 |
| [ADR-003](ADR-003-transcoding.md) | Transcoding Backend | Proposed | 2025-02-22 |
| [ADR-004](ADR-004-collection-sources.md) | Collection Source Abstraction | Proposed | 2025-02-22 |
| [ADR-005](ADR-005-test-ipod-environment.md) | iPod Test Environment | Accepted | 2026-02-22 |
| [ADR-006](ADR-006-video-transcoding.md) | Video Transcoding | Proposed | 2026-03-XX |
| [ADR-007](ADR-007-subsonic-collection-source.md) | Subsonic Collection Source | Proposed | 2026-03-08 |

## ADR Workflow

### What is an ADR?

An ADR captures a significant architectural or technical decision, the context that led to it, the options considered, and the consequences. ADRs create a decision log that helps current and future contributors understand *why* the codebase is structured a certain way.

### When to Create an ADR

Create a new ADR when:

- **Researching approaches** for a significant technical problem
- **Choosing between** libraries, patterns, or architectural approaches
- **Making breaking changes** to existing architecture
- **Establishing conventions** that affect how code is written

**Guidance for AI agents:**
- If a decision is clearly significant (new package, binding strategy, data model), create an ADR without asking
- If working interactively with a user and unsure, ask whether an ADR is warranted
- If working autonomously and unsure, err on the side of creating an ADR — it's easier to delete than to reconstruct reasoning later

### ADR Lifecycle

```
Draft → Proposed → Accepted → [Superseded|Deprecated]
```

| Status | Meaning |
|--------|---------|
| **Draft** | Work in progress, not ready for review |
| **Proposed** | Ready for discussion, decision not yet made |
| **Accepted** | Decision made, implementation can proceed |
| **Superseded** | Replaced by a newer ADR (link to replacement) |
| **Deprecated** | No longer relevant (explain why) |

### Updating ADR Status

- When beginning implementation work related to an ADR, update its status to **Accepted**
- When creating a backlog task that depends on an ADR, reference the ADR in the task
- When an ADR's decision is revisited, either update the existing ADR or create a new one that supersedes it

### ADR Template

```markdown
# ADR-NNN: Title

## Status

**Draft|Proposed|Accepted|Superseded|Deprecated**

## Context

What is the issue that we're seeing that motivates this decision?

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

### Naming Convention

ADRs are numbered sequentially: `ADR-001`, `ADR-002`, etc.

To create a new ADR:
1. Find the highest existing number
2. Create `ADR-{next}-{short-kebab-title}.md`
3. Add entry to this index

### Referencing ADRs

When referencing ADRs in other documents or backlog tasks, use the format:

- In markdown: `See [ADR-001](docs/adr/ADR-001-runtime.md)`
- In task descriptions: `Implements decision from ADR-002`
- In code comments: `// Per ADR-003, we use FFmpeg for transcoding`

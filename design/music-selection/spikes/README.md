# Spikes

Technical investigations and research work that resolve hard unknowns
ahead of feature design or implementation. A spike is short, scoped, and
ends with a written findings section that gets actioned into a principle,
a feature PRD, or a backlog task.

When a spike's findings have been actioned, the file moves to
[`archive/`](archive/) — preserving the investigation as a record of how
the resolved-then question was answered.

## Active and recent spikes

| Spike | Status | Description |
|-------|--------|-------------|
| [file-size-estimation-accuracy](file-size-estimation-accuracy.md) | proposed | Measure how accurate current file-size estimation is for transcoded outputs, and prototype tuning approaches. Gates capacity-fit reliability. |

## Status values for spikes

| Status        | Meaning |
|---------------|---------|
| `proposed`    | Spike identified but not started. |
| `in-progress` | Spike work happening. |
| `complete`    | Findings written up; awaiting actioning. |
| `actioned`    | Findings have been turned into PRDs/tasks/principles; ready to archive. |

## Adding a spike

1. Create a file under `spikes/` with a descriptive slug.
2. Frontmatter `status: proposed`.
3. Sections: **Question** (what we're trying to learn), **Why this matters**
   (the downstream decision it unblocks), **Approach** (what we'll do),
   **Time-box** (an explicit ceiling — spikes that grow into projects
   should be re-scoped), **Findings** (filled in as work happens),
   **Actions** (what gets created from the findings).
4. Add to the index above.
5. Cross-reference from any open question or feature that depends on it.

## Archiving a spike

1. Ensure the spike has a "Findings" section and an "Actions" section.
2. Confirm the actions have been taken (PRDs created, principles updated,
   tasks filed).
3. Set status to `actioned` (and optionally `archived` once moved).
4. Move the file to `archive/`.
5. Update this index.

## Difference from a backlog task

- A spike answers a *question*, not a feature. The output is a written
  finding.
- A backlog task is *work to do*; spikes inform what work to do.
- Spikes should usually have a short time-box (hours to a day or two).
  Anything longer is probably a real piece of work and belongs in
  backlog with a clear deliverable.

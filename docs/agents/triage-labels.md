# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to
the actual label strings used in this repo's issue tracker (Backlog.md — see
[`issue-tracker.md`](./issue-tracker.md)).

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Applying them in Backlog.md

These are Backlog.md **labels**, set with `task_edit` → `labels`. That field *replaces*
the whole array, so read the task's current labels with `task_view` first and pass the
merged set — otherwise you'll drop existing labels like `feature` or `ux`.

The five roles are orthogonal to Backlog.md **status** (`Draft` / `To Do` /
`In Progress` / `Done`). Triage labels record the *verdict*; status records *where the
work is*. Two pairings are worth being deliberate about:

- `wontfix` — set `status: "Done"` alongside the label, with a `finalSummary` saying why.
- `needs-triage` — belongs on tasks in `Draft` or `To Do`, not on work already started.

Filter the triage queue with `task_list` → `labels: ["needs-triage"]`.

The project's `backlog/config.yml` declares `labels: []`, which is not an allow-list —
Backlog.md labels are free-form, so no registration step is needed before first use.

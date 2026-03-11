---
id: TASK-109
title: Update AGENTS.md with changesets and release workflow guidance
status: To Do
assignee: []
created_date: '2026-03-11 14:18'
labels:
  - dx
  - docs
milestone: Homebrew Distribution
dependencies:
  - TASK-102
  - TASK-104
references:
  - AGENTS.md
  - CLAUDE.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Update AGENTS.md (and any related agent instructions) so that all AI agents working in this repo understand the changesets workflow, release pipeline, and how to correctly contribute changes that will flow through to Homebrew users.

## Context

After changesets and the release pipeline are set up, agents need to know:
- How to create changeset files when making changes
- When a changeset is needed vs. not needed
- How the release flow works (changesets → version PR → merge → release)
- How versioning works (independent packages, dependent bumps)
- How the Homebrew formula gets updated

Without this guidance, agents will make changes without changeset files and the release pipeline won't pick them up.

## Changes to AGENTS.md

### Add a "Release Workflow" section

Cover:

1. **When to add a changeset**: Any user-facing change to a published package (`podkit` CLI, `@podkit/core`, `@podkit/libgpod-node`). Not needed for: test-only changes, doc-only changes, CI changes, dev tooling.

2. **How to add a changeset**:
   ```bash
   bunx changeset
   ```
   - Select affected package(s)
   - Choose bump type (patch/minor/major)
   - Write a summary from the user's perspective (this becomes the changelog entry)

3. **Changeset content guidelines**:
   - Write for end users, not developers
   - Focus on what changed and why, not implementation details
   - Use present tense ("Add", "Fix", "Improve")

4. **Release flow overview**:
   - Changesets accumulate on `main` as PRs are merged
   - A bot PR ("Version Packages") appears and stays updated
   - When ready to release, merge the version PR
   - CI builds binaries, creates GitHub Release, updates Homebrew formula
   - Users get the update via `brew upgrade podkit`

5. **Version bump rules**:
   - `patch`: Bug fixes, minor improvements
   - `minor`: New features, non-breaking changes
   - `major`: Breaking changes (config format, CLI flags, API)
   - When in doubt, use `patch`

### Update "Commands" section

Add the changeset-related scripts to the quick reference:
```bash
bunx changeset          # Create a changeset for your changes
bunx changeset version  # Apply pending changesets (CI does this)
bun run compile         # Build standalone binary locally
```

### Update any relevant workflow guidance

If there are instructions about PRs or commits, note that changesets should be included in the same PR as the code change.

## Notes

- Keep the guidance concise — agents should be able to understand the workflow quickly
- Include examples of good changeset messages
- Make it clear that forgetting a changeset is recoverable (just add one in a follow-up PR)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 AGENTS.md has a 'Release Workflow' section explaining changesets, versioning, and the release pipeline
- [ ] #2 When-to-add-changeset guidance distinguishes user-facing changes from internal changes
- [ ] #3 How-to-add-changeset instructions include the command and content guidelines
- [ ] #4 Release flow is documented end-to-end (changeset → version PR → release → Homebrew update)
- [ ] #5 Version bump rules (patch/minor/major) are documented with examples
- [ ] #6 Commands section includes changeset and compile scripts
- [ ] #7 An agent reading AGENTS.md for the first time can correctly add a changeset without additional context
<!-- AC:END -->

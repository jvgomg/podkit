---
id: TASK-194
title: Config migration for `fileMode` — onboarding and discoverability
status: To Do
assignee: []
created_date: '2026-03-23 12:03'
labels:
  - config
  - ux
  - onboarding
dependencies:
  - TASK-189
references:
  - packages/podkit-cli/src/commands/init.ts
  - packages/podkit-cli/src/config/loader.ts
  - agents/config-migrations.md
  - docs/user-guide/configuration.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `fileMode` option was added as a new optional config field with a sensible default (`optimized`). No config migration is strictly required — existing configs work without it. However, users won't know about the option unless they read changelogs or docs.

**Goal:** Help existing and new users discover and configure `fileMode` without making it a breaking change. This is about discoverability and onboarding, not backwards compatibility.

**Questions to resolve (HITL):**

1. **Config init (`podkit init`)** — Should `fileMode` be included in the generated config template? If so, should it be commented out (showing the default) or active? The current init generates a minimal config; adding every option risks overwhelming new users.

2. **Onboarding wizard concept** — Should `podkit init` evolve into a guided wizard that asks users about their use case and configures options accordingly? For example: "Will you use these files on other devices besides your iPod?" → yes → `fileMode = "portable"`. This is a bigger design question that goes beyond `fileMode` but this feature is a good forcing function.

3. **Upgrade nudge** — When a user upgrades podkit and runs sync, should there be a one-time tip or notice about new config options? Something like "New in vX.Y: fileMode option lets you control embedded artwork in transcoded files. See docs." This could be a general mechanism for surfacing new features.

4. **Documentation path** — Is the current approach (docs + changelog + tip when mismatch detected) sufficient for discoverability, or do we need more?

**Context:** The `fileMode` default (`optimized`) matches the pre-feature behavior (artwork was accidentally stripped via the `-vn` bug). So existing users see no change. But users who WANT portable files with artwork won't know the option exists unless we surface it.

This task is intentionally open-ended — the output should be a decision on the right approach for `fileMode` specifically, plus any broader onboarding/wizard design direction that emerges.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decision on whether/how to surface fileMode in `podkit init`
- [ ] #2 Decision on onboarding wizard direction (scope beyond just fileMode)
- [ ] #3 Decision on upgrade nudge mechanism for new config options
- [ ] #4 Implementation of chosen approach for fileMode discoverability
<!-- AC:END -->

---
id: TASK-099
title: Add changelog / release notes section
status: To Do
assignee: []
created_date: '2026-03-10 10:31'
updated_date: '2026-03-11 14:26'
labels:
  - docs-site
  - documentation
milestone: Documentation Website v2
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a changelog or release notes section to the documentation site.

## Scope

1. **Decide format** - Single CHANGELOG.md or per-release pages
2. **Configure rendering** - Integrate changelog into Starlight navigation
3. **Establish workflow** - How releases update the changelog

## Considerations

- Could pull from existing CHANGELOG.md if one exists
- May want to use conventional commits to auto-generate
- Consider RSS feed for release notifications
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Changelog section exists in docs
- [ ] #2 Accessible from navigation
- [ ] #3 Process documented for updating
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Superseded by TASK-108 (Update docs site with Homebrew installation guide), which includes a changelog/releases page as acceptance criterion #7.
<!-- SECTION:NOTES:END -->

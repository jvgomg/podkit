---
id: TASK-097
title: Add link checking and docs CI validation
status: Done
assignee: []
created_date: '2026-03-10 10:31'
updated_date: '2026-03-11 23:12'
labels:
  - docs-site
  - ci-cd
milestone: Documentation Website v2
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add automated checks to validate documentation quality in CI.

## Scope

1. **Link checking** - Verify no broken internal or external links
2. **Build verification** - Ensure docs build succeeds on PRs
3. **PR previews** (optional) - Consider preview deployments for doc changes

## Tools to consider

- `lychee` for link checking
- Astro's built-in build validation
- GitHub Actions workflow additions
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Broken link detection in CI
- [x] #2 Docs build verified on PRs
- [x] #3 Clear error reporting for failures
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `starlight-links-validator@0.19.2` as a Starlight plugin that validates internal links at build time. Broken links now fail the build locally and in CI — no separate workflow needed.

**Changes:**
- Added `starlight-links-validator` to `packages/docs-site` (v0.19.2, compatible with Astro 5/Starlight 0.33)
- Configured with `exclude: ['/podkit/**']` to handle the `remarkBaseUrl` plugin conflict (the remark plugin rewrites `/foo` → `/podkit/foo` for runtime, but the validator can't resolve base-prefixed paths against page slugs)
- Fixed broken `#environment-variables` hash anchor in `docs/reference/config-file.md` → linked to `/reference/environment-variables` page
- Fixed broken `/troubleshooting/` link in `docs/feedback.md` → pointed to `/troubleshooting/common-issues`
- Converted all relative links (`./foo`) in `docs/user-guide/devices/` to absolute paths (`/user-guide/devices/foo`) across 6 files

**Limitation:** Links rewritten by `remarkBaseUrl` are excluded from validation since the validator operates on post-remark output and can't resolve the `/podkit/` base prefix. Same-page hash anchors and non-prefixed links are still validated. When the project upgrades to Astro 6 (which may handle base paths natively), the remark plugin and this exclusion can potentially be removed.
<!-- SECTION:FINAL_SUMMARY:END -->

# Release Workflow

Guidance for creating changesets, version bumps, and release PRs. See [AGENTS.md](../AGENTS.md) for project overview.

This project uses [changesets](https://github.com/changesets/changesets) for versioning and changelog generation.

## When to Add a Changeset

**Required** for any user-facing change to a published package:
- `podkit` (CLI)
- `@podkit/core`
- `@podkit/libgpod-node`

**Not required** for:
- Test-only changes
- Documentation-only changes
- CI/CD changes, dev tooling
- Changes to private packages (`@podkit/gpod-testing`, `@podkit/e2e-tests`, `@podkit/demo`, `@podkit/docs-site`)

## How to Add a Changeset

```bash
bunx changeset
```

1. Select affected package(s)
2. Choose bump type (`patch` / `minor` / `major`)
3. Write a summary from the user's perspective (this becomes the changelog entry)
4. Commit the generated `.changeset/*.md` file in the same PR as the code change

## Changeset Content Guidelines

- Write for end users, not developers
- Focus on what changed and why, not implementation details
- Use present tense ("Add", "Fix", "Improve")
- Good examples:
  - "Add support for syncing video files to iPod"
  - "Fix artwork not transferring for FLAC files"
  - "Improve transcoding performance for large collections"

## Version Bump Rules

- **patch**: Bug fixes, minor improvements
- **minor**: New features, non-breaking changes
- **major**: Breaking changes (config format, CLI flags, API)
- When in doubt, use `patch`
- Forgetting a changeset is recoverable — add one in a follow-up PR

## Release Flow

1. Changesets accumulate on `main` as PRs are merged
2. A bot PR ("Version Packages") is created/updated automatically
3. When ready to release, merge the version PR
4. CI builds binaries for 4 platforms and creates a GitHub Release with tarballs (`.github/workflows/release.yml`)
5. Docker image is built for linux/amd64 and linux/arm64 and pushed to GHCR (`.github/workflows/docker.yml`)
6. Homebrew formula is auto-updated with new version and checksums
7. Users get the update via `brew upgrade podkit` or `docker pull ghcr.io/jvgomg/podkit:latest`

## Docs Site Deployment

The docs site (`packages/docs-site`, published to https://jvgomg.github.io/podkit) deploys from a dedicated `docs-live` branch — **not** from `main`. This decouples docs publishing from code merges so unreleased work on `main` cannot accidentally appear on the public site.

### How it works

- `deploy-docs.yml` triggers on push to `docs-live` (or manually via `workflow_dispatch`).
- `docs-live` is updated automatically by `release.yml`'s `sync-docs-live` job at the end of every successful release. The job force-pushes `docs-live` to the release commit.
- Force-with-lease is safe because any commits on `docs-live` (from docs-only cherry-picks) must already exist on `main` — they originated there.
- `verify-release.yml` and `pr-checks.yml` both run a docs build to catch breakage before it reaches `docs-live`.

### Normal flow (release-coupled docs)

You don't need to do anything — when the Version Packages PR merges and `release.yml` runs, `docs-live` is updated automatically and the docs site deploys with the release.

### Docs-only deploy (between releases)

When you want to publish a docs-only change without releasing the rest of `main`:

1. Make the docs change as a normal PR against `main` (so it lives in canonical history and gets reviewed)
2. After it merges, cherry-pick the merge commit onto `docs-live`:
   ```bash
   git checkout docs-live && git pull
   git cherry-pick <commit-sha-from-main>
   git push origin docs-live
   ```
3. The push triggers `deploy-docs.yml` and the docs site updates with **only** the cherry-picked change — unreleased work on `main` stays unpublished.

Only cherry-pick from `main`. Never commit directly to `docs-live` — keeping `main` as the single source of truth is what makes the force-push at release time safe.

### Manual / emergency deploy

Trigger `deploy-docs.yml` from the GitHub Actions UI via `Run workflow`. This deploys whatever is currently on `docs-live`.

### GitHub Pages environment

The `github-pages` environment in repo settings restricts which branches can deploy. It must allow `docs-live` (not `main`). If a deploy fails with a permissions error, check Settings → Environments → github-pages → Deployment branches.

## Reviewing and Improving a Release PR

Before merging a Version Packages PR, add a hand-written release summary above the auto-generated changelog. This makes the release accessible to users who follow the project. The audience is primarily CLI end users, but they're also interested in the technical side of how the tool is built.

**Workflow:**

1. **Read all pending changesets** in `.changeset/*.md` and the current PR body (`gh pr view`)
2. **Group changes by theme** — identify major features, breaking changes, performance/UX improvements, and bug fixes
3. **Draft a release summary** to prepend above the auto-generated changelog:
   - **Intro paragraph** — friendly, acknowledges the size and nature of the release. If there are breaking changes and the project is pre-v1, note that explicitly
   - **Highlights** — major features with 1-2 sentence descriptions and inline links to the published docs site (`https://jvgomg.github.io/podkit/...`)
   - **Breaking Changes** — each breaking item called out clearly with before/after code examples and migration steps
   - **Under the Hood** — technical engineering wins told in an engaging, light-hearted way. Communicate the value to users (e.g., "the 'high' preset was quietly producing ~44 kbps instead of ~256 kbps" rather than dry technical details). Bugs that were tricky or surprising make for good storytelling here
   - **Quality of Life** — smaller UX fixes in a bullet list
   - Wrap the existing auto-generated changelog in a `<details>` block at the bottom
4. **Check for doc gaps** — if new features don't have dedicated doc pages, create them before the release. New docs should be linked from the release summary
5. **Update the PR body** via `gh pr edit`
6. **Review feature discussions** — cross-reference the release contents against open GitHub Discussions (see [agents/feature-requests.md](feature-requests.md) for the registry). For any feature that shipped in this release:
   - Apply the `released` label to the discussion
   - Update the Status section in the discussion body to say **Released** with a link to the relevant docs
   - Post a comment summarizing what shipped and linking to the docs page
   - Discuss with the user before closing discussions — some may prefer to keep them open for follow-up feedback

**Tone guidelines:**
- Conversational and enthusiastic but not over-the-top
- Focus on what changes mean for the user's experience, not just what was implemented
- For bug fixes, be light-hearted about tricky issues and communicate the user-facing impact
- Include links to relevant docs pages so users can learn more

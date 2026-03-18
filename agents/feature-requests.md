# Feature Requests: Agent Guide

This document covers how podkit manages feature requests across GitHub Discussions, documentation, and the backlog. Follow these instructions when creating, updating, or closing feature requests.

## Overview

Feature requests live in three places that must stay in sync:

| Location | Purpose | Audience |
|----------|---------|----------|
| **GitHub Discussions** (Ideas category) | Public voting, comments, and status updates | Users and contributors |
| **Documentation** (`docs/roadmap.md`, callouts in other docs) | Communicates what's planned and links to discussions | Users reading the docs |
| **Backlog tasks** (Backlog.md) | Internal tracking, implementation plans, acceptance criteria | Developers |

The GitHub Discussion is the **source of truth** for public-facing feature status. The roadmap doc page and the pinned Roadmap discussion (#17) are derived views. The backlog task tracks implementation details.

## GitHub Discussions

### Repository setup

- **Discussions are enabled** on `jvgomg/podkit`
- **Ideas** category is used for feature requests (supports upvoting)
- **Announcements** category contains the pinned [Roadmap discussion (#17)](https://github.com/jvgomg/podkit/discussions/17)

### Creating a new feature discussion

Use the GitHub GraphQL API via the `gh` CLI. Shell escaping of the body is tricky — use a Python helper:

```python
import subprocess, json

REPO_ID = "R_kgDORjcW4Q"
IDEAS_CAT = "DIC_kwDORjcW4c4C4Hnu"  # Ideas category
ANNOUNCE_CAT = "DIC_kwDORjcW4c4C4Hnr"  # Announcements category
QUERY = "mutation($input: CreateDiscussionInput!) { createDiscussion(input: $input) { discussion { number url } } }"

def create_discussion(title, body, category_id=IDEAS_CAT):
    payload = json.dumps({
        "query": QUERY,
        "variables": {"input": {
            "repositoryId": REPO_ID,
            "categoryId": category_id,
            "title": title,
            "body": body
        }}
    })
    result = subprocess.run(
        ["gh", "api", "graphql", "--input", "-", "--jq",
         '.data.createDiscussion.discussion | "\\(.number) \\(.url)"'],
        input=payload, capture_output=True, text=True
    )
    return result.stdout.strip()  # "42 https://github.com/jvgomg/podkit/discussions/42"
```

### Discussion body template

Use this structure for consistency:

```markdown
## Feature Request

{1-2 sentence summary}

### Description

{Detailed description of the feature}

### Use Cases

- {Use case 1}
- {Use case 2}
- {Use case 3}

### Status

**{Next|Later}** — {brief status note}. Vote and comment to help us prioritise.
```

### Updating discussion status

When a feature moves between roadmap tiers or begins implementation, update the **Status** section at the bottom of the discussion body. Use the GraphQL `updateDiscussion` mutation:

```python
UPDATE_QUERY = "mutation($input: UpdateDiscussionInput!) { updateDiscussion(input: $input) { discussion { url } } }"

def update_discussion(discussion_id, body):
    """discussion_id is the node ID (e.g. D_kwDO...), not the number."""
    payload = json.dumps({
        "query": UPDATE_QUERY,
        "variables": {"input": {"discussionId": discussion_id, "body": body}}
    })
    subprocess.run(["gh", "api", "graphql", "--input", "-"], input=payload, text=True)
```

To get a discussion's node ID from its number:

```bash
gh api graphql -f query='{ repository(owner: "jvgomg", name: "podkit") { discussion(number: 42) { id body } } }'
```

### Adding a comment to a discussion

Use comments to post implementation updates or status changes:

```bash
gh api graphql -f query='
  mutation {
    addDiscussionComment(input: {
      discussionId: "D_kwDO...",
      body: "This feature is now in progress. Tracking in TASK-XXX."
    }) { comment { url } }
  }'
```

### Closing a discussion

When a feature ships, close the discussion and add a comment linking to the release:

```bash
gh api graphql -f query='
  mutation {
    closeDiscussion(input: {
      discussionId: "D_kwDO...",
      reason: RESOLVED
    }) { discussion { url } }
  }'
```

## Current Discussions Registry

Keep this table updated when creating or closing discussions.

| # | Feature | Category | Roadmap Tier |
|---|---------|----------|-------------|
| 2 | Podcast sync support | Content Types | Later |
| 3 | Audiobook sync support | Content Types | Later |
| 4 | Music video sync support | Content Types | Later |
| 5 | Video podcast sync support | Content Types | Later |
| 6 | Plex media source | Collection Sources | Later |
| 7 | Jellyfin media source | Collection Sources | Later |
| 8 | Windows support | Platform Support | Later |
| 9 | Linux mount and eject commands | Platform Support | Later |
| 10 | Device formatting command | Device Management | Later |
| 11 | Keychain and secret manager integration | Security | Later |
| 12 | Docker distribution | Distribution | Shipped |
| 13 | TUI (Terminal UI) experience | Interfaces | Later |
| 14 | Desktop app (GUI) | Interfaces | Later |
| 15 | Daemon mode: auto-sync on device plug-in | Daemon & Automation | Next |
| 16 | Sync selection and filtering | Sync | Next |
| 17 | Roadmap (pinned, Announcements) | Meta | — |
| 22 | Beta Testers Wanted (Announcements) | Meta | — |
| 19 | Homebrew distribution | Distribution | Next |
| 20 | npm distribution | Distribution | Next |
| 21 | Configuration wizard | Onboarding | Later |
| 23 | Playlist sync | Library Sync | Later |
| 24 | Star rating sync | Library Sync | Later |
| 25 | Play count and scrobble sync | Library Sync | Later |
| 32 | Sound Check (volume normalization) support | Library Sync | Later |
| 34 | Rockbox and non-iTunesDB device support | Device Support | Later |
| 35 | iTunes / Apple Music library source | Collection Sources | Later |

## Documentation

### Files that reference feature discussions

These files contain callouts or links to specific discussions. When a feature's status changes (e.g., moves to "Next", starts implementation, or ships), check and update the relevant docs.

| Doc File | Features Referenced | What to Update |
|----------|-------------------|----------------|
| `docs/roadmap.md` | All features | Move between Now/Next/Later tiers |
| `docs/feedback.md` | General guidance | Rarely changes |
| `docs/user-guide/syncing/music.md` | #2 Podcasts, #3 Audiobooks, #4 Music Videos | Callout at line ~50 |
| `docs/user-guide/syncing/video.md` | #4 Music Videos, #5 Video Podcasts | Callout at line ~42 |
| `docs/user-guide/collections/additional-sources.md` | #35 iTunes/Apple Music, #6 Plex, #7 Jellyfin | Inline links + "Request a Source" section |
| `docs/user-guide/collections/subsonic.md` | #11 Keychain/secret manager | Callout at line ~50 |
| `docs/user-guide/devices/mounting-ejecting.md` | #9 Linux mount/eject | Callout at line ~61 |
| `docs/user-guide/devices/formatting.md` | #10 Device formatting | Caution block at line ~8 |
| `docs/devices/rockbox.md` | #34 Rockbox/non-iTunesDB support | Callout near top of page |
| `docs/devices/other-devices.md` | #34 Rockbox/non-iTunesDB support | Inline link in Rockbox section |
| `docs/getting-started/installation.mdx` | #8 Windows support | Callout at line ~51 |

### Updating the roadmap doc

`docs/roadmap.md` has three tiers: **Now**, **Next**, and **Later**. Each feature is a row in a table with a link to its discussion.

**When moving a feature between tiers:**
1. Move the table row to the correct tier section
2. If moving to **Now**, consider adding a brief note about what's actively happening

**When a feature ships:**
1. Remove it from `docs/roadmap.md`
2. Update or remove the callout in the relevant doc file (e.g., replace the "not yet implemented" callout with actual documentation for the feature)
3. Close the GitHub Discussion with a comment linking to the release or relevant docs

### Updating the pinned Roadmap discussion

Discussion [#17](https://github.com/jvgomg/podkit/discussions/17) mirrors `docs/roadmap.md` in a more concise format. When the roadmap doc changes, update this discussion to match.

### Adding callouts for new features

When a new planned feature relates to existing documentation, add a Starlight callout linking to the discussion:

```markdown
:::note[Want {feature name}?]
This feature is on the [roadmap](/roadmap/). Vote and comment on the [discussion](https://github.com/jvgomg/podkit/discussions/N) to help us prioritise.
:::
```

Place callouts near the relevant content (e.g., a "not yet supported" content type table, a platform support section).

### Removing callouts when features ship

When a feature is implemented:
1. Remove the `:::note` callout
2. Replace it with actual documentation for the feature
3. Update any "Not yet" entries in tables to "Yes" with appropriate notes

## Backlog Integration

### Linking tasks to discussions

When a backlog task implements a feature that has a discussion, add the discussion URL as a reference:

```
mcp__backlog__task_edit(id: "TASK-XXX", addReferences: ["https://github.com/jvgomg/podkit/discussions/N"])
```

### When to create a backlog task

Not every discussion needs a backlog task immediately. Create a task when:
- The feature moves to **Next** or **Now** on the roadmap
- Active implementation planning begins
- The user explicitly asks for a task to be created

Features in **Later** generally don't need backlog tasks — the discussion is sufficient for tracking interest.

### Workflow: feature moves from Later to Next

1. Update `docs/roadmap.md` — move the row to the **Next** section
2. Update Discussion #17 (Roadmap) — move the entry
3. Update the individual discussion's Status section to say **Next**
4. Create a backlog task if one doesn't exist, with the discussion URL as a reference
5. Post a comment on the discussion noting it's been moved to Next

### Workflow: feature moves from Next to Now (active development)

1. Update `docs/roadmap.md` — move the row to the **Now** section
2. Update Discussion #17 (Roadmap)
3. Update the individual discussion's Status section to say **Now — actively in development**
4. Ensure a backlog task exists with status "In Progress"
5. Post a comment on the discussion noting active development has begun

### Workflow: feature ships

1. Remove from `docs/roadmap.md`
2. Update Discussion #17 (Roadmap) — remove the entry
3. Close the discussion with reason RESOLVED and a comment linking to the release/docs
4. Update doc callouts — replace "not yet" notes with actual feature documentation
5. Mark the backlog task as Done
6. Update the discussions registry table in this file

## Sidebar Configuration

The roadmap and feedback pages are in the Astro sidebar config at `packages/docs-site/astro.config.mjs`:

```javascript
{
  label: 'Roadmap & Feedback',
  items: [
    { slug: 'roadmap' },
    { slug: 'feedback' },
  ],
},
```

## Common Scenarios

### User asks to add a new feature request

1. Create a GitHub Discussion in the Ideas category using the template above
2. Determine the roadmap tier (Next or Later) based on user input
3. Add a row to the appropriate tier in `docs/roadmap.md`
4. Update Discussion #17 (Roadmap)
5. Add the discussion to the registry table in this file
6. If the feature relates to existing docs, add a callout linking to the discussion
7. If the feature is in Next or Now, create a backlog task

### User asks to update a feature's priority/tier

1. Move the row in `docs/roadmap.md`
2. Update Discussion #17
3. Update the individual discussion's Status section
4. Update the registry table in this file
5. If moving to Next/Now, ensure a backlog task exists
6. Post a comment on the discussion about the status change

### User asks to close/remove a feature request

1. Close the discussion with reason RESOLVED or OUTDATED
2. Remove from `docs/roadmap.md`
3. Update Discussion #17
4. Remove any related callouts from docs
5. Update the registry table in this file
6. If a backlog task exists, update or archive it

### User asks about the status of feature requests

1. Check this file's registry table for a quick overview
2. Check the discussion for vote counts and community feedback
3. Check the backlog task (if one exists) for implementation details

---
id: TASK-106
title: Create homebrew-podkit tap repository with formula
status: To Do
assignee: []
created_date: '2026-03-11 14:17'
updated_date: '2026-03-11 14:21'
labels:
  - packaging
  - homebrew
milestone: Homebrew Distribution
dependencies:
  - TASK-104
references:
  - packages/podkit-cli/package.json
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Create the `jvgomg/homebrew-podkit` GitHub repository containing a Homebrew formula that installs the podkit CLI from GitHub Release tarballs. Users will install with `brew install jvgomg/podkit/podkit`.

## Context

The release workflow (TASK-104) publishes platform-specific tarballs to GitHub Releases. The Homebrew formula downloads the correct tarball for the user's platform and installs the binary.

## Implementation

### 1. Create the repository

Create `jvgomg/homebrew-podkit` on GitHub with:
- `Formula/podkit.rb` — the Homebrew formula
- `README.md` — brief install instructions
- A permissive license (MIT or similar)

### 2. Write the formula

```ruby
class Podkit < Formula
  desc "Sync music collections to iPod devices"
  homepage "https://github.com/jvgomg/podkit"
  version "0.1.0"  # Updated by CI
  license "MIT"    # Match project license

  depends_on "ffmpeg"

  on_macos do
    on_arm do
      url "https://github.com/jvgomg/podkit/releases/download/podkit@#{version}/podkit-darwin-arm64.tar.gz"
      sha256 "..."
    end
    on_intel do
      url "https://github.com/jvgomg/podkit/releases/download/podkit@#{version}/podkit-darwin-x64.tar.gz"
      sha256 "..."
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/jvgomg/podkit/releases/download/podkit@#{version}/podkit-linux-arm64.tar.gz"
      sha256 "..."
    end
    on_intel do
      url "https://github.com/jvgomg/podkit/releases/download/podkit@#{version}/podkit-linux-x64.tar.gz"
      sha256 "..."
    end
  end

  def install
    bin.install "podkit"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/podkit --version")
  end
end
```

### 3. Test locally

- `brew install --build-from-source ./Formula/podkit.rb` (or `brew install --verbose`)
- Verify `podkit --version` works
- Verify `brew test podkit` passes
- Test on both macOS (if available) and Linux (Docker or VM)

### 4. Configure repository for CI updates

- Add a GitHub Actions workflow or deployment key that allows the main podkit release workflow to push formula updates (version, URL, SHA256)
- Options: deploy key with write access, or a GitHub App token, or a PAT stored as a secret in the main repo

## Notes

- Formula URL pattern must match the GitHub Release tag format from TASK-104 (`podkit@{version}`)
- The `test` block is important — Homebrew CI runs it on formula updates
- Consider adding a `caveats` block if there are post-install notes (e.g., FFmpeg configuration)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `jvgomg/homebrew-podkit` repository exists on GitHub with `Formula/podkit.rb`
- [ ] #2 Formula correctly selects platform-specific tarball based on OS and architecture
- [ ] #3 Formula declares `depends_on 'ffmpeg'`
- [ ] #4 `brew tap jvgomg/podkit && brew install podkit` installs the binary and `podkit --version` works
- [ ] #5 Shorthand `brew install jvgomg/podkit/podkit` also works (auto-taps)
- [ ] #6 `brew test podkit` passes (version string check)
- [ ] #7 Repository has authentication mechanism (deploy key, token, or similar) for automated formula updates from the main repo's CI
- [ ] #8 README.md documents both install forms (tap+install and shorthand)
<!-- AC:END -->

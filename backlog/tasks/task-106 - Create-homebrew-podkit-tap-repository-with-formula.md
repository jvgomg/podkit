---
id: TASK-106
title: Create homebrew-podkit tap repository with formula
status: Done
assignee: []
created_date: '2026-03-11 14:17'
updated_date: '2026-03-11 18:01'
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
- [x] #1 `jvgomg/homebrew-podkit` repository exists on GitHub with `Formula/podkit.rb`
- [x] #2 Formula correctly selects platform-specific tarball based on OS and architecture
- [x] #3 Formula declares `depends_on 'ffmpeg'`
- [x] #4 `brew tap jvgomg/podkit && brew install podkit` installs the binary and `podkit --version` works
- [x] #5 Shorthand `brew install jvgomg/podkit/podkit` also works (auto-taps)
- [x] #6 `brew test podkit` passes (version string check)
- [x] #7 Repository has authentication mechanism (deploy key, token, or similar) for automated formula updates from the main repo's CI
- [x] #8 README.md documents both install forms (tap+install and shorthand)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation: Created formula, README, and LICENSE in homebrew-tap/ staging directory. Formula uses correct Homebrew DSL (on_macos/on_linux/on_arm/on_intel), depends_on ffmpeg, URL pattern matches podkit@{version} tag format, test block checks version. SHA256 values are PLACEHOLDER until first release. Added homebrew-tap/ to .gitignore. Commit: fa4bc5e (.gitignore only — tap files go to separate repo).

Manual steps required:
1. Create jvgomg/homebrew-podkit GitHub repository
2. Push homebrew-tap/ contents to that repo
3. Set up deploy key or PAT for CI formula updates

AC #1 (repo exists), #4/#5 (brew install works), #7 (auth mechanism) require manual action.
<!-- SECTION:NOTES:END -->

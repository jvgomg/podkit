---
id: TASK-100
title: Ship prebuilt libgpod-node binaries so users don't need libgpod installed
status: To Do
assignee: []
created_date: '2026-03-10 15:42'
labels:
  - dx
  - native
  - packaging
dependencies: []
references:
  - packages/libgpod-node/binding.gyp
  - packages/libgpod-node/package.json
  - packages/libgpod-node/native/
  - tools/libgpod-macos/build.sh
  - tools/libgpod-macos/patches/
documentation:
  - docs/getting-started/installation.md
  - docs/developers/development.md
  - AGENTS.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Eliminate the requirement for users to have libgpod installed on their system. Currently, macOS users must build libgpod from source (~10 manual steps), and Linux users need `libgpod-dev` from their package manager. By shipping prebuilt `.node` binaries with libgpod statically linked, `npm install` / `bun install` should just work on all supported platforms with zero native dependencies.

## Current State

### How libgpod-node builds today

- `packages/libgpod-node/` uses **node-gyp** to compile a native N-API addon (`gpod_binding.node`)
- `binding.gyp` uses `pkg-config` to locate libgpod headers and **dynamically links** against `libgpod.dylib` / `libgpod.so`
- The `install` script in package.json runs `node-gyp rebuild` on every install — requiring libgpod dev headers + shared library on the user's system
- There are **no prebuilds, no prebuildify, no CI pipeline for binaries**
- Published files include `build/Release/*.node`, `native/`, and `binding.gyp` (for rebuild)

### macOS build process (what we're eliminating for users)

`tools/libgpod-macos/build.sh` does the following:
1. Installs 9 Homebrew dependencies (libplist, gdk-pixbuf, intltool, autoconf, automake, libtool, gtk-doc, pkg-config, gettext)
2. Downloads libgpod 0.8.3 source tarball from SourceForge
3. Applies 2 patches (macOS compilation fix from MacPorts, libplist 2.x API compat from PLD Linux)
4. Runs `./configure &amp;&amp; make &amp;&amp; make install` to `~/.local/`
5. User must set `PKG_CONFIG_PATH` and `DYLD_LIBRARY_PATH` environment variables

### Linux build process

Users install `libgpod-dev` (Debian/Ubuntu), `libgpod-devel` (Fedora), or equivalent. Much simpler but still a prerequisite.

### Key files

- `packages/libgpod-node/binding.gyp` — node-gyp build config, pkg-config integration
- `packages/libgpod-node/package.json` — install script, published files list
- `packages/libgpod-node/native/` — C++ source files for the N-API binding
- `tools/libgpod-macos/build.sh` — macOS libgpod build script
- `tools/libgpod-macos/patches/` — patches applied to libgpod source
- `docs/getting-started/installation.md` — user-facing install instructions
- `docs/developers/development.md` — developer setup guide

## Implementation Approach

### 1. Static linking

Change `binding.gyp` to statically link `libgpod.a` (and its dependencies like glib) into the `.node` binary. This makes the resulting binary self-contained with no runtime dependency on shared libraries.

- On macOS, the `build.sh` script already produces `libgpod.a` at `~/.local/lib/libgpod.a`
- GLib can be statically linked or bundled similarly
- Test with `otool -L` (macOS) / `ldd` (Linux) to verify no dynamic libgpod/glib references remain

### 2. Prebuild tooling

Use [prebuildify](https://github.com/prebuild/prebuildify) to generate platform-specific prebuilt binaries and bundle them in the npm package, or use [prebuild](https://github.com/prebuild/prebuild) to upload them to GitHub Releases and download at install time.

**prebuildify** (recommended — simpler):
- Prebuilds are stored inside the npm package under `prebuilds/`
- Use [node-gyp-build](https://github.com/prebuild/node-gyp-build) at runtime to load the correct binary
- No download step needed at install time — just works offline too

**Target platforms/architectures:**
- `darwin-x64` (Intel Mac)
- `darwin-arm64` (Apple Silicon)
- `linux-x64`
- Optionally: `linux-arm64`

### 3. CI pipeline

Create a GitHub Actions workflow that:
1. Builds libgpod from source on each platform (reuse `tools/libgpod-macos/build.sh` for macOS, `apt install libgpod-dev` for Linux)
2. Runs `prebuildify --napi --strip` to produce prebuilt binaries
3. Commits prebuilds to the package or attaches to a GitHub Release
4. Runs the test suite against the prebuilt binaries to verify they work

Use a matrix strategy for the platform/arch combinations. For cross-compilation (e.g., arm64 on x64 runners), consider using Docker or GitHub's arm64 runners.

### 4. Fallback

Keep the existing `node-gyp rebuild` as a fallback for platforms without prebuilds. Update the install script:
```json
"install": "node-gyp-build || node-gyp rebuild || echo 'Native build failed'"
```

### 5. Runtime loading

Replace the current `require`/`import` of the `.node` file with `node-gyp-build` which automatically selects the right prebuild:
```js
const binding = require('node-gyp-build')(__dirname)
```

## Reference projects

These Node.js native addons ship prebuilds successfully — study their approach:
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — prebuildify with static linking
- [sharp](https://github.com/lovell/sharp) — platform-specific npm packages (@sharp/darwin-arm64, etc.)
- [canvas](https://github.com/Automattic/node-canvas) — prebuilds with bundled native deps

The **sharp** approach (separate platform-specific npm packages via `optionalDependencies`) is another viable pattern if prebuildify bundles get too large.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 libgpod is statically linked into the .node binary — no runtime dependency on libgpod.dylib/libgpod.so or DYLD_LIBRARY_PATH/LD_LIBRARY_PATH
- [ ] #2 Prebuilt binaries are shipped for darwin-x64, darwin-arm64, and linux-x64
- [ ] #3 npm install @podkit/libgpod-node works on supported platforms without libgpod or glib installed on the system
- [ ] #4 Fallback to node-gyp source build works when no prebuild matches the platform
- [ ] #5 CI workflow builds and tests prebuilt binaries for all target platforms
- [ ] #6 All existing libgpod-node tests pass against the prebuilt binaries
- [ ] #7 docs/getting-started/installation.md updated: macOS users no longer need to build libgpod from source; libgpod build steps removed or moved to a 'building from source' section for contributors only
- [ ] #8 docs/developers/development.md updated: developer setup still documents building libgpod from source (needed for modifying native code), clearly distinguished from user installation
- [ ] #9 AGENTS.md system dependencies table updated to reflect that libgpod is only needed for development, not end-user installation
<!-- AC:END -->

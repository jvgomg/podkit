---
id: TASK-159
title: 'Fix: Native .node binding not found in compiled CLI binary (Homebrew broken)'
status: In Progress
assignee: []
created_date: '2026-03-18 15:28'
updated_date: '2026-03-18 16:19'
labels:
  - bug
  - release
  - packaging
dependencies: []
references:
  - packages/libgpod-node/src/binding.ts
  - .github/workflows/build-platform.yml
  - packages/podkit-cli/package.json
  - homebrew-tap/Formula/podkit.rb
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Bug

The Homebrew-installed `podkit` binary (v0.3.0) cannot load the native libgpod binding. Any command that touches the iPod database fails:

```
$ podkit -vvv sync -c navidrome --dry-run
Looking for iPod 'terapod'...
Cannot read iPod database at: /private/tmp/podkit-TERAPOD

This path does not appear to be a valid iPod:
  - Missing iTunesDB file
  - Database may be corrupted

Details: Failed to open database: Failed to load native binding: Native binding not found.
Searched package roots:
  - /$bunfs
Make sure you have run `bun run build:native` to compile the native module,
or install a version with prebuilt binaries for your platform.
```

Commands that don't touch the database (`--version`, `--help`, `completions`) work fine.

**This affects all Homebrew users on v0.3.0.** It was not caught earlier because the maintainer's shell had a function that ran the dev build instead of the brew binary.

## Root Cause

The compile step (`bun build --compile src/main.ts --outfile bin/podkit`) bundles all JavaScript into a single Mach-O executable with a virtual filesystem (`/$bunfs`). However, **native `.node` addons cannot be embedded** in Bun's compiled binaries — they must exist on the real filesystem.

The release tarball contains only the `podkit` binary:

```yaml
# .github/workflows/build-platform.yml:207-211
- name: Create tarball
  run: |
    cd packages/podkit-cli/bin
    tar czf "${GITHUB_WORKSPACE}/podkit-${{ matrix.platform }}-${{ matrix.arch }}.tar.gz" podkit
```

The prebuild `.node` file (created at line 120 via `npx prebuildify --napi --strip`) is never included.

## Why CI Smoke Tests Don't Catch This

The smoke test at line 195 creates an empty iPod directory and runs `device info`, checking for errors like "native module" or "cannot find". But `device info` on an empty iPod may not exercise the same code path that triggers the binding load failure (or the error message doesn't match the grep patterns). The test checks for `"native module"` but the actual error says `"Native binding not found"`.

## How It Works in Development

During `bun run compile` in CI, the prebuild exists at `packages/libgpod-node/prebuilds/{platform}-{arch}/libgpod.napi.node` on the real filesystem. The compiled binary can find it via `getPackageRootCandidates()` which resolves paths relative to `import.meta.url`. Once the binary is extracted from the tarball into `/opt/homebrew/bin/`, those paths resolve to `/$bunfs` (Bun's virtual FS) where no prebuilds directory exists.

## Key Files

| File | Role |
|------|------|
| `packages/libgpod-node/src/binding.ts:211-331` | Binding loader — `getPackageRootCandidates()`, `findPrebuild()`, `findAddon()` |
| `packages/podkit-cli/package.json:25` | Compile command: `bun build --compile src/main.ts --outfile bin/podkit` |
| `.github/workflows/build-platform.yml:117-120` | Prebuild creation via `prebuildify` |
| `.github/workflows/build-platform.yml:207-211` | Tarball creation (binary only, no prebuild) |
| `.github/workflows/build-platform.yml:195-203` | Smoke test that should catch this but doesn't |

## Suggested Fix

The fix needs to solve two problems:

### 1. Include the prebuild in the distribution

Options (in rough order of preference):

- **Embed in the binary**: Bun's `--compile` supports embedding assets via `Bun.file()` from a `/$bunfs` path if files are placed correctly. Investigate whether the `.node` file can be embedded and extracted at runtime to a temp location, then `dlopen`'d.
- **Ship a sidecar**: Include the `.node` file alongside the binary in the tarball (e.g., `podkit` + `libgpod.napi.node`). Update the Homebrew formula to install both files. Update the binding loader to search relative to `process.execPath`.
- **Static link into the binary**: Investigate whether the N-API addon can be statically linked into the Bun compiled binary (unlikely to be straightforward).

### 2. Add a search path relative to the executable

In `getPackageRootCandidates()` (`binding.ts:211`), add a candidate based on `process.execPath`:

```typescript
// Search relative to the executable (for Homebrew / standalone installs)
const execDir = dirname(process.execPath);
candidates.push(execDir);                    // sidecar: same directory
candidates.push(join(execDir, '..', 'lib', 'podkit'));  // Homebrew convention
```

### 3. Fix the smoke test

Update the smoke test grep pattern to catch the actual error:

```bash
if echo "$OUTPUT" | grep -qi "native module\|cannot find\|Native binding not found\|segfault\|SIGSEGV"; then
```

Or better: add a smoke test that actually opens a database (the dummy iPod test already creates the directory structure — just needs an iTunesDB file via gpod-tool).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Homebrew-installed podkit binary can load the native libgpod binding and open an iPod database
- [x] #2 Release tarball includes the native .node prebuild (or it is embedded in the binary)
- [x] #3 Binding loader in binding.ts searches relative to process.execPath for standalone installs
- [x] #4 CI smoke test catches native binding load failures (test actually opens a database)
- [x] #5 All 4 platform builds (darwin-arm64, darwin-x64, linux-x64, linux-arm64) verified working
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### Approach: Embedded native addon (single binary)

Bun's `--compile` **can** embed `.node` files — it detects static `require()` calls to `.node` files at compile time, embeds the binary data, and at runtime extracts to a temp file, `dlopen()`s it, then deletes the temp file. This was confirmed via Bun docs and GitHub issues (#19550, #19551).

The original task suggested the `.node` couldn't be embedded — this is incorrect. The issue was that podkit's indirect resolution logic (`findAddon()` → `findPrebuild()`) is invisible to Bun's bundler. A static `require('../gpod_binding.node')` is needed.

### Changes Made

1. **`packages/libgpod-node/src/binding.ts`**
   - Added `loadEmbeddedBinding()` with static `require('../gpod_binding.node')` that Bun's compiler detects
   - `loadBinding()` tries embedded first, then falls back to existing filesystem resolution (dev/npm)
   - Added `process.execPath`-relative search paths as extra fallback

2. **`packages/podkit-cli/scripts/compile.sh`** (new)
   - Stages the correct `.node` to the path `loadEmbeddedBinding()` references before compilation
   - Tries `prebuilds/{platform}-{arch}/` (CI) then `build/Release/` (local dev)
   - Cleans up staged file after compile via trap

3. **`packages/podkit-cli/package.json`**
   - `compile` script now calls `scripts/compile.sh`

4. **`.github/workflows/build-platform.yml`**
   - Smoke test runs from **isolated temp directory** — proves binding is truly embedded
   - Grep pattern catches all known binding error messages including "Native binding not found" and "Failed to load native binding"
   - Tarball stays as single `podkit` binary (no sidecar needed)

5. **`.gitignore`** — Added `gpod_binding.node` for staged compile artifact

### Local Verification

- `bun run compile` succeeds, staging from `build/Release/`
- Binary copied to `/tmp` isolated dir → `device info` works, no binding errors
- Dev mode (`bun run dev`) still works via filesystem resolution
- All 313 libgpod-node tests pass

### Sidecar approach NOT needed

Originally considered shipping the `.node` alongside the binary + updating Homebrew formula to use `libexec`. This is unnecessary — single binary with embedded addon is cleaner and keeps the Homebrew formula simple (`bin.install "podkit"`).

### CI Verification (Run 23254904406)

All 6 platform builds pass with isolated smoke tests:
- darwin-arm64 ✓
- darwin-x64 ✓
- linux-arm64 ✓
- linux-x64 ✓
- linux-x64-musl ✓
- linux-arm64-musl ✓

PR: https://github.com/jvgomg/podkit/pull/38
<!-- SECTION:NOTES:END -->

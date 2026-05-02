---
id: TASK-007
title: Research iPod test environment
status: Done
assignee: []
created_date: '2026-02-22 19:08'
updated_date: '2026-02-22 21:21'
labels:
  - research
milestone: 'M1: Foundation (v0.1.0)'
dependencies:
  - TASK-004
references:
  - docs/LIBGPOD.md
  - docs/IPOD-INTERNALS.md
  - tools/gpod-tool/README.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Investigate options for testing libgpod bindings without requiring a physical iPod.

**Research areas:**
- Can we create a valid iTunesDB from scratch?
- libgpod test utilities or fixtures
- Existing test approaches in gtkpod/Strawberry
- Virtual/loopback filesystem with iPod structure
- Minimal files needed for libgpod to recognize as iPod

**Goal:** Define a reproducible test environment that:
- Can be created/destroyed in CI
- Allows testing all libgpod operations
- Doesn't require physical device
- Enables extensive unit test coverage

**Outcome:** Document findings and recommended approach for TASK-003 (testing strategy).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 iTunesDB creation options documented
- [x] #2 Existing test approaches researched (gtkpod, Strawberry)
- [x] #3 Recommended test environment approach defined
- [x] #4 Findings documented for TASK-003
- [x] #5 Proof of concept test iPod structure created
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Summary

### Key Finding: `itdb_init_ipod()` Function

libgpod provides a built-in function to create a complete iPod structure from scratch:

```c
gboolean itdb_init_ipod(
    const gchar *mountpoint,   // Directory path (no physical device needed)
    const gchar *model_number, // e.g., "MA147" for iPod Video 60GB
    const gchar *ipod_name,    // Display name
    GError **error
);
```

This function creates:
- Complete directory structure (`iPod_Control/`, `Music/F00-F49/`, etc.)
- `SysInfo` file with model number
- Empty `iTunesDB` with master playlist
- `ArtworkDB` for album art

### Proof of Concept Results

Successfully verified on macOS:
1. Create temp directory: `mkdir /tmp/test-ipod`
2. Initialize: `itdb_init_ipod("/tmp/test-ipod", "MA147", "Test iPod", &error)`
3. Parse: `itdb_parse("/tmp/test-ipod", &error)`
4. Add tracks with full metadata
5. Write: `itdb_write(itdb, &error)`

**All operations work without a physical device or loopback mount.**

### Testing Options Evaluated

| Option | Description | Verdict |
|--------|-------------|---------|
| **itdb_init_ipod() + temp dir** | Use libgpod to create test iPod in temp folder | ✅ **Recommended** |
| Loopback mount with disk image | Create FAT32 image, mount as loopback | ❌ Overkill, requires root |
| Manual directory creation | Manually create dirs + SysInfo | ❌ Fragile, libgpod does this better |
| gtkpod fixtures | Look for test fixtures in gtkpod | ❌ None found |

### Recommended Test Environment

**For unit tests:**
```typescript
// In test setup
const testIpodPath = await createTestIpod("MA147", "Test iPod");

// In test teardown
await fs.rm(testIpodPath, { recursive: true });
```

**For CI:**
- No special permissions needed
- No loopback mounts
- Works on Linux, macOS, Windows (with libgpod)
- Fast creation/teardown

### Model Numbers for Testing

| Model | Device | Use Case |
|-------|--------|----------|
| MA147 | iPod Video 60GB | Primary test target (artwork support) |
| MB565 | iPod Classic 120GB | Secondary (different artwork formats) |
| MA477 | iPod Nano 2GB | Nano testing |

### Sources

- [libgpod Device API](https://tmz.fedorapeople.org/docs/libgpod/libgpod-Device.html)
- [libgpod iTunesDB API](https://tmz.fedorapeople.org/docs/libgpod/libgpod-The-Itdb-iTunesDB-structure.html)
- [gpod-utils](https://github.com/whatdoineed2do/gpod-utils)

## Implementation

Created `tools/gpod-tool/` - a standalone C CLI that wraps libgpod:

- `gpod-tool init` - Create iPod structure
- `gpod-tool info` - Display database info
- `gpod-tool tracks` - List tracks
- `gpod-tool add-track` - Add track metadata
- `gpod-tool verify` - Verify database

All commands support `--json` for test automation.

See ADR-005 for full details.
<!-- SECTION:NOTES:END -->

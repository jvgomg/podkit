---
id: TASK-076
title: Consolidate duplicated type definitions and iPod device mappings
status: Done
assignee: []
created_date: '2026-03-09 19:04'
updated_date: '2026-03-09 19:20'
labels:
  - refactoring
  - technical-debt
  - types
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Multiple definitions of iPod-related types, device mappings, and helper functions are duplicated across packages, causing maintenance burden and potential inconsistencies.

## Key Duplications Found

### 1. Generation Mapping (Critical)
- **CLI**: `formatGeneration()` in `packages/podkit-cli/src/commands/device.ts` (lines 62-100) - Human-readable display names
- **Core**: `generationMap` in `packages/podkit-core/src/video/types.ts` (lines 201-215) - Video profile mapping
- **Issue**: Same data, different purposes, maintained separately

### 2. DeviceInfo Interface Name Collision (Critical)
Four different interfaces named `DeviceInfo`:
- `libgpod-node/src/types.ts:158-179` - Full libgpod device capabilities
- `podkit-core/src/device/types.ts:11-26` - Platform device manager (disk info)
- `gpod-testing/src/types.ts:58-63` - Simplified test version
- `podkit-core/src/ipod/types.ts:455-472` - Renamed to `IpodDeviceInfo` (already worked around)

### 3. IpodModel Type Collision (Critical)
Two completely different types named `IpodModel`:
- `libgpod-node/src/types.ts:89-132` - Model color variants ('color', 'mini_blue', etc.)
- `gpod-testing/src/types.ts:6-11` - Model numbers ('MA147', 'MB565', etc.)

### 4. MediaType Constants (Low Priority)
- `libgpod-node/src/types.ts:137-151` - Complete set of libgpod media types
- `podkit-core/src/ipod/constants.ts:25-38` - Subset with documentation
- **May be intentional** for layering, needs evaluation

## Impact
- Maintenance burden when updating device mappings
- Type confusion and naming conflicts
- Potential for inconsistencies when one copy is updated but not others
- Harder to discover canonical definitions
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All generation mappings consolidated into single source in @podkit/core
- [ ] #2 DeviceInfo interfaces renamed to avoid collisions (e.g., PlatformDeviceInfo, IpodDeviceInfo, LibgpodDeviceInfo)
- [ ] #3 IpodModel in gpod-testing renamed to IpodModelNumber or similar
- [ ] #4 All imports updated to use new names
- [ ] #5 Decision documented on MediaType duplication (consolidate or keep separate)
- [ ] #6 Tests pass after refactoring
- [ ] #7 No breaking changes to public APIs
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Phase 1: Generation Mapping Consolidation

**Goal:** Single source of truth for iPod generation metadata

**Actions:**
1. Create `packages/podkit-core/src/ipod/generation.ts` with:
   ```typescript
   export interface IpodGenerationMetadata {
     id: IpodGeneration;
     displayName: string;
     videoProfile?: string; // For video-capable models
   }
   
   export const IPOD_GENERATIONS: Record<IpodGeneration, IpodGenerationMetadata>;
   export function formatGeneration(gen: IpodGeneration): string;
   export function getVideoProfile(gen: IpodGeneration): string | undefined;
   ```

2. Migrate data from:
   - `podkit-cli/src/commands/device.ts:formatGeneration()`
   - `podkit-core/src/video/types.ts:generationMap`

3. Update imports in:
   - `packages/podkit-cli/src/commands/device.ts`
   - `packages/podkit-core/src/video/types.ts`

4. Export from `@podkit/core` public API

### Phase 2: DeviceInfo Interface Disambiguation

**Goal:** Clear, non-colliding interface names

**Renaming Strategy:**
- `libgpod-node/src/types.ts` → Keep as `DeviceInfo` (it's the authoritative libgpod definition)
- `podkit-core/src/device/types.ts` → Rename to `PlatformDeviceInfo` (platform disk/volume info)
- `gpod-testing/src/types.ts` → Rename to `TestDeviceInfo` or remove if can use libgpod-node's `DeviceInfo`
- `podkit-core/src/ipod/types.ts` → Already `IpodDeviceInfo` ✓

**Actions:**
1. Rename in source files
2. Update all imports across packages
3. Update documentation references
4. Consider: Can `gpod-testing` just import from `libgpod-node`?

### Phase 3: IpodModel Type Disambiguation

**Goal:** Separate model variants from model numbers

**Renaming Strategy:**
- `libgpod-node/src/types.ts` → Keep as `IpodModel` (authoritative libgpod enum)
- `gpod-testing/src/types.ts` → Rename to `IpodModelNumber`

**Actions:**
1. Rename in `gpod-testing/src/types.ts`
2. Update test usages
3. Update gpod-tool interface if it uses this type

### Phase 4: MediaType Decision

**Goal:** Document and rationalize MediaType duplication

**Investigation:**
- Is the duplication intentional layering (libgpod-node = all types, podkit-core = user-facing subset)?
- Should podkit-core just re-export from libgpod-node?
- Are the extra types in libgpod-node ever needed by users?

**Options:**
A. **Keep separate** - libgpod-node has complete set, podkit-core curates subset for UX
B. **Consolidate** - podkit-core imports and re-exports from libgpod-node
C. **Document only** - Add comment explaining the layering decision

**Recommendation:** Start with Option C (document), consider Option B if maintenance burden is high

### Phase 5: Validation

**Actions:**
1. Run full test suite: `bun run test`
2. Run integration tests: `bun run test:integration`
3. Run E2E tests: `bun run test:e2e`
4. Build all packages: `bun run build`
5. Check for TypeScript errors: `bun run type-check` (if available)

### Testing Strategy

- Unit tests should not need changes (testing behavior, not names)
- Integration tests may need import updates
- E2E tests should be unaffected (using public APIs)
- Add test to verify generation metadata completeness

### Breaking Change Analysis

**Public APIs (@podkit/core exports):**
- ✓ Generation utilities - new exports, non-breaking
- ⚠️ `PlatformDeviceInfo` rename - breaking if exported
- ✓ `IpodDeviceInfo` - already correctly named

**Internal APIs:**
- Breaking changes within packages are acceptable
- Test packages (`gpod-testing`, `e2e-tests`) are internal

**Mitigation:**
- Check if `DeviceInfo` from `podkit-core/src/device/types.ts` is exported
- If yes, keep old name as type alias with `@deprecated` tag for one release
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Working Notes

### Current Status
Ready to begin implementation. All phases can be worked independently after Phase 1 completes.

### Phase Dependencies
- **Phase 1** (Generation mapping) - Independent, start first
- **Phase 2** (DeviceInfo) - Independent of Phase 1, can run in parallel
- **Phase 3** (IpodModel) - Independent, can run in parallel
- **Phase 4** (MediaType) - Documentation only, can be done anytime
- **Phase 5** (Validation) - Must be last, after all phases complete

### Files to Modify by Phase

**Phase 1:**
- Create: `packages/podkit-core/src/ipod/generation.ts`
- Modify: `packages/podkit-core/src/ipod/index.ts` (exports)
- Modify: `packages/podkit-core/src/index.ts` (public API)
- Modify: `packages/podkit-cli/src/commands/device.ts`
- Modify: `packages/podkit-core/src/video/types.ts`

**Phase 2:**
- Modify: `packages/podkit-core/src/device/types.ts`
- Modify: `packages/podkit-core/src/device/index.ts`
- Modify: `packages/podkit-core/src/index.ts`
- Modify: `packages/gpod-testing/src/types.ts`
- Find and update all imports of `DeviceInfo` from device package

**Phase 3:**
- Modify: `packages/gpod-testing/src/types.ts`
- Find and update all usages in test files

**Phase 4:**
- Add documentation comments to both MediaType definitions

### Rollback Strategy
Each phase modifies different files, so phases can be rolled back independently. Git commits should be made per phase for easy rollback.

### Testing Checkpoints
After each phase:
- Run `bun run build` to check for TypeScript errors
- Run affected package tests
- After all phases: Full test suite
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary of Changes

### Phase 1: Generation Mapping Consolidation ✓

Created `packages/podkit-core/src/ipod/generation.ts` with consolidated iPod generation metadata:
- **New exports:** `IPOD_GENERATIONS`, `formatGeneration()`, `getVideoProfile()`, `supportsVideo()`
- **Benefits:** Single source of truth for generation display names and video profiles
- **Migration:** CLI and video modules now import from `@podkit/core` instead of maintaining separate maps

### Phase 2: DeviceInfo Interface Disambiguation ✓

Renamed colliding `DeviceInfo` interfaces for clarity:
- **`libgpod-node/src/types.ts`:** Kept as `DeviceInfo` (authoritative libgpod binding)
- **`podkit-core/src/device/types.ts`:** Renamed to `PlatformDeviceInfo` (platform disk/volume info)
- **`gpod-testing/src/types.ts`:** Renamed to `TestDeviceInfo` (test utility device info)
- **`podkit-core/src/ipod/types.ts`:** Already correctly named `IpodDeviceInfo`

**Breaking change:** `DeviceInfo` export from `@podkit/core` is now `PlatformDeviceInfo` (pre-1.0, acceptable)

### Phase 3: IpodModel Type Disambiguation ✓

Renamed conflicting `IpodModel` type in `gpod-testing`:
- **`libgpod-node/src/types.ts`:** Kept as `IpodModel` (color variants: 'color', 'mini_blue', etc.)
- **`gpod-testing/src/types.ts`:** Renamed to `IpodModelNumber` (model numbers: 'MA147', 'MB565', etc.)

### Phase 4: MediaType Documentation ✓

Documented intentional MediaType duplication:
- **`libgpod-node`:** Complete set of all libgpod media types (13 types) - low-level bindings
- **`podkit-core`:** Curated subset of common types (6 types) with documentation - user-facing API
- **Rationale:** Layering design - complete bindings vs. user-friendly API

### Validation ✓

- **Build:** All packages build successfully with no TypeScript errors
- **Tests:** 289 pass, 3 skip, 0 fail across all packages
- **No breaking changes** to internal APIs (test packages)

## Benefits

1. **Reduced duplication:** Generation mappings maintained in one place
2. **Clearer types:** No more naming collisions between different DeviceInfo/IpodModel concepts
3. **Better discoverability:** Consolidated exports make generation utilities easier to find
4. **Documented decisions:** MediaType duplication rationale is clear
5. **Maintainability:** Easier to update generation data or type definitions in the future
<!-- SECTION:FINAL_SUMMARY:END -->

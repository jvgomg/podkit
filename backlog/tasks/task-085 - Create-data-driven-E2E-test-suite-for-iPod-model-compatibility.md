---
id: TASK-085
title: Create data-driven E2E test suite for iPod model compatibility
status: To Do
assignee: []
created_date: '2026-03-10 10:13'
labels:
  - testing
  - e2e
  - device-support
dependencies: []
references:
  - docs/SUPPORTED-DEVICES.md
  - docs/DEVICE-TESTING.md
  - packages/e2e-tests/README.md
  - packages/libgpod-node/src/types.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Create a systematic E2E test suite that validates podkit works correctly with all supported iPod models. Tests should be generated from a model capability matrix rather than hand-written for each model.

## Goals

1. **Prove correctness**: Verify podkit handles each model's supported content types and features
2. **Codified approach**: Define model capabilities as data, generate tests from that data
3. **Lightweight**: Fast execution using dummy iPod databases (no real hardware required)
4. **Maintainable**: Adding a new model = adding an entry to the capability matrix

## Design

### Model Capability Matrix

```typescript
// packages/e2e-tests/src/models/model-matrix.ts

export interface ModelCapabilities {
  modelNumber: string;
  name: string;
  generation: IpodGeneration;
  features: {
    music: boolean;
    artwork: boolean;
    video: boolean;
    playlists: boolean;
    smartPlaylists: boolean;
    podcasts: boolean;
  };
  verified: {
    e2eTest: boolean;
    realDevice: boolean;
    confirmedBy?: string;
  };
}

export const MODEL_MATRIX: ModelCapabilities[] = [
  {
    modelNumber: 'MA147',
    name: 'iPod Video 60GB (5th Gen)',
    generation: 'video_1',
    features: { music: true, artwork: true, video: true, playlists: true, smartPlaylists: true, podcasts: true },
    verified: { e2eTest: true, realDevice: true, confirmedBy: '@user (2024-03)' },
  },
  // ... all supported models
];
```

### Test Generator

```typescript
// packages/e2e-tests/src/models/model-tests.e2e.test.ts

for (const model of MODEL_MATRIX) {
  describe(`${model.name} (${model.modelNumber})`, () => {
    
    it('initializes with correct generation', async () => {
      await withTestIpod({ model: model.modelNumber }, async (ipod) => {
        const info = await ipod.info();
        expect(info.device.generation).toBe(model.generation);
      });
    });

    if (model.features.artwork) {
      it('supports artwork', async () => { /* ... */ });
      it('adds artwork to tracks', async () => { /* ... */ });
    } else {
      it('reports no artwork support', async () => { /* ... */ });
    }

    if (model.features.video) {
      it('supports video', async () => { /* ... */ });
    }
    // ... conditional tests for each feature
  });
}
```

## File Structure

```
packages/e2e-tests/src/models/
├── model-matrix.ts           # Source of truth for capabilities
├── model-matrix.test.ts      # Validate matrix consistency
├── model-tests.e2e.test.ts   # Generated database-level tests
└── cli-model-tests.e2e.test.ts # Generated CLI tests
```

## Model Coverage

One representative model per supported generation:
- iPod 1st-4th gen, Photo
- iPod Mini 1st/2nd
- iPod Shuffle 1st/2nd
- iPod Nano 1st-5th
- iPod Video 5th/5.5th
- iPod Classic 6th/7th

## Sync with Documentation

Add validation that matrix matches SUPPORTED-DEVICES.md and can regenerate the doc table.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Model capability matrix exists as single source of truth in model-matrix.ts
- [ ] #2 Tests are generated dynamically from matrix (not hand-written per model)
- [ ] #3 Each supported generation has at least one representative model in the matrix
- [ ] #4 Feature tests are conditional: only run if model.features.X is true
- [ ] #5 Matrix includes verification status (e2eTest, realDevice, confirmedBy)
- [ ] #6 CLI integration tests verify sync respects device capabilities
- [ ] #7 Matrix validation tests ensure consistency with libgpod and docs
- [ ] #8 Running tests produces clear output showing which models/features passed
<!-- AC:END -->

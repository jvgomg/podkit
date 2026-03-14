# @podkit/compatibility

Single source of truth for iPod model compatibility data.

## Overview

This private package contains the iPod model matrix, generation summaries, and real device test records. It's consumed by:

- **`@podkit/e2e-tests`** — generates data-driven test suites from the model matrix
- **`@podkit/docs-site`** — renders compatibility tables via Astro components

## Data

### `MODEL_MATRIX`

Array of 19 `ModelEntry` objects — one representative model per supported iPod generation. Each entry includes:

- Model number, name, and generation
- Feature flags (music, artwork, video, playlists)
- Checksum type (`none`, `hash58`, `hash72`)
- Whether a dummy database can be created for testing

### `GENERATION_INFO`

Array of 19 `GenerationInfo` objects — per-generation summary with all known model numbers, shared features, and confidence level.

### `REAL_DEVICE_REPORTS`

Array of confirmed real hardware test records with who tested, when, and notes.

## Usage

```typescript
import {
  MODEL_MATRIX,
  TESTABLE_MODELS,
  GENERATION_INFO,
  getModelByGeneration,
  getModelsByChecksumType,
} from '@podkit/compatibility';

// All 19 models
console.log(MODEL_MATRIX.length); // 19

// Models that can be tested with dummy databases
console.log(TESTABLE_MODELS.length); // 19 (all models)

// Find a model by generation
const classic = getModelByGeneration('classic_2');
console.log(classic?.modelNumber); // 'MB565'

// Find models by checksum type
const hash58Models = getModelsByChecksumType('hash58');
console.log(hash58Models.length); // 5 (Classic 1-3, Nano 3-4)
```

## Types

- `ModelEntry` — individual model with features, checksum type, and testability
- `GenerationInfo` — per-generation summary
- `RealDeviceReport` — real hardware confirmation record
- `ChecksumType` — `'none' | 'hash58' | 'hash72'`
- `ConfidenceLevel` — `'verified' | 'simulated' | 'expected'`

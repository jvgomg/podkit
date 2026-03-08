---
id: TASK-070.08
title: Add E2E tests for Subsonic sync workflow
status: To Do
assignee: []
created_date: '2026-03-08 16:16'
updated_date: '2026-03-08 16:21'
labels:
  - test
  - e2e
  - subsonic
dependencies:
  - TASK-070.05
  - TASK-070.07
parent_task_id: TASK-070
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Create end-to-end tests that verify the complete workflow: sync from Subsonic server to iPod via CLI.

## Test Structure

Extend existing E2E test infrastructure to support Subsonic sources.

### Source Abstraction

Create `packages/e2e-tests/src/sources/` to mirror the `targets/` pattern:

```typescript
// packages/e2e-tests/src/sources/types.ts
export interface TestSource {
  readonly url: string;      // Source URL for CLI
  readonly name: string;     // Display name
  readonly trackCount: number;
  
  setup(): Promise<void>;
  teardown(): Promise<void>;
}

// packages/e2e-tests/src/sources/subsonic.ts
export class SubsonicTestSource implements TestSource {
  // Uses Docker Navidrome with test fixtures
}

// packages/e2e-tests/src/sources/directory.ts
export class DirectoryTestSource implements TestSource {
  // Uses local test fixtures (existing behavior)
}
```

### E2E Tests

Create `packages/e2e-tests/src/workflows/subsonic-sync.e2e.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withTarget } from '../targets/index.js';
import { SubsonicTestSource } from '../sources/subsonic.js';
import { runCli } from '../helpers/cli-runner.js';

describe('Subsonic sync workflow', () => {
  let source: SubsonicTestSource;
  
  beforeAll(async () => {
    source = new SubsonicTestSource();
    await source.setup();
  }, 120000);
  
  afterAll(async () => {
    await source.teardown();
  });
  
  it('syncs tracks from Subsonic to iPod', async () => {
    await withTarget(async (target) => {
      const result = await runCli([
        'sync',
        '--source', source.url,
        '--device', target.path,
      ], {
        env: {
          SUBSONIC_PASSWORD: 'test',
        },
      });
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Sync complete');
      
      const trackCount = await target.getTrackCount();
      expect(trackCount).toBe(source.trackCount);
    });
  });
  
  it('fails sync on download error', async () => {
    // Test with network interruption or invalid track
  });
  
  it('dry-run shows planned operations without downloading', async () => {
    // Verify --dry-run doesn't actually download files
  });
});
```

## Test Scenarios

1. **Fresh sync**: Empty iPod → sync all tracks from Subsonic
2. **Incremental sync**: Add tracks to Subsonic → sync → verify only new tracks transferred
3. **Dry run**: Verify operations shown without actual transfer
4. **Error handling**: Simulate download failure → verify sync fails cleanly
5. **Large library**: Test with 100+ tracks to verify pagination

## CI Configuration

Update GitHub Actions to:
1. Start Navidrome service
2. Seed test data
3. Run E2E tests
4. Cleanup

## Files to Create

- `packages/e2e-tests/src/sources/types.ts`
- `packages/e2e-tests/src/sources/subsonic.ts`
- `packages/e2e-tests/src/sources/directory.ts`
- `packages/e2e-tests/src/sources/index.ts`
- `packages/e2e-tests/src/workflows/subsonic-sync.e2e.test.ts`
- `packages/e2e-tests/docker-compose.yml` (or extend existing)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 TestSource abstraction created
- [ ] #2 SubsonicTestSource uses Docker Navidrome
- [ ] #3 Fresh sync E2E test passes
- [ ] #4 Incremental sync E2E test passes
- [ ] #5 Dry run E2E test passes
- [ ] #6 Error handling E2E test passes
- [ ] #7 Tests run in CI with Docker
- [ ] #8 Tests skip gracefully without Docker
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Docker requirement:** This is the only test suite that requires Docker. Integration tests (070.07) use HTTP mocks instead.

**Implementation details are suggestions** - developers may choose different approaches as long as acceptance criteria are met.
<!-- SECTION:NOTES:END -->

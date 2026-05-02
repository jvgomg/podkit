---
id: TASK-003
title: Define testing strategy
status: Done
assignee: []
created_date: '2026-02-22 18:32'
updated_date: '2026-02-22 22:31'
labels: []
milestone: 'M0: Project Bootstrap'
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discuss and document the testing approach for podkit:

**Topics to cover:**
- Unit testing framework (Bun test runner)
- Integration testing approach (mocking vs real dependencies)
- How to test libgpod bindings without physical iPod
- Test iPod image creation for CI
- Coverage requirements
- Test organization (co-located vs separate test directories)

**Outcome:** Create an ADR or docs/TESTING.md documenting the decisions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Testing approach discussed with user
- [x] #2 ADR or TESTING.md created documenting decisions
- [x] #3 Basic test setup working in at least one package
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## iPod Test Environment (from TASK-007)

**Approach:** Use `itdb_init_ipod()` to create test iPod in temp directory.

- No physical device needed
- No loopback mounts or root access required
- Full libgpod operations work (parse, add tracks, write)
- Fast creation/teardown for unit tests
- CI-friendly (Linux/macOS/Windows)

**Test helper concept:**
```typescript
async function createTestIpod(model: string, name: string): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-ipod-'));
  await libgpod.initIpod(tmpDir, model, name);
  return tmpDir;
}
```

See TASK-007 notes for full details and proof of concept.

## Decisions Made

1. **Conditional skipping**: Tests skip gracefully when dependencies unavailable; Bun reports skipped tests
2. **Coverage philosophy**: No hard targets, but high coverage expected - write tests for anything testable
3. **Test categories**: Unit tests (*.test.ts) and integration tests (*.integration.test.ts)
4. **Filtering**: `bun run test:unit` and `bun run test:integration` work with turborepo

## Implementation

- Updated turbo.json with test:unit and test:integration tasks
- Updated all package.json files with test filtering scripts
- Renamed gpod-testing tests to *.integration.test.ts (they require gpod-tool)
- Created docs/TESTING.md with full testing strategy documentation
- Updated AGENTS.md and docs/README.md with documentation references
<!-- SECTION:NOTES:END -->

---
id: TASK-070.07
title: Add integration tests for SubsonicAdapter (mocked HTTP)
status: To Do
assignee: []
created_date: '2026-03-08 16:16'
updated_date: '2026-03-08 16:21'
labels:
  - test
  - integration
  - subsonic
dependencies:
  - TASK-070.04
  - TASK-070.06
parent_task_id: TASK-070
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Create integration tests for SubsonicAdapter using a mocked HTTP server (not Docker). These tests verify the adapter's HTTP interaction patterns work correctly.

## Approach: Mock HTTP Server

Use a lightweight HTTP mock server (e.g., `msw` or `nock`) instead of Docker:

```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer(
  http.get('*/rest/ping', () => {
    return HttpResponse.json({
      'subsonic-response': { status: 'ok', version: '1.16.1' }
    });
  }),
  
  http.get('*/rest/getAlbumList2', ({ request }) => {
    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    // Return paginated album data
  }),
  
  http.get('*/rest/download', () => {
    // Return mock audio file
    return new HttpResponse(mockAudioBuffer, {
      headers: { 'Content-Type': 'audio/flac' }
    });
  }),
);
```

## Test Cases

### HTTP Interaction Tests
- Verify correct URL construction for each endpoint
- Verify authentication parameters sent correctly
- Verify pagination parameters
- Verify error handling for HTTP failures (500, timeout)
- Verify handling of malformed responses

### Response Parsing Tests
- Parse real Subsonic XML/JSON responses (captured from actual server)
- Handle edge cases in response data

### Download Stream Tests
- Verify stream is properly consumed
- Verify size header is extracted

## Difference from Unit Tests

Unit tests (070.06) mock the `subsonic-api` library itself. These integration tests mock at the HTTP level to verify the full request/response cycle.

## Files to Create

- `packages/podkit-core/src/adapters/subsonic.integration.test.ts`
- `packages/podkit-core/test/fixtures/subsonic-responses/` (captured API responses)

## Notes

- Docker-based E2E tests (070.08) provide the real Navidrome testing
- This approach allows integration tests to run without Docker in CI
- Implementation details are suggestions - developers may use different mocking approaches
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Mock HTTP server setup for Subsonic API
- [ ] #2 Tests verify correct URL/parameter construction
- [ ] #3 Tests verify pagination handling
- [ ] #4 Tests verify error handling (HTTP errors, timeouts)
- [ ] #5 Tests verify download stream handling
- [ ] #6 Tests run without Docker in CI
<!-- AC:END -->

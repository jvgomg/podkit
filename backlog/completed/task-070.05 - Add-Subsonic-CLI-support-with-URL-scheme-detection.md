---
id: TASK-070.05
title: Add Subsonic CLI support with URL scheme detection
status: Done
assignee: []
created_date: '2026-03-08 16:16'
updated_date: '2026-03-09 20:13'
labels:
  - cli
  - subsonic
dependencies:
  - TASK-070.04
parent_task_id: TASK-070
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Update CLI to detect `subsonic://` URLs in the `--source` argument and create the appropriate adapter.

## Implementation

### 1. URL Parsing

Create `packages/podkit-cli/src/utils/source-url.ts`:

```typescript
export interface ParsedSource {
  type: 'directory' | 'subsonic';
  path?: string;  // For directory
  url?: string;   // For subsonic
  username?: string;
  password?: string;
}

export function parseSourceUrl(source: string): ParsedSource {
  if (source.startsWith('subsonic://')) {
    const url = new URL(source);
    const username = url.username || process.env.SUBSONIC_USERNAME;
    const password = url.password || process.env.SUBSONIC_PASSWORD;
    
    if (!username) {
      throw new Error('Subsonic username required (in URL or SUBSONIC_USERNAME env)');
    }
    
    // Convert to https:// URL for API
    const apiUrl = `https://${url.host}${url.pathname}`;
    
    return {
      type: 'subsonic',
      url: apiUrl,
      username,
      password,
    };
  }
  
  return {
    type: 'directory',
    path: source,
  };
}
```

### 2. Update Sync Command

In `packages/podkit-cli/src/commands/sync.ts`:

```typescript
import { parseSourceUrl } from '../utils/source-url.js';
import { createDirectoryAdapter, SubsonicAdapter } from '@podkit/core';

function createAdapter(source: string): CollectionAdapter {
  const parsed = parseSourceUrl(source);
  
  if (parsed.type === 'subsonic') {
    if (!parsed.password) {
      throw new Error('Subsonic password required (in URL or SUBSONIC_PASSWORD env)');
    }
    return new SubsonicAdapter({
      url: parsed.url!,
      username: parsed.username!,
      password: parsed.password,
    });
  }
  
  return createDirectoryAdapter({ path: parsed.path! });
}
```

### 3. Environment Variables

Support:
- `SUBSONIC_USERNAME` - Username (optional if in URL)
- `SUBSONIC_PASSWORD` - Password (recommended over URL for security)
- `SUBSONIC_URL` - Full URL (alternative to subsonic:// scheme)

### 4. Update Help Text

Document the new URL scheme in `--source` help.

## Files to Modify

- `packages/podkit-cli/src/utils/source-url.ts` (new)
- `packages/podkit-cli/src/commands/sync.ts`
- `packages/podkit-cli/src/commands/list.ts` (if supports --source)

## Testing

- Unit tests for parseSourceUrl()
- Test various URL formats and env var combinations
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 subsonic:// URL scheme parsed correctly
- [x] #2 Username/password extracted from URL
- [x] #3 SUBSONIC_PASSWORD env var used when password not in URL
- [x] #4 Clear error messages for missing credentials
- [x] #5 Help text documents new source format
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Implementation details are suggestions** - developers may choose different approaches as long as acceptance criteria are met.
<!-- SECTION:NOTES:END -->

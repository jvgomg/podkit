---
id: TASK-040.07
title: Implement smart playlist APIs
status: Done
assignee: []
created_date: '2026-02-23 22:38'
updated_date: '2026-02-24 00:13'
labels:
  - libgpod-node
  - playlists
  - smart-playlists
dependencies: []
parent_task_id: TASK-040
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose libgpod smart playlist (SPL) APIs:

- `itdb_splr_*` functions for smart playlist rules
- SPL field matching and conditions
- Rule creation and modification

Smart playlists use query-based filtering rather than explicit track lists.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Can create smart playlists with rules
- [x] #2 Can define match conditions (artist, genre, rating, etc.)
- [x] #3 Smart playlist tracks auto-populate based on rules
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Research (2026-02-24)

Analyzed libgpod source code for SPL APIs:

### Key Data Structures

**Itdb_SPLPref** - Smart playlist preferences:
- `liveupdate` - Live updating enabled
- `checkrules` - Whether to match rules (if 0, ignore rules)
- `checklimits` - Limit enabled
- `limittype` - ItdbLimitType (songs, minutes, MB, hours, GB)
- `limitsort` - ItdbLimitSort (random, name, album, artist, etc.)
- `limitvalue` - Limit value
- `matchcheckedonly` - Match only checked songs

**Itdb_SPLRule** - Individual rule:
- `field` - ItdbSPLField (artist, album, genre, year, rating, etc.)
- `action` - ItdbSPLAction (is, contains, starts_with, greater_than, etc.)
- `string` - String value for string comparisons
- `fromvalue/tovalue` - Numeric values for range comparisons
- `fromdate/todate` - Date values
- `fromunits/tounits` - Units for date comparisons

**Itdb_SPLRules** - Collection of rules:
- `match_operator` - ITDB_SPLMATCH_AND or ITDB_SPLMATCH_OR
- `rules` - GList of Itdb_SPLRule

### Available Functions
- `itdb_playlist_new(name, TRUE)` - Create SPL (second param is spl flag)
- `itdb_splr_new()` - Create new rule
- `itdb_splr_add(pl, splr, pos)` - Add rule to playlist
- `itdb_splr_add_new(pl, pos)` - Create and add rule
- `itdb_splr_remove(pl, splr)` - Remove rule
- `itdb_splr_validate(splr)` - Validate rule
- `itdb_splr_eval(splr, track)` - Evaluate rule against track
- `itdb_splr_get_field_type(splr)` - Get field type
- `itdb_splr_get_action_type(splr)` - Get action type

### Important Note
libgpod provides `itdb_splr_eval()` which evaluates a rule against a track. This means libgpod CAN evaluate SPL rules, but the iPod typically does the actual filtering at playback time. The rules are stored in the database and the iPod firmware handles the filtering.

For this implementation, we'll:
1. Allow creating smart playlists with rules
2. Store rules in the database format iPod expects
3. Optionally provide an evaluate function for testing/preview
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Implementation Summary

Implemented smart playlist (SPL) APIs for the libgpod-node package, exposing libgpod's smart playlist functionality through the Node.js bindings.

### Changes

**TypeScript Types** (`packages/libgpod-node/src/types.ts`):
- Added `SPLMatch` enum (And/Or match operators)
- Added `SPLLimitType` enum (minutes, MB, songs, hours, GB)
- Added `SPLLimitSort` enum (random, song name, album, artist, etc.)
- Added `SPLField` enum (song name, album, artist, genre, rating, etc.)
- Added `SPLAction` enum (is, contains, starts with, greater than, etc.)
- Added `SPLActionLastUnits` constants (days, weeks, months in seconds)
- Added `SPLRule` interface for rule definitions
- Added `SPLPreferences` interface for playlist settings
- Added `SmartPlaylistInput` interface for creation
- Added `SmartPlaylist` interface extending Playlist

**Native Bindings** (`packages/libgpod-node/native/`):
- Added SPL method declarations to `database_wrapper.h`
- Implemented 8 SPL methods in `playlist_operations.cc`:
  - `CreateSmartPlaylist` - Create SPL with rules and preferences
  - `GetSmartPlaylistRules` - Get rules from an SPL
  - `AddSmartPlaylistRule` - Add a rule to an SPL
  - `RemoveSmartPlaylistRule` - Remove a rule by index
  - `ClearSmartPlaylistRules` - Remove all rules
  - `SetSmartPlaylistPreferences` - Update preferences
  - `GetSmartPlaylistPreferences` - Get preferences
  - `EvaluateSmartPlaylist` - Evaluate rules against all tracks
- Added SPL converters to `gpod_converters.cc`:
  - `SPLRuleToObject` / `ObjectToSPLRule`
  - `SPLPrefsToObject` / `ObjectToSPLPrefs`
  - `SmartPlaylistToObject`

**TypeScript API** (`packages/libgpod-node/src/database.ts`):
- Added `createSmartPlaylist()` method
- Added `getSmartPlaylistRules()` method
- Added `addSmartPlaylistRule()` method
- Added `removeSmartPlaylistRule()` method
- Added `clearSmartPlaylistRules()` method
- Added `getSmartPlaylistPreferences()` method
- Added `setSmartPlaylistPreferences()` method
- Added `evaluateSmartPlaylist()` method
- Added `getSmartPlaylists()` helper method

**Tests** (`packages/libgpod-node/src/__tests__/smart-playlists.integration.test.ts`):
- 30 integration tests covering:
  - Smart playlist CRUD operations
  - Rule management (add, remove, clear)
  - Preferences management
  - Rule evaluation with AND/OR matching
  - Various rule types (genre, artist, rating, year)
  - Error handling for invalid operations

### Key Design Decisions

1. **Rule Evaluation**: Used libgpod's `itdb_splr_eval()` function for rule evaluation. This allows previewing which tracks match, though the actual iPod firmware evaluates rules at playback time.

2. **Default Preferences**: Smart playlists are created with sensible defaults (liveUpdate=true, checkRules=true, checkLimits=false).

3. **Consistent API**: SPL operations follow the same patterns as existing playlist operations (BigInt IDs, error throwing, etc.).

### Example Usage

```typescript
import { Database, SPLField, SPLAction, SPLMatch } from '@podkit/libgpod-node';

const db = Database.openSync('/media/ipod');

// Create a smart playlist for rock music
const playlist = db.createSmartPlaylist({
  name: 'Rock Music',
  match: SPLMatch.And,
  rules: [
    { field: SPLField.Genre, action: SPLAction.Contains, string: 'Rock' }
  ]
});

// Preview matching tracks
const matches = db.evaluateSmartPlaylist(playlist.id);
console.log(`${matches.length} tracks match`);

await db.save();
```
<!-- SECTION:FINAL_SUMMARY:END -->

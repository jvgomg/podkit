---
id: TASK-040.06
title: Implement database creation APIs
status: Done
assignee: []
created_date: '2026-02-23 22:38'
updated_date: '2026-02-24 00:05'
labels:
  - libgpod-node
  - database
dependencies: []
parent_task_id: TASK-040
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose libgpod database creation/manipulation APIs:

- `itdb_new()` - Create empty database (not from existing mount)
- `itdb_parse_file(filename)` - Parse from specific file path
- `itdb_duplicate(itdb)` - Duplicate entire database
- `itdb_set_mountpoint(itdb, mountpoint)` - Change mountpoint

These would enable creating new iPod databases programmatically rather than only reading existing ones.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Database.create() creates new empty database
- [x] #2 Database.openFile(path) opens from specific file
- [ ] #3 database.duplicate() creates a copy
- [x] #4 Integration tests for database creation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### What was implemented:

1. **`Database.create()`** - Creates a new empty database using `itdb_new()`
   - Returns a database with no mountpoint set
   - Use `setMountpoint()` to associate with an iPod before saving

2. **`Database.openFile(path)`** / **`Database.openFileAsync(path)`** - Opens database from specific file path using `itdb_parse_file()`
   - Useful for reading backup database files
   - Database has no mountpoint; file operations won't work until `setMountpoint()` is called

3. **`database.setMountpoint(path)`** - Sets/changes the mountpoint using `itdb_set_mountpoint()`
   - Warning: Removes artwork read from previous iPod

4. **`database.getFilename()`** - Returns the database file path (from `db_->filename`)

### Not implemented (libgpod limitation):

- **`database.duplicate()`** - `itdb_duplicate()` is marked as "not implemented yet" in libgpod source and always returns NULL. This cannot be implemented until upstream libgpod adds support.

### Native binding changes:
- Added `parseFile()` and `create()` module-level functions in `gpod_binding.cc`
- Added `setMountpoint()` and `getFilename()` instance methods in `database_wrapper.cc`

### TypeScript changes:
- Added `parseFile()` and `create()` functions in `binding.ts`
- Added `Database.create()`, `Database.openFile()`, `Database.openFileAsync()` static methods
- Added `setMountpoint()` and `getFilename()` instance methods

### Tests:
- Added 8 integration tests covering all implemented functionality

Note: Acceptance criteria #3 (duplicate) could not be implemented because libgpod's itdb_duplicate() returns NULL - it's marked as 'not implemented yet' in the upstream source code.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary\n\nImplemented database creation APIs for libgpod-node:\n\n### New APIs:\n- `Database.create()` - Create empty database with `itdb_new()`\n- `Database.openFile(path)` / `openFileAsync(path)` - Parse from specific file with `itdb_parse_file()`\n- `database.setMountpoint(path)` - Change mountpoint with `itdb_set_mountpoint()`\n- `database.getFilename()` - Get database file path\n\n### Files Changed:\n- `packages/libgpod-node/native/gpod_binding.cc` - Added `parseFile()` and `create()` module functions\n- `packages/libgpod-node/native/database_wrapper.h` - Added method declarations\n- `packages/libgpod-node/native/database_wrapper.cc` - Added `setMountpoint()` and `getFilename()` methods\n- `packages/libgpod-node/src/binding.ts` - Added TypeScript bindings\n- `packages/libgpod-node/src/database.ts` - Added public API methods\n- `packages/libgpod-node/src/__tests__/database.integration.test.ts` - Added 8 integration tests\n\n### Notes:\n- `database.duplicate()` NOT implemented - libgpod's `itdb_duplicate()` always returns NULL (marked as unimplemented in upstream)
<!-- SECTION:FINAL_SUMMARY:END -->

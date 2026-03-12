---
id: TASK-130
title: Research iPod Classic 3rd gen SQLite database requirement
status: To Do
assignee: []
created_date: '2026-03-12 11:11'
labels:
  - phase-0
  - research
  - sqlite
milestone: ipod-db Core (libgpod replacement)
dependencies: []
references:
  - doc-003
documentation:
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_sqlite.c
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_sqlite_queries.h
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Determine whether iPod Classic 3rd gen (7th gen, models C293/C297) requires SQLite databases alongside iTunesDB, and what other devices in our target range may need SQLite.

**Background:**
libgpod's `itdb_device_supports_sqlite_db()` returns TRUE for:
- iPod Classic 3rd gen (7th gen)
- iPod Nano 5th gen
- iPod Nano 6th gen
- iPod Touch (all)
- iPhone (all)
- iPad

Of these, only Classic 3 and Nano 5 are in podkit's target range. If SQLite is required, the iPod firmware may reject or reset a database that doesn't include the SQLite files.

**Questions to answer:**

1. **Does Classic 3rd gen work without SQLite?** Can we write just an iTunesDB and have the device accept it? Or does the firmware require `iPod_Control/iTunes/iTunesDB.sqlite` and related files?

2. **What is the SQLite schema?** If required, what tables/columns does the SQLite database contain? Is it a mirror of iTunesDB data, or does it contain additional information?

3. **Does libgpod generate SQLite?** Check `itdb_sqlite.c` in the libgpod source. What does it create? How complex is the schema?

4. **What happens when SQLite is missing?** Does the iPod: (a) silently rebuild it from iTunesDB, (b) show an error, (c) reset the database entirely, or (d) work fine without it?

5. **Can we defer SQLite and still support Classic 3?** If the device rebuilds SQLite from iTunesDB automatically, we might not need to generate it ourselves.

**Approach:**
- Read libgpod's `itdb_sqlite.c` and `itdb_sqlite_queries.h` to understand the schema
- Search for community reports about Classic 3rd gen and SQLite requirements
- If possible, test on real hardware (we don't currently have a Classic 3rd gen)
- Document findings and either add a SQLite generation task or confirm it's not needed

**Impact:** If SQLite IS required, we need to add `better-sqlite3` as a dependency and create a new task for SQLite generation. This affects TASK-117 (writer) and TASK-121 (Database class).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 libgpod's itdb_sqlite.c analyzed and schema documented
- [ ] #2 Determined whether Classic 3rd gen requires SQLite or works with iTunesDB alone
- [ ] #3 Determined whether Nano 5th gen requires SQLite
- [ ] #4 If required: SQLite schema documented and new implementation task created
- [ ] #5 If not required: documented why and closed
- [ ] #6 Community sources checked for real-world reports
<!-- AC:END -->

---
"podkit": minor
"@podkit/core": minor
---

Refactor the diagnostic-check scope model from a 2-field shape (`scope: 'system' | 'device'` + `category?: 'readiness' | 'database'`) to a single required 3-way union (`scope: 'system' | 'device-readiness' | 'database-health'`). Compile-time enforcement that every check declares which section it renders into; no more silent fallback when `category` is missing. The user-facing CLI `--scope` flag values are unchanged.

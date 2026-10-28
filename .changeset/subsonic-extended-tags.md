---
"podkit": minor
"@podkit/core": minor
---

Map composer and grouping from Subsonic, and sort names with `serverSortNames`

The Subsonic adapter now maps composer and grouping where the server provides the OpenSubsonic fields, so they reach iPods like the same tags from a folder collection; composers credited separately stay separate values in portable file tags. A field the server does not report (track/disc totals, or the OpenSubsonic fields on a plain Subsonic server) is left untouched on the iPod; a field it reports as empty clears the iPod value.

Sort names are used only with the new per-collection `serverSortNames = true`. A server may report a derived ordering key as the sort name, so by default sort fields from a Subsonic source are neither written nor cleared.

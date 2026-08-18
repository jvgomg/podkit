---
'@podkit/devices-ipod': minor
'@podkit/core': patch
'podkit': patch
---

Record where every FamilyID value came from, and stop unverified ones from naming devices podkit refuses.

The FamilyID table now carries provenance per entry — `{ generation, evidence: 'hardware' | 'inferred', source }` — so a value read off a real device is distinguishable in the data from one taken from a community SysInfo dump, rather than in a comment block that drifts. Three invariants are enforced by tests so a bad row fails at commit time: FamilyID bands must match device class (`< 100` click-wheel, `100–999` shuffle, `>= 10000` iOS), an inferred value must fall inside the release-date window its neighbouring hardware anchors leave open, and an inferred value may only name a `syncable` generation — a guess may open a door, never close one. The band rule alone would have rejected eleven of the table's original entries.

Six values whose numbers the hardware anchors contradict are removed: 4 (iPod Photo), 5 (mini 1G), 7 (Classic 6G), 8 (nano 1G), 24 (nano 6G) and a duplicate 13 (nano 3G — hardware puts the nano 3G at 12, twice over). These now fail closed with an honest unknown-model error naming the inputs, which is safer than a confident wrong answer that suppresses it.

**Breaking (`@podkit/devices-ipod`):** `FAMILY_ID_TO_GENERATION: Record<number, IpodGenerationId>` is replaced by `FAMILY_ID_TABLE: Record<number, FamilyIdEntry>`. `lookupByFamilyId(familyId)` is unchanged and still returns an `IpodGenerationId | undefined`; the new `lookupFamilyIdEntry(familyId)` returns the entry with its evidence, for callers that want to render confidence rather than branch on it.

**Also breaking (`@podkit/devices-ipod`):** `getUnsupportedReasonByLibgpodName()` and the `UnsupportedGenerationKind` type are removed. They categorised a device from libgpod's view of its generation; nothing categorises that way any more, because the identity cascade resolves a generation first and the refusal reason is derived from podkit's own generation table, which knows the access tier and why.

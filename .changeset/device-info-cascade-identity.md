---
'@podkit/core': minor
'podkit': minor
---

`podkit device info` no longer contradicts itself on iPods libgpod cannot identify.

libgpod resolves an iPod's generation from its own serial-suffix table and a classic `SysInfo` model number; it has no USB axis at all. On a device outside those tables — an iPod shuffle 2nd gen, for instance — it reports the generation as `unknown`. podkit's own identity cascade resolves such a device correctly from its USB product ID, but only the model *name* in `device info` was reading from the cascade. Everything else read from libgpod, so the report named the model in its header while the lines below said "not supported on Unknown Generation" and claimed podkit could not sync the device — all while `doctor` passed and `sync` worked.

The generation, model number, capacity and the "can podkit sync this?" verdict now all come from the model the device open already resolved, so they cannot disagree with each other or with the header. Concretely:

- The generation label on capability bullets names the identified model, never "Unknown Generation".
- The only refusal `device info` can raise for an iPod is its generation's own unsupported reason — the same one `sync`, `device add` and `doctor` show, in the same words. A device podkit genuinely cannot identify fails earlier and louder, at open, with `UNKNOWN_IPOD_MODEL`.
- Validation issues are no longer hidden on read-only devices (shuffle 3G/4G, nano 6G). That suppression existed only to mask this contradiction; the issue shown there now agrees with the read-only framing beside it.
- `sync` no longer re-validates the device against libgpod's view after opening it. Both refusals it could raise are already settled by the identity cascade before any work starts, so it could only ever produce a false one.

Breaking for JSON consumers of `device info`:

- `status.model.generation` (a libgpod generation name such as `nano_3`) is now `status.model.generationId`, an `IpodGenerationId` such as `nano_3g` — matching the vocabulary `readiness.model.generationId` and `device list` already use. The field was renamed rather than re-valued so the change fails loudly.
- `status.capabilities` is removed. It carried libgpod's per-device flags, which were all `false` on any device libgpod could not identify. Capability truth for a mounted device comes from the generation tables; read `readiness.model` for the identified model.
- `status.validation.warnings` is removed. Its entries restated `status.capabilities` and shared its source.
- `status.model.number` and `status.model.capacity` are populated only when the cascade identified the device from a source carrying them (SysInfo or serial). A USB-only identification reports `null` / `0` rather than a guess.

Text output loses the `Podcasts` capability bullet on iPods, which was the last value read from libgpod's capability view. Podcast support is not modelled in podkit's capability tables.

Removed from `@podkit/core`: `validateDevice`, `isUnsupportedGeneration`, `formatValidationMessages`, `formatCapabilities`, `buildSyncWarnings`, and the `DeviceValidationResult` / `DeviceIssue` / `DeviceWarning` / `DeviceCapabilitySummary` / `UnsupportedReason` types. They took libgpod's device view as their input and have no replacement taking it — the equivalent verdict lives on the resolved model's `unsupportedReason`.

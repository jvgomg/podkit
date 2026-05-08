---
"podkit": minor
---

Unify JSON error shape for `device add` and `collection music`/`collection video`

These commands now emit the same JSON error format on failure:

```json
{
  "success": false,
  "error": "<human-readable message>",
  "code": "<machine-readable tag>",
  "...details": "<command-specific extras>"
}
```

**Breaking for `collection music` / `collection video` JSON consumers.** The previous shape was `{ "error": true, "message": "..." }`. If you parse JSON output from these commands, update consumers to read `success === false` and `error` (instead of `error === true` and `message`).

`device add` errors now also include a `code` field (additive, not breaking).

Underneath: the runners (`runDeviceAdd`, `runCollectionMusic`, `runCollectionVideo`) throw a typed `CliError` and the action wrapper (`runAction`) translates it into structured output + exit code. Tests assert on the captured JSON instead of `process.exitCode` side-effects.

Per CLI breaking-change convention this is a minor bump. Other commands still emit their existing shapes; that unification will land in a follow-up.

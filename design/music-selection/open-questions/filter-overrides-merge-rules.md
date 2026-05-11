---
status: open
last-updated: 2026-05-11
importance: medium
links:
  - ../principles/inline-collections-on-devices.md
  - collection-extends-mechanism.md
---

# How do inline overrides compose with a referenced collection?

> **The question.** When a device references a named collection *and* sets
> inline collection fields, how do the two combine? Specifically: do list
> fields merge, replace, or require explicit `.add` / `.remove` operators?

## Why this matters

This is the load-bearing detail of the inline-collections-on-devices
principle. Get it wrong and the principle leaks footguns:

- Silent merge of lists → users surprised when their device gets more
  playlists than they listed.
- Silent replacement of lists → users surprised when their device loses
  playlists they expected to inherit.
- Inconsistent rules across field types → users have to memorise per-field
  semantics.

Whatever rule we pick, it has to be predictable from the syntax.

## Options

### Option A — Always replace

```toml
[collections.my-music]
playlists = ["A", "B", "C"]

[devices.terapod]
music.collection = "my-music"
music.playlists = ["D"]              # device gets only ["D"]
```

**Pros:** Simplest semantics. Predictable.
**Cons:** Verbose for the common "I want everything plus one more" case.

### Option B — Always merge (union for lists, override for scalars)

```toml
[devices.terapod]
music.collection = "my-music"
music.playlists = ["D"]              # device gets ["A", "B", "C", "D"]
```

**Pros:** Concise for the common case.
**Cons:** Surprising: writing `playlists = ["D"]` and getting four items.
No way to remove an inherited entry.

### Option C — Explicit `.add` / `.remove` operators

```toml
[devices.terapod]
music.collection = "my-music"
music.playlists.add = ["D"]          # device gets ["A", "B", "C", "D"]
music.playlists.remove = ["B"]       # device gets ["A", "C", "D"]
music.playlists = ["E"]              # error: ambiguous (replace? add?)
                                     # OR: replace, with a strict warning if
                                     # a parent collection had values
```

**Pros:** Explicit about intent. Predictable. Composable across many
devices and (potentially) chained extends.
**Cons:** Verbose. Adds operator vocabulary to the config.

### Option D — Replace by default, `.add` / `.remove` for additive

A pragmatic middle ground:

- Bare list assignment replaces.
- Explicit `.add` / `.remove` operators handle additive/subtractive cases.
- No silent merge.

```toml
[devices.terapod]
music.collection = "my-music"
music.playlists = ["D"]              # replaces: device gets ["D"]
music.playlists.add = ["D"]          # additive: device gets ["A", "B", "C", "D"]
```

**Pros:** Preserves replacement as the obvious default; gives a clean
escape hatch.
**Cons:** Three syntaxes to learn (bare assignment, `.add`, `.remove`).

## What about scalars?

For scalars (`playlist-mode`, `episodes-per-show`, etc.) all options agree:
inline value wins. No merging, no operators. The question is only about
list fields.

## What about nested filter structs?

E.g., `filter.genre = [...]` where the parent's `filter` has other keys.
Probably:

- Replace: replace the entire `filter` struct.
- Merge: shallow merge per key; inline keys override parent's.

This is its own sub-decision but the user's expectation will probably mirror
the list-field decision. Worth deciding both at once.

## Likely shape of resolution

**Option D (replace by default + explicit additive operators)** is the
current lean. It avoids silent merge surprises and gives a clean way to
express "everything from the parent plus this." But this is an open
question — the alternatives haven't been ruled out.

## What would resolve this

A short design pass during the sources-and-collections sub-PRD draft.
Probably needs a few example configs to test ergonomics.

## Related

- Inline-collections-on-devices principle (this is its load-bearing
  detail).
- Collection-extends-mechanism (same merge rules apply if `extends` is
  added later).

---
title: Config Migrations
description: How to create and test config file migrations for podkit
sidebar:
  order: 5
---

podkit uses a versioned config system to manage breaking changes to the config file format. When a new version of podkit introduces an incompatible config change, users run `podkit migrate` to update their config file automatically.

## Overview

The config file has a `version` field (a positive integer). Configs without a version field are treated as version 0 (pre-versioning era).

**Detection:** Every command reads the config version before loading the typed config. If the version is lower than `CURRENT_CONFIG_VERSION`, podkit exits with an error:

```
Your config file is at version 0, but podkit requires version 1.
Run 'podkit migrate' to update your config file.
```

**Migration:** `podkit migrate` reads the current version, lists pending migrations, runs them sequentially, backs up the original file, and writes the updated config.

**Raw TOML:** Migrations operate on raw TOML strings rather than typed config objects. This is intentional — if the config structure has changed incompatibly, a typed parser would fail before the migration could run.

## When a Migration is Needed

**Required** for:
- Breaking config restructures (renaming or removing sections)
- Breaking field changes (type changes, renames, removals)
- New required fields that must have a value

**Not required** for:
- New optional fields with defaults (existing configs work without them)
- Internal-only changes that don't affect the config file
- Documentation-only changes

## Creating a Migration

### 1. Increment the version constant

In `packages/podkit-cli/src/config/version.ts`, bump `CURRENT_CONFIG_VERSION`:

```typescript
export const CURRENT_CONFIG_VERSION = 2; // was 1
```

### 2. Create the migration file

Create `packages/podkit-cli/src/config/migrations/NNNN-description.ts` where `NNNN` is the zero-padded target version number. See `packages/podkit-cli/src/config/migrations/examples/` for templates.

A migration exports a `Migration` object:

```typescript
import type { Migration } from '../types.js';

export const migration0002: Migration = {
  fromVersion: 1,
  toVersion: 2,
  description: 'Brief description of what this migration does',
  type: 'automatic', // or 'interactive'
  async migrate(content: string, context): Promise<string> {
    // Transform the raw TOML string and return the result
    return content;
  },
};
```

### 3. Register the migration

Add the migration to `packages/podkit-cli/src/config/migrations/registry.ts`:

```typescript
import { migration0001 } from './0001-add-version.js';
import { migration0002 } from './0002-your-migration.js';

export const registry: Migration[] = [migration0001, migration0002];
```

### 4. Add tests

Create `packages/podkit-cli/src/config/migrations/NNNN-description.test.ts` with input/output TOML pairs. See the Testing section below.

## Migration Types

### Automatic migrations

Use `type: 'automatic'` for deterministic transformations that require no user input. The migration receives the raw TOML content and returns updated content:

```typescript
export const migration0002: Migration = {
  fromVersion: 1,
  toVersion: 2,
  description: 'Rename quality field to audioQuality',
  type: 'automatic',
  async migrate(content: string): Promise<string> {
    // Replace top-level `quality =` with `audioQuality =`
    // Use the TOML parser to be precise rather than regex
    return content.replace(/^quality\s*=/m, 'audioQuality =');
  },
};
```

### Interactive migrations

Use `type: 'interactive'` when the migration needs user input to make a decision. Use `context.prompt` to ask questions. If the user aborts (e.g., presses Ctrl+C or gives an invalid answer), throw `MigrationAbortError` — the command will exit without writing any changes.

```typescript
import type { Migration } from '../types.js';
import { MigrationAbortError } from '../types.js';

export const migration0003: Migration = {
  fromVersion: 2,
  toVersion: 3,
  description: 'Split collection into music and video',
  type: 'interactive',
  async migrate(content: string, context): Promise<string> {
    context.prompt.info('This migration splits your collection config.');

    const keepType = await context.prompt.choose('What type is your collection?', [
      { value: 'music', label: 'Music', description: 'Audio files' },
      { value: 'video', label: 'Video', description: 'Video files' },
    ]);

    // Transform content based on user's choice
    return content.replace('[collection.', `[${keepType}.`);
  },
};
```

## The Migration Context

The `MigrationContext` passed to each migration provides:

### `context.prompt` — User interaction

| Method | Description |
|--------|-------------|
| `confirm(message, default?)` | Yes/no question. Returns `true` for yes. |
| `choose(message, choices[])` | List selection. Returns the chosen value. |
| `text(message, default?)` | Free text input. Returns the entered string. |
| `info(message)` | Display an informational message (not a prompt). |
| `warn(message)` | Display a warning message. |

Only use `context.prompt` in `interactive` migrations. Automatic migrations should be fully deterministic.

### `context.fs` — Filesystem access

| Method | Description |
|--------|-------------|
| `exists(path)` | Check if a path exists |
| `readFile(path)` | Read a file's contents as UTF-8 |
| `readdir(path)` | List files in a directory (non-recursive) |
| `isDirectory(path)` | Check if a path is a directory |

Use `context.fs` when a migration needs to inspect the user's environment to make intelligent suggestions — for example, detecting existing directories to offer as defaults.

### `context.dryRun`

A boolean indicating whether `--dry-run` was passed. Migrations should respect this: skip writes and use `context.prompt.info()` to describe what would happen. The migration engine itself does not write the config in dry-run mode, but migrations that write other files (rare) must check this flag.

## Testing Migrations

Use `createTestContext` from `packages/podkit-cli/src/config/migrations/test-utils.ts` to create a mock context:

```typescript
import { describe, it, expect } from 'bun:test';
import { migration0002 } from './0002-your-migration.js';
import { createTestContext } from './test-utils.js';

describe('migration0002', () => {
  it('renames quality to audioQuality', async () => {
    const input = `
version = 1
quality = "high"
`.trimStart();

    const expected = `
version = 1
audioQuality = "high"
`.trimStart();

    const context = createTestContext();
    const result = await migration0002.migrate(input, context);
    expect(result).toBe(expected);
  });

  it('handles missing quality field gracefully', async () => {
    const input = `version = 1\n`;
    const context = createTestContext();
    const result = await migration0002.migrate(input, context);
    expect(result).toBe(input); // No change
  });
});
```

For interactive migrations, override the default prompt responses:

```typescript
const context = createTestContext({
  prompt: {
    choose: async () => 'music', // Always choose 'music'
    confirm: async () => false,   // Always say no
  },
});
```

Default values in `createTestContext`:
- `confirm` → returns `true`
- `choose` → returns the first choice
- `text` → returns `defaultValue` or `''`
- `info` / `warn` → no-ops
- `fs.exists` → returns `true`
- `fs.readFile` → returns `''`
- `fs.readdir` → returns `[]`
- `fs.isDirectory` → returns `false`

## Example Migrations

See `packages/podkit-cli/src/config/migrations/examples/` for complete, ready-to-use migration templates covering common patterns:

- Automatic field renames
- Section restructures
- Interactive migrations with user choices
- Migrations that use the filesystem context

The first real migration, `packages/podkit-cli/src/config/migrations/0001-add-version.ts`, is a good minimal example: it inserts a `version = 1` line into the config without disturbing the rest of the content.

## Tips

- **Always use the TOML parser for reads, not regex.** Regex can accidentally match fields inside TOML sections. Use `smol-toml` to parse and check specific fields, then use string operations to transform the content.
- **Test with input/output TOML pairs.** Write tests that supply a complete input config and assert the exact output. Edge cases (missing fields, empty configs, configs with comments) are important.
- **Handle the field-absent case.** If your migration renames a field that may not exist in all configs, handle the no-op case explicitly so existing configs that already use the new field are not broken.
- **Keep migrations focused.** Each migration should do one thing. Avoid combining multiple breaking changes in a single migration.
- **Preserve comments and formatting when possible.** Users may have comments in their config. String operations that insert or replace specific lines are preferable to full TOML serialize/deserialize cycles that strip comments.

## Key Files

| Purpose | Path |
|---------|------|
| Version constant | `packages/podkit-cli/src/config/version.ts` |
| Migration types | `packages/podkit-cli/src/config/migrations/types.ts` |
| Migration engine | `packages/podkit-cli/src/config/migrations/engine.ts` |
| Migration registry | `packages/podkit-cli/src/config/migrations/registry.ts` |
| Migrate command | `packages/podkit-cli/src/commands/migrate.ts` |
| Example migrations | `packages/podkit-cli/src/config/migrations/examples/` |
| Test utilities | `packages/podkit-cli/src/config/migrations/test-utils.ts` |

## See Also

- [Config File Reference](/reference/config-file) — Config schema and fields
- [CLI Commands](/reference/cli-commands) — `podkit migrate` command reference

---
title: Contributing
description: How to contribute to podkit development.
sidebar:
  order: 7
---

This guide covers how to contribute code, tests, and documentation to podkit.

## Getting Started

1. Fork and clone the repository
2. Follow the [Development Setup](/developers/development) guide to install dependencies
3. Run `bun run test` to verify your environment works

## Development Workflow

1. Create a branch for your change
2. Make your changes, following the conventions below
3. Build native tools: `mise run tools:build` (required for integration tests)
4. Run tests: `bun run test`
5. Run linting: `bun run lint`
6. Run type checking: `bun run typecheck`
7. Submit a pull request

## Code Conventions

- **TypeScript strict mode** is enabled across all packages
- **ESM modules** -- use `.js` extensions in imports (TypeScript resolves these)
- **Bun test runner** for all tests
- **Prettier** for formatting (`bun run format`)
- **oxlint** for linting (`bun run lint`)

## Monorepo Structure

podkit uses Bun workspaces with Turborepo for build orchestration. Each package under `packages/` is independently buildable and testable.

Key packages:

| Package | Purpose | Public API? |
|---------|---------|-------------|
| `podkit-cli` | CLI application | Yes (binary) |
| `podkit-core` | Core sync logic, adapters, transcoding | Yes (library) |
| `libgpod-node` | Native bindings for libgpod | Internal |
| `gpod-testing` | Test utilities | Internal |
| `e2e-tests` | End-to-end tests | Internal |

**Important:** Application code should use `IpodDatabase` from `@podkit/core`, not `@podkit/libgpod-node` directly. The libgpod-node package is an internal implementation detail.

## Writing Tests

See the [Testing](/developers/testing) guide for full details. Key points:

- Co-locate unit tests with source files (`foo.test.ts` next to `foo.ts`)
- Name integration tests `*.integration.test.ts`
- Use `@podkit/gpod-testing` for tests that need an iPod database
- Integration tests should fail early with clear messages when dependencies are missing

## Documentation

Documentation lives in `docs/` and is structured for [Starlight](https://starlight.astro.build/). All markdown files need frontmatter:

```yaml
---
title: Page Title
description: Brief description.
sidebar:
  order: N
---
```

When making code changes, update relevant docs if behavior changes. When you find docs that are incorrect or incomplete, fix them.

## Architecture Decision Records

For significant technical decisions, create an ADR in the [`docs/adr/`](https://github.com/jvgomg/podkit/tree/main/docs/adr) directory. See the [ADR index](https://github.com/jvgomg/podkit/blob/main/docs/adr/index.md) for the format and existing records.

## See Also

- [Development Setup](/developers/development) - Environment setup
- [Testing](/developers/testing) - Testing strategy
- [Architecture](/developers/architecture) - System design

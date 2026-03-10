---
title: "ADR-001: Runtime Choice"
description: Decision to use Bun for development and Node.js for distribution.
sidebar:
  order: 2
---

# ADR-001: Runtime Choice (Bun/Node)

## Status

**Proposed**

## Context

podkit needs a JavaScript/TypeScript runtime. The two main options are:

1. **Node.js** - Established runtime with mature ecosystem
2. **Bun** - Newer runtime with native TypeScript support and improved performance

The choice affects development workflow, dependency compatibility, and distribution.

## Decision Drivers

- Developer experience (TypeScript support, tooling)
- Native addon compatibility (for libgpod bindings)
- Cross-platform support
- Distribution simplicity
- Performance

## Options Considered

### Option A: Node.js Only

Develop and distribute using Node.js exclusively.

**Pros:**
- Maximum compatibility
- Mature native addon ecosystem (node-gyp, N-API)
- Well-tested cross-platform support
- Large community and documentation

**Cons:**
- Requires TypeScript compilation step
- Slower startup time
- Additional tooling needed (tsx, ts-node)

### Option B: Bun Only

Develop and distribute using Bun exclusively.

**Pros:**
- Native TypeScript support (no compilation)
- Faster startup and execution
- Built-in test runner, bundler
- Better developer experience

**Cons:**
- Less mature native addon support
- Not all npm packages compatible
- Smaller community
- Users must install Bun

### Option C: Bun for Development, Node for Distribution (Recommended)

Use Bun during development, compile to Node-compatible JavaScript for distribution.

**Pros:**
- Best developer experience (Bun)
- Maximum user compatibility (Node)
- Native addons work in both runtimes (N-API)
- Users can choose their runtime

**Cons:**
- Build step required for distribution
- Must test in both runtimes

## Decision

**Option C: Bun for development, Node for distribution**

### Rationale

1. **Development velocity** - Bun's native TypeScript and fast execution improve DX
2. **User flexibility** - Node.js remains more widely installed
3. **Native addon compatibility** - N-API works in both runtimes
4. **Future-proof** - As Bun matures, can shift more toward it

### Implementation

```json
// package.json
{
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "bun run src/main.ts",
    "build": "bun build src/main.ts --outdir dist --target node",
    "test": "bun test"
  }
}
```

## Consequences

### Positive

- Developers benefit from Bun's speed and TypeScript support
- Users can use either Node or Bun to run compiled output
- CI/CD can test both runtimes

### Negative

- Must maintain compatibility with both runtimes
- Native addons require testing in both environments
- Documentation must cover both usage patterns

### Risks

| Risk | Mitigation |
|------|------------|
| Bun breaks Node compatibility | Compile and test in Node during CI |
| Native addon issues in Bun | Use N-API stable ABI; fallback to Node |
| User confusion | Clear documentation on runtime options |

## Related Decisions

- [ADR-002](/developers/adr/adr-002-libgpod-binding): libgpod binding approach (N-API chosen for cross-runtime support)

## References

- [Bun Documentation](https://bun.sh/docs)
- [Node.js N-API Documentation](https://nodejs.org/api/n-api.html)
- [Bun Node.js Compatibility](https://bun.sh/docs/runtime/nodejs-apis)

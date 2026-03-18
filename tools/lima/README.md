# Lima VMs for Cross-Platform Testing

Lima VMs for testing podkit on Debian and Alpine Linux from macOS.

## Prerequisites

```bash
brew install lima
```

## Quick Start

```bash
# Create and start a VM (first run takes a few minutes to provision)
limactl start tools/lima/debian.yaml --name=podkit-debian
limactl start tools/lima/alpine.yaml --name=podkit-alpine

# Open a shell inside the VM
limactl shell podkit-debian

# Run tests (from inside the VM)
cd /path/to/podkit
bun install
bun run test
```

The macOS filesystem is mounted inside the VM, so you're working on the same files — no need to copy anything.

## VM Specs

| | Debian | Alpine |
|---|--------|--------|
| Base | Debian 12 (Bookworm) | Alpine 3.21 |
| Matches | Homebrew Linux users | Docker image |
| CPUs | 4 | 4 |
| Memory | 4 GiB | 4 GiB |
| Disk | 20 GiB | 20 GiB |

### Pre-installed

Both VMs include:
- Bun (primary test runner)
- Node.js 22 LTS
- FFmpeg
- libgpod-dev + GLib (for native addon compilation)
- Build tools (gcc, g++, make, python3, pkg-config)
- util-linux (`lsblk` for Linux device manager)
- git, curl

## Common Commands

```bash
# List VMs
limactl list

# Stop a VM (preserves state)
limactl stop podkit-debian

# Start a stopped VM
limactl start podkit-debian

# Delete a VM entirely
limactl delete podkit-debian

# Run a single command without entering a shell
limactl shell podkit-debian -- bash -c "cd /path/to/podkit && bun run test"
```

## Troubleshooting

### Native binary overwritten (macOS broken after VM tests)

Lima VMs share your macOS filesystem. Running `bun install` inside a VM recompiles the native `gpod_binding.node` for Linux, overwriting the macOS binary. Fix by rebuilding on macOS:

```bash
cd packages/libgpod-node
bun run build:native
```

### Native modules fail to build

The native addon (`libgpod-node`) compiles inside the VM. If `bun install` fails:

```bash
# Force rebuild native modules
bun install --force

# Or rebuild just the native addon
cd packages/libgpod-node
npx node-gyp rebuild
```

### Bun not available on Alpine

Bun's musl/Alpine support is experimental. If Bun fails to install, use Node.js:

```bash
# Install bun as a Node.js package
npm install -g bun

# Or run tests directly with node
npx bun test
```

### gpod-tool not built

Integration tests need the gpod-tool binary. Build it inside the VM:

```bash
# Requires mise (or build manually)
cd tools/gpod-tool
gcc -o gpod-tool gpod-tool.c $(pkg-config --cflags --libs libgpod-1.0 glib-2.0)
```

### Filesystem permissions

Lima mounts the macOS filesystem with the VM user's UID. If you see permission errors, ensure files are owned by your macOS user.

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

| | Debian | Alpine | Virtual iPod |
|---|--------|--------|--------------|
| Base | Debian 12 (Bookworm) | Alpine 3.21 | Debian 12 (Bookworm) |
| Purpose | Cross-platform testing | Docker image testing | Virtual iPod server |
| CPUs | 4 | 4 | 2 |
| Memory | 4 GiB | 4 GiB | 2 GiB |
| Disk | 20 GiB | 20 GiB | 20 GiB |

### Pre-installed

Both VMs include:
- Bun (primary test runner)
- Node.js 22 LTS
- FFmpeg
- libgpod-dev + GLib (for native addon compilation)
- Build tools (gcc, g++, make, python3, pkg-config)
- util-linux (`lsblk` for Linux device manager)
- git, curl

## Virtual iPod VM

The `virtual-ipod` VM provides a Linux environment with USB gadget support for the virtual iPod demo system.

### Quick Start

```bash
# Create the VM
limactl create --name=virtual-ipod tools/lima/virtual-ipod.yaml

# Start the VM
limactl start virtual-ipod

# Shell into the VM
limactl shell virtual-ipod

# Inside the VM: start the virtual iPod server
cd /path/to/podkit/packages/virtual-ipod-server
bun run start

# From macOS: the server is accessible at http://localhost:3456
```

### What's included

- Debian 12 Bookworm
- `dummy_hcd` and `libcomposite` kernel modules for USB gadget emulation
- configfs mounted at `/sys/kernel/config` (persisted in `/etc/fstab`)
- Node.js 22, Bun runtime
- libgpod-dev, FFmpeg, and all podkit build dependencies
- Port 3456 forwarded to host for virtual-ipod-server API
- 20 GiB disk for FAT32 iPod image and audio files

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

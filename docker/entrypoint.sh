#!/bin/bash
set -e

# =============================================================================
# podkit Docker entrypoint
#
# Follows LinuxServer.io conventions:
#   - PUID/PGID for file ownership
#   - TZ for timezone
#   - /config volume for persistent configuration
# =============================================================================

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# -----------------------------------------------------------------------------
# User setup
# -----------------------------------------------------------------------------

echo "
───────────────────────────────────────
  podkit
  $(podkit --version 2>/dev/null || echo "")
───────────────────────────────────────
  User UID: ${PUID}
  User GID: ${PGID}
───────────────────────────────────────
"

# Create group and user with specified PUID/PGID
# Uses shadow's groupadd/useradd for -o (non-unique) support
groupadd -o -g "$PGID" podkit 2>/dev/null || true
useradd -o -u "$PUID" -g podkit -d /config -s /bin/bash podkit 2>/dev/null || true

# Ensure ownership of writable directories
chown podkit:podkit /config
chown podkit:podkit /ipod 2>/dev/null || true

# -----------------------------------------------------------------------------
# Command handling
# -----------------------------------------------------------------------------

# List of known podkit subcommands
PODKIT_COMMANDS="sync device collection init eject mount unmount completions"

# Check if the first argument is a podkit subcommand
is_podkit_command() {
  local cmd="$1"
  for known in $PODKIT_COMMANDS; do
    if [ "$cmd" = "$known" ]; then
      return 0
    fi
  done
  return 1
}

if is_podkit_command "${1:-}"; then
  # Handle 'init' command: pass through with Docker-appropriate defaults
  if [ "$1" = "init" ]; then
    shift
    # Default to /config/config.toml if --path not specified
    HAS_PATH=false
    for arg in "$@"; do
      case "$arg" in
        --path) HAS_PATH=true ;;
      esac
    done

    if [ "$HAS_PATH" = "false" ]; then
      set -- init --path /config/config.toml "$@"
    else
      set -- init "$@"
    fi
    exec su-exec podkit podkit "$@"
  fi

  # Handle 'sync' command: inject --device /ipod if not specified
  if [ "$1" = "sync" ]; then
    HAS_DEVICE=false
    for arg in "$@"; do
      case "$arg" in
        --device|-d) HAS_DEVICE=true ;;
      esac
    done

    if [ "$HAS_DEVICE" = "false" ]; then
      set -- podkit "$@" --device /ipod
    else
      set -- podkit "$@"
    fi
    exec su-exec podkit "$@"
  fi

  # All other podkit commands: pass through directly
  exec su-exec podkit podkit "$@"
fi

# If the first argument is 'podkit' itself, pass everything through
if [ "${1:-}" = "podkit" ]; then
  exec su-exec podkit "$@"
fi

# Otherwise, treat as a raw command (e.g., /bin/bash for debugging)
exec "$@"

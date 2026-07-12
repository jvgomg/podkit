#!/usr/bin/env bats
#
# Integration-depth shell-level tests for the podkit Docker entrypoint.
# (doc-053 rollout stage 2; canonical taxonomy: documents/architecture/testing/taxonomy.md)
#
# The real entrypoint shells out to external binaries (`podkit`, `su-exec`,
# `podkit-daemon`, `groupadd`, `useradd`, `chown`). We never run a real
# container or sync: instead each test prepends a directory of fake binaries to
# PATH. The fakes echo their argv, so the process the entrypoint finally `exec`s
# reveals the routing/injection/privilege decision, and the user-setup fakes log
# their args so PUID/PGID handling is observable.

setup() {
  ENTRYPOINT="${BATS_TEST_DIRNAME}/../entrypoint.sh"
  STUBS="${BATS_TEST_TMPDIR}/bin"
  export CALL_LOG="${BATS_TEST_TMPDIR}/calls.log"
  mkdir -p "$STUBS"
  : > "$CALL_LOG"

  # podkit: answers --version, the entrypoint's command-list probe and the
  # device-access probe; echoes anything else (so a stray direct invocation is
  # visible).
  cat > "$STUBS/podkit" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "podkit 0.0.0-test"; exit 0; fi
if [ "$1" = "__complete" ] && [ "$2" = "commands" ]; then
  printf '%s\n' init migrate sync device collection eject unmount mount doctor completions
  exit 0
fi
if [ "$1" = "__container-probe" ]; then echo "Device access:"; exit 0; fi
echo "PODKIT $*"
EOF

  # su-exec: the privilege-drop wrapper. Echo its argv instead of dropping +
  # exec'ing, so the test sees exactly what would have run as the podkit user.
  cat > "$STUBS/su-exec" <<'EOF'
#!/usr/bin/env bash
echo "EXEC su-exec $*"
EOF

  # podkit-daemon: the daemon binary, exec'd directly (as root) — no su-exec.
  cat > "$STUBS/podkit-daemon" <<'EOF'
#!/usr/bin/env bash
echo "EXEC podkit-daemon $*"
EOF

  # User-setup tools: record their args so PUID/PGID + ownership is assertable.
  # chown has no `|| true` in the entrypoint, so the stub must exit 0.
  for tool in groupadd useradd chown; do
    cat > "$STUBS/$tool" <<EOF
#!/usr/bin/env bash
echo "$tool \$*" >> "$CALL_LOG"
EOF
  done

  # A non-podkit "raw" command for the passthrough branch.
  cat > "$STUBS/rawtool" <<'EOF'
#!/usr/bin/env bash
echo "RAW rawtool $*"
EOF

  chmod +x "$STUBS"/*
  PATH="$STUBS:$PATH"
}

run_entrypoint() {
  run bash "$ENTRYPOINT" "$@"
}

# Substring assertions as functions, NOT inline `[[ ]]`: on bash 3.2 (macOS)
# a failing `[[ ]]` compound command does not trigger bats' errexit unless it
# is the test's last command, silently turning every earlier assertion into a
# no-op. A failing function call always triggers it, and these also print the
# haystack on failure.
assert_contains() {
  case "$1" in
    *"$2"*) return 0 ;;
  esac
  echo "expected output to contain: $2" >&2
  echo "actual output:" >&2
  echo "$1" >&2
  return 1
}

assert_not_contains() {
  case "$1" in
    *"$2"*)
      echo "expected output NOT to contain: $2" >&2
      echo "actual output:" >&2
      echo "$1" >&2
      return 1
      ;;
  esac
  return 0
}

# ── AC#1: command routing ───────────────────────────────────────────────────

@test "routes a known subcommand to the podkit binary under su-exec" {
  run_entrypoint doctor
  [ "$status" -eq 0 ]
  assert_contains "$output" "EXEC su-exec podkit podkit doctor"
}

@test "passes a bare 'podkit' invocation through under su-exec" {
  run_entrypoint podkit device scan
  [ "$status" -eq 0 ]
  # `exec su-exec podkit "$@"` with "$@" == "podkit device scan" → su-exec runs
  # the podkit user, then the podkit binary with `device scan`.
  assert_contains "$output" "EXEC su-exec podkit podkit device scan"
}

@test "treats an unknown first argument as a raw command" {
  run_entrypoint rawtool --flag
  [ "$status" -eq 0 ]
  assert_contains "$output" "RAW rawtool --flag"
  assert_not_contains "$output" "su-exec"
}

# ── AC#2: command-parity (would have caught the `doctor` blocker) ────────────

@test "every command the CLI advertises is recognised (not treated as raw)" {
  # Derive the expectation from the SAME source the entrypoint uses
  # (`podkit __complete commands`), so this asserts true parity: every command
  # the CLI advertises must route, not a list hand-maintained alongside it.
  local cmds
  cmds="$(podkit __complete commands)"
  [ -n "$cmds" ]
  for cmd in $cmds; do
    run_entrypoint "$cmd"
    [ "$status" -eq 0 ]
    # Recognised commands route through su-exec (init/sync/other) — none should
    # fall through to the raw-exec branch, which would try to exec the command
    # name directly and emit no EXEC marker.
    assert_contains "$output" "EXEC su-exec" || {
      echo "command '$cmd' was not recognised by the entrypoint" >&2
      false
    }
  done
}

@test "doctor specifically is recognised (regression for the original blocker)" {
  run_entrypoint doctor
  [ "$status" -eq 0 ]
  assert_contains "$output" "EXEC su-exec podkit podkit doctor"
}

@test "falls back to the built-in command list when the CLI probe fails" {
  # Degraded path (entrypoint.sh): `podkit __complete commands` returns nothing.
  # Routing must still work (doctor → su-exec) and a warning must hit stderr,
  # rather than every command silently falling through to the raw shell.
  cat > "$STUBS/podkit" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "podkit 0.0.0-test"; exit 0; fi
if [ "$1" = "__complete" ] && [ "$2" = "commands" ]; then exit 1; fi
echo "PODKIT $*"
EOF
  chmod +x "$STUBS/podkit"

  run_entrypoint doctor
  [ "$status" -eq 0 ]
  assert_contains "$output" "EXEC su-exec podkit podkit doctor"
  assert_contains "$output" "WARNING"
}

# ── AC#3: PUID/PGID user/group creation + ownership ─────────────────────────

@test "creates group/user from PUID/PGID and chowns /config" {
  PUID=1234 PGID=5678 run_entrypoint doctor
  [ "$status" -eq 0 ]
  run cat "$CALL_LOG"
  assert_contains "$output" "groupadd -o -g 5678 podkit"
  assert_contains "$output" "useradd -o -u 1234 -g podkit"
  assert_contains "$output" "chown podkit:podkit /config"
}

@test "defaults PUID/PGID to 1000 when unset" {
  unset PUID PGID
  run_entrypoint doctor
  [ "$status" -eq 0 ]
  run cat "$CALL_LOG"
  assert_contains "$output" "groupadd -o -g 1000 podkit"
  assert_contains "$output" "useradd -o -u 1000 -g podkit"
}

# ── AC#4: argument injection ────────────────────────────────────────────────

@test "sync injects --device /ipod when none is given" {
  run_entrypoint sync
  [ "$status" -eq 0 ]
  assert_contains "$output" "EXEC su-exec podkit podkit sync --device /ipod"
}

@test "sync does not override an explicit --device" {
  run_entrypoint sync --device /dev/sdb
  [ "$status" -eq 0 ]
  assert_contains "$output" "EXEC su-exec"
  assert_contains "$output" "--device /dev/sdb"
  assert_not_contains "$output" "/ipod"
}

@test "sync recognises the -d shorthand and does not inject /ipod" {
  run_entrypoint sync -d /dev/sdb
  [ "$status" -eq 0 ]
  assert_contains "$output" "EXEC su-exec"
  assert_contains "$output" "-d /dev/sdb"
  assert_not_contains "$output" "/ipod"
}

@test "sync recognises the --device=VALUE combined form and does not inject /ipod" {
  run_entrypoint sync --device=/dev/sdb
  [ "$status" -eq 0 ]
  assert_contains "$output" "--device=/dev/sdb"
  assert_not_contains "$output" "/ipod"
}

@test "init injects --path /config/config.toml when none is given" {
  run_entrypoint init
  [ "$status" -eq 0 ]
  assert_contains "$output" "EXEC su-exec podkit podkit init --path /config/config.toml"
}

@test "init does not override an explicit --path" {
  run_entrypoint init --path /tmp/custom.toml
  [ "$status" -eq 0 ]
  assert_contains "$output" "EXEC su-exec"
  assert_contains "$output" "--path /tmp/custom.toml"
  assert_not_contains "$output" "/config/config.toml"
}

@test "init recognises the --path=VALUE combined form and does not inject the default" {
  run_entrypoint init --path=/tmp/custom.toml
  [ "$status" -eq 0 ]
  assert_contains "$output" "--path=/tmp/custom.toml"
  assert_not_contains "$output" "/config/config.toml"
}

# ── AC#5: privilege — su-exec for one-shot, root for daemon ──────────────────

@test "daemon runs as root (no su-exec wrapper)" {
  run_entrypoint daemon
  [ "$status" -eq 0 ]
  assert_contains "$output" "EXEC podkit-daemon"
  assert_not_contains "$output" "su-exec"
}

@test "one-shot commands drop privileges via su-exec" {
  run_entrypoint sync
  [ "$status" -eq 0 ]
  assert_contains "$output" "EXEC su-exec"
}

# ── device-access probe at startup ───────────────────────────────────────────

@test "startup surfaces the device-access report before routing" {
  run_entrypoint doctor
  [ "$status" -eq 0 ]
  assert_contains "$output" "Device access:"
  assert_contains "$output" "EXEC su-exec podkit podkit doctor"
}

@test "device-access probe runs for daemon startups too" {
  run_entrypoint daemon
  [ "$status" -eq 0 ]
  assert_contains "$output" "Device access:"
  assert_contains "$output" "EXEC podkit-daemon"
}

@test "a failing probe never blocks startup" {
  # Replace the podkit stub with one whose probe explodes; routing must survive.
  cat > "$STUBS/podkit" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "podkit 0.0.0-test"; exit 0; fi
if [ "$1" = "__complete" ] && [ "$2" = "commands" ]; then
  printf '%s\n' init migrate sync device collection eject unmount mount doctor completions
  exit 0
fi
if [ "$1" = "__container-probe" ]; then echo "probe exploded" >&2; exit 1; fi
echo "PODKIT $*"
EOF
  chmod +x "$STUBS/podkit"
  run_entrypoint doctor
  [ "$status" -eq 0 ]
  assert_contains "$output" "EXEC su-exec podkit podkit doctor"
}

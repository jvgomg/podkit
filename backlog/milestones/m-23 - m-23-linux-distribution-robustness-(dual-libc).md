---
id: m-23
title: "m-23: Linux Distribution Robustness (dual-libc)"
---

## Description

Ship the correct libc binary to each Linux channel (glibc → Homebrew/Debian, musl → Alpine/Docker), guarantee our native dependencies are statically linked (never dynamically linked against the host), fix the prebuild cross-contamination (TASK-468), and smoke-test the real binary on both Debian and Alpine. Supersedes the current musl-only release, which is broken for glibc Homebrew users.

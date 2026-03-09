---
id: TASK-078
title: Add secure credential storage (system keychain)
status: To Do
assignee: []
created_date: '2026-03-09 21:40'
labels:
  - enhancement
  - security
  - ux
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently Subsonic passwords can be stored in config files (plaintext) or environment variables. Add support for secure credential storage using system keychains:

- **macOS**: Keychain Access
- **Linux**: libsecret / GNOME Keyring / KWallet
- **Windows**: Windows Credential Manager

### User Experience

1. When password is missing from config/env, prompt interactively
2. After successful connection, offer to save to keychain
3. On subsequent runs, retrieve from keychain automatically

### Implementation Options

- `keytar` package (Electron-maintained, battle-tested)
- Native Node.js APIs if available in future Node versions
- `node-keychain` for macOS-only (simpler if Linux/Windows not needed)

### Priority Resolution Order (proposed)

1. Config file `password` field (explicit override)
2. Environment variable `PODKIT_MUSIC_{NAME}_PASSWORD`
3. System keychain
4. Interactive prompt (with option to save)

### References

- [keytar npm package](https://www.npmjs.com/package/keytar)
- [libsecret](https://wiki.gnome.org/Projects/Libsecret)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Password can be stored in and retrieved from system keychain
- [ ] #2 Interactive prompt when password is missing
- [ ] #3 Option to save password to keychain after successful connection
- [ ] #4 Works on macOS (primary target)
- [ ] #5 Graceful fallback if keychain unavailable
<!-- AC:END -->

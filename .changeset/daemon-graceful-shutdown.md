---
"@podkit/daemon": patch
---

Improve daemon graceful shutdown: forward SIGINT to the sync child process on SIGTERM so it drains and saves within Docker's 10-second timeout, instead of waiting for the full sync to complete.

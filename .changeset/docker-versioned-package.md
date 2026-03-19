---
"@podkit/docker": minor
"@podkit/daemon": minor
---

Add versioned Docker distribution package with independent release support. Docker image is now tagged with its own version number, and daemon gets proper versioning. Component versions are inspectable via OCI labels and `/usr/local/share/podkit-versions.json` inside the container.

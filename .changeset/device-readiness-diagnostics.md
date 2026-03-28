---
"@podkit/core": minor
---

Add device readiness diagnostic system

- New 6-stage readiness pipeline (USB → Partition → Filesystem → Mount → SysInfo → Database) that checks every stage of device health
- OS error code interpreter translates errno values into actionable explanations
- USB discovery finds iPods even without disk representation (unpartitioned/uninitialized devices)
- Enhanced SysInfo validation detects missing, corrupt, or unrecognized model files
- Diagnostics framework now handles missing database gracefully (checks skip instead of crashing)

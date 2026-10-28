---
'@podkit/libgpod-node': patch
'@podkit/devices-ipod': patch
'podkit': patch
---

podkit's libgpod build now signs iPod nano 6th and 7th generation databases itself, instead of needing an external `hashab` module. Signing alone does not make them writable: the nano 7th generation shows no music from a library written this way, although its signatures are valid, so both stay read-only with this change. Their support notes and unsupported-device messages now say so, instead of naming the missing module.

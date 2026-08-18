---
'@podkit/devices-ipod': patch
'@podkit/core': patch
'podkit': patch
---

Correct the FamilyID → generation table from real hardware.

FamilyID 12 is the iPod nano 3G, not the iPod touch 1G. An affected nano — one whose serial suffix is not in the serial table, so the FamilyID axis decides — was refused by `podkit sync` with a message claiming it used Apple's proprietary sync protocol, and that refusal could not be overridden. It now resolves as a syncable nano 3G.

FamilyID 17 is the iPod nano 6G, not the iPod Classic 7G — read from firmware on a connected nano 6G. This one pointed the wrong way round: the Classic 7G is syncable and the nano 6G is not, so a nano 6G whose serial suffix was unmapped would have been treated as a device podkit could write to. The Classic 7G's FamilyID is simply unknown and is no longer guessed.

Also corrected: the shuffle band now carries its hardware values (130 → shuffle 2G, 132 → shuffle 3G, 133 → shuffle 4G), replacing four research guesses that had placed shuffles among the click-wheel FamilyIDs. Every iPod touch entry is removed — an iOS device has no disk mode and never emits the SysInfoExtended those values would have to come from, so they were unobtainable by construction; touches continue to be recognised and refused by USB product ID. The iPod shuffle 3G's support record is promoted from `inferred` to hardware-verified.

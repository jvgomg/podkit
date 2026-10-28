---
"podkit": patch
"@podkit/core": patch
---

Keep video within the device's H.264 profile and level

A video was copied to the iPod untouched when its container, codec, profile and resolution fit, without looking at its H.264 level, and the video sync path did not pass the probed profile, level, bitrate or frame rate to that check at all. A level above the device's (3.0 for the 320x240 iPods, 3.1 for the Classic) or an unknown level now means the file is transcoded, and the probed bitrate and frame rate limits apply too. When the profile is reported, only Baseline, and Main on the Classic, is copied; any other profile, such as High 10, is transcoded. The macOS VideoToolbox encoder is now given the level constraint as well as the profile.

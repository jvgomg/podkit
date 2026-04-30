---
"@podkit/core": minor
---

Add capability adapter and fix iPod generation metadata

- Add `createIpodCapabilities()` adapter — maps libgpod device data to core `DeviceCapabilities`, using libgpod as authority for video/artwork support and supplementing codec support from generation metadata
- Add `toLibgpodGeneration()` mapping from detection-layer IDs (`nano_4g`) to libgpod IDs (`nano_4`)
- Fix artwork resolution: nano 3G→320, nano 4-6G→240, photo→320 (were all incorrectly 176)
- Fix ALAC support: add to 4th gen, Photo, Mini 2G, Touch 1-4, iPhone 1-4, iPad 1
- Add video profiles for Touch, iPhone, and iPad generations (were missing, preventing video sync)

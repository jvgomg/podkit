---
"podkit": minor
---

`podkit device info` now distinguishes the "device firmware can play" codec list from the "podkit will write" list on mass-storage devices. When the two disagree (e.g. rockbox declares `wav`/`aiff` but podkit transcodes them before transfer), the capabilities block expands into a `Firmware:` / `Podkit:` sub-block with the gap codecs annotated as transcoded:

```
Capabilities:
  Audio Codecs:
    Firmware:   aac, alac, mp3, flac, vorbis, opus, wav, aiff
    Podkit:     aac, alac, mp3, flac, vorbis, opus
                (wav, aiff transcoded before transfer)
```

When the two lists agree (echo-mini, generic), the existing single `Audio Codecs:` line is preserved. JSON output gains a `status.massStorageCapabilities.firmwareSupportedAudioCodecs` field, omitted when there is no diff (absence signals the two views are equal). iPod output is unchanged.

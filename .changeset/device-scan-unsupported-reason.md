---
"podkit": minor
---

`podkit device scan --format json`: rename `notSupportedReason: string` to `unsupportedReason: ReadinessUnsupportedReason` on USB-only device entries

The JSON envelope for `device scan` previously carried unsupported-device
diagnostics as a bare `notSupportedReason` string. It now matches the structured
`ReadinessUnsupportedReason` shape already used by the readiness pipeline and
`IpodModel.unsupportedReason`:

```json
{
  "unsupportedReason": {
    "kind": "ios-device",
    "headline": "iPod Touch is not supported by podkit.",
    "docsUrl": "https://jvgomg.github.io/podkit/devices/supported-devices/"
  }
}
```

Consumers reading `device.notSupportedReason` should read
`device.unsupportedReason.headline` instead — the same string, just nested
under the typed payload. The change applies to both USB-only iPod entries
(touch, iPhone, iPad, nano 6G/7G, shuffle 3G/4G) and to vendor-recognised
mass-storage devices with no matching preset.

The same rename also lands on the internal `IpodIdentity` and
`IpodClassification` shapes, but those are not part of the public CLI surface.

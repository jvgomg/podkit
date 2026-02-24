{
  "targets": [
    {
      "target_name": "gpod_binding",
      "sources": [
        "native/gpod_binding.cc",
        "native/gpod_helpers.cc",
        "native/gpod_converters.cc",
        "native/database_wrapper.cc",
        "native/track_operations.cc",
        "native/artwork_operations.cc",
        "native/playlist_operations.cc",
        "native/photo_database_wrapper.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_CFLAGS": [
              "<!@(PKG_CONFIG_PATH=$HOME/.local/lib/pkgconfig:$PKG_CONFIG_PATH pkg-config --cflags libgpod-1.0 glib-2.0)"
            ],
            "OTHER_LDFLAGS": [
              "<!@(PKG_CONFIG_PATH=$HOME/.local/lib/pkgconfig:$PKG_CONFIG_PATH pkg-config --libs libgpod-1.0 glib-2.0)"
            ]
          }
        }],
        ["OS=='linux'", {
          "cflags": [
            "<!@(pkg-config --cflags libgpod-1.0 glib-2.0)"
          ],
          "ldflags": [
            "<!@(pkg-config --libs libgpod-1.0 glib-2.0)"
          ],
          "libraries": [
            "<!@(pkg-config --libs libgpod-1.0 glib-2.0)"
          ]
        }]
      ]
    }
  ]
}

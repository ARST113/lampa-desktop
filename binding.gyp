{
  "variables": {
    "gst_root%": "C:/gstreamer/1.0/msvc_x86_64"
  },
  "targets": [
    {
      "target_name": "lampa_dts_gst",
      "sources": [
        "src/native/dts-gst.cc"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "include_dirs": [
              "<(gst_root)/include/gstreamer-1.0",
              "<(gst_root)/include/glib-2.0",
              "<(gst_root)/lib/glib-2.0/include",
              "<(gst_root)/lib/gstreamer-1.0/include"
            ],
            "libraries": [
              "<(gst_root)/lib/gstreamer-1.0.lib",
              "<(gst_root)/lib/gstapp-1.0.lib",
              "<(gst_root)/lib/gobject-2.0.lib",
              "<(gst_root)/lib/glib-2.0.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": [
                  "/std:c++17"
                ]
              }
            }
          }
        ],
        [
          "OS!='win'",
          {
            "cflags_cc": [
              "-std=c++17",
              "<!@(pkg-config --cflags gstreamer-1.0 gstreamer-app-1.0)"
            ],
            "libraries": [
              "<!@(pkg-config --libs gstreamer-1.0 gstreamer-app-1.0)"
            ],
            "include_dirs": [
              "<!(pkg-config --variable=includedir gstreamer-1.0)/gstreamer-1.0",
              "<!(pkg-config --variable=includedir glib-2.0)/glib-2.0",
              "<!(pkg-config --variable=libdir glib-2.0)/glib-2.0/include"
            ]
          }
        ]
      ]
    }
  ]
}

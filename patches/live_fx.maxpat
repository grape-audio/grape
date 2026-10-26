{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 8,
      "minor": 6,
      "revision": 5,
      "architecture": "x64",
      "modernui": 1
    },
    "classnamespace": "box",
    "rect": [
      34.0,
      87.0,
      1000.0,
      700.0
    ],
    "bglocked": 0,
    "openinpresentation": 1,
    "default_fontsize": 12.0,
    "default_fontface": 0,
    "default_fontname": "Arial",
    "gridonopen": 1,
    "gridsize": [
      15.0,
      15.0
    ],
    "gridsnaponopen": 1,
    "objectsnaponopen": 1,
    "statusbarvisible": 2,
    "toolbarvisible": 1,
    "boxanimatetime": 200,
    "enablehscroll": 1,
    "enablevscroll": 1,
    "devicewidth": 0.0,
    "description": "",
    "digest": "",
    "tags": "",
    "style": "",
    "subpatcher_template": "",
    "assistshowspatchername": 0,
    "boxes": [
      {
        "box": {
          "maxclass": "comment",
          "text": "LIVE FX",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            900,
            20,
            200,
            27
          ],
          "fontsize": 18.0,
          "id": "obj-1",
          "presentation": 1,
          "presentation_rect": [
            10,
            6,
            360,
            27
          ]
        }
      },
      {
        "box": {
          "maxclass": "panel",
          "numinlets": 1,
          "numoutlets": 0,
          "angle": 270.0,
          "background": 1,
          "bgcolor": [
            0.86,
            0.35,
            0.33,
            0.55
          ],
          "mode": 0,
          "proportion": 0.5,
          "patching_rect": [
            900,
            60,
            370,
            46
          ],
          "id": "obj-2",
          "presentation": 1,
          "presentation_rect": [
            8,
            38,
            370,
            46
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "USA LE CUFFIE (meglio con il filo). Controlla i livelli prima di indossarle.",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            905,
            64,
            360,
            40
          ],
          "linecount": 2,
          "id": "obj-3",
          "presentation": 1,
          "presentation_rect": [
            14,
            42,
            360,
            40
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "1. Tocca l'altoparlante per accendere l'audio.\n2. Alza Input e suona: la sua barra verde si deve muovere.\n3. Alza Dry e il Livello di almeno un effetto.\n4. Alza il volume delle Cuffie: in cuffia senti solo gli effetti.\n5. REC registra, STOP salva il file MP3 (almeno 30 secondi).",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            900,
            120,
            370,
            80
          ],
          "linecount": 5,
          "id": "obj-4",
          "presentation": 1,
          "presentation_rect": [
            10,
            92,
            370,
            80
          ]
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "adc~ 1",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            20,
            20,
            60,
            22
          ],
          "id": "obj-5"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "limi~ @threshold -3",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            20,
            55,
            120,
            22
          ],
          "id": "obj-6"
        }
      },
      {
        "box": {
          "maxclass": "live.gain~",
          "channels": 1,
          "lastchannelcount": 0,
          "numinlets": 1,
          "numoutlets": 4,
          "outlettype": [
            "signal",
            "",
            "float",
            "list"
          ],
          "parameter_enable": 1,
          "patching_rect": [
            20,
            90,
            48,
            136
          ],
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Input Level",
              "parameter_mmax": 0.0,
              "parameter_mmin": -70.0,
              "parameter_modmode": 3,
              "parameter_shortname": "Input",
              "parameter_type": 0,
              "parameter_unitstyle": 4
            }
          },
          "varname": "Input Level",
          "id": "obj-7",
          "presentation": 1,
          "presentation_rect": [
            10,
            236,
            48,
            136
          ]
        }
      },
      {
        "box": {
          "maxclass": "live.gain~",
          "channels": 1,
          "lastchannelcount": 0,
          "numinlets": 1,
          "numoutlets": 4,
          "outlettype": [
            "signal",
            "",
            "float",
            "list"
          ],
          "parameter_enable": 1,
          "patching_rect": [
            20,
            270,
            48,
            136
          ],
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                -70
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Dry Level",
              "parameter_mmax": 0.0,
              "parameter_mmin": -70.0,
              "parameter_modmode": 3,
              "parameter_shortname": "Dry",
              "parameter_type": 0,
              "parameter_unitstyle": 4
            }
          },
          "varname": "Dry Level",
          "id": "obj-8",
          "presentation": 1,
          "presentation_rect": [
            102,
            236,
            48,
            136
          ]
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "cverb~ 5000",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            120,
            305,
            80,
            22
          ],
          "id": "obj-9"
        }
      },
      {
        "box": {
          "maxclass": "panel",
          "numinlets": 1,
          "numoutlets": 0,
          "angle": 270.0,
          "background": 1,
          "bgcolor": [
            0.55,
            0.7,
            0.9,
            0.35
          ],
          "mode": 0,
          "proportion": 0.5,
          "patching_rect": [
            900,
            600,
            180,
            160
          ],
          "id": "obj-10",
          "presentation": 1,
          "presentation_rect": [
            8,
            420,
            180,
            160
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "RIVERBERO",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            900,
            760,
            160,
            20
          ],
          "fontsize": 13.0,
          "id": "obj-11",
          "presentation": 1,
          "presentation_rect": [
            14,
            423,
            160,
            20
          ]
        }
      },
      {
        "box": {
          "maxclass": "live.gain~",
          "channels": 1,
          "lastchannelcount": 0,
          "numinlets": 1,
          "numoutlets": 4,
          "outlettype": [
            "signal",
            "",
            "float",
            "list"
          ],
          "parameter_enable": 1,
          "patching_rect": [
            120,
            340,
            48,
            136
          ],
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                -70
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Reverb Level",
              "parameter_mmax": -3.0,
              "parameter_mmin": -70.0,
              "parameter_modmode": 3,
              "parameter_shortname": "Livello",
              "parameter_type": 0,
              "parameter_unitstyle": 4
            }
          },
          "varname": "Reverb Level",
          "id": "obj-12",
          "presentation": 1,
          "presentation_rect": [
            14,
            442,
            48,
            136
          ]
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "loadmess 99",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            200,
            160,
            80,
            22
          ],
          "id": "obj-13"
        }
      },
      {
        "box": {
          "maxclass": "dial",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "float"
          ],
          "parameter_enable": 0,
          "size": 500,
          "min": 10,
          "mult": 10,
          "patching_rect": [
            200,
            190,
            40,
            40
          ],
          "id": "obj-14",
          "presentation": 1,
          "presentation_rect": [
            78,
            476,
            40,
            40
          ]
        }
      },
      {
        "box": {
          "maxclass": "number",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "",
            "bang"
          ],
          "parameter_enable": 0,
          "patching_rect": [
            245,
            199,
            50,
            22
          ],
          "id": "obj-15",
          "presentation": 1,
          "presentation_rect": [
            122,
            485,
            56,
            22
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "tempo (ms)",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            900,
            210,
            80,
            20
          ],
          "id": "obj-16",
          "presentation": 1,
          "presentation_rect": [
            78,
            520,
            100,
            20
          ]
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "pitchshift~ 1 @quality best",
          "numinlets": 2,
          "numoutlets": 2,
          "outlettype": [
            "signal",
            ""
          ],
          "patching_rect": [
            320,
            305,
            170,
            22
          ],
          "id": "obj-17"
        }
      },
      {
        "box": {
          "maxclass": "panel",
          "numinlets": 1,
          "numoutlets": 0,
          "angle": 270.0,
          "background": 1,
          "bgcolor": [
            0.55,
            0.85,
            0.6,
            0.35
          ],
          "mode": 0,
          "proportion": 0.5,
          "patching_rect": [
            1100,
            600,
            180,
            160
          ],
          "id": "obj-18",
          "presentation": 1,
          "presentation_rect": [
            196,
            420,
            180,
            160
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "PITCH SHIFT",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            1100,
            760,
            160,
            20
          ],
          "fontsize": 13.0,
          "id": "obj-19",
          "presentation": 1,
          "presentation_rect": [
            202,
            423,
            160,
            20
          ]
        }
      },
      {
        "box": {
          "maxclass": "live.gain~",
          "channels": 1,
          "lastchannelcount": 0,
          "numinlets": 1,
          "numoutlets": 4,
          "outlettype": [
            "signal",
            "",
            "float",
            "list"
          ],
          "parameter_enable": 1,
          "patching_rect": [
            320,
            340,
            48,
            136
          ],
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                -70
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Pitchshift Level",
              "parameter_mmax": 0.0,
              "parameter_mmin": -70.0,
              "parameter_modmode": 3,
              "parameter_shortname": "Livello",
              "parameter_type": 0,
              "parameter_unitstyle": 4
            }
          },
          "varname": "Pitchshift Level",
          "id": "obj-20",
          "presentation": 1,
          "presentation_rect": [
            202,
            442,
            48,
            136
          ]
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "loadmess 24",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            320,
            160,
            80,
            22
          ],
          "id": "obj-21"
        }
      },
      {
        "box": {
          "maxclass": "dial",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "float"
          ],
          "parameter_enable": 0,
          "size": 49,
          "min": -24,
          "mult": 1,
          "patching_rect": [
            320,
            190,
            40,
            40
          ],
          "id": "obj-22",
          "presentation": 1,
          "presentation_rect": [
            266,
            476,
            40,
            40
          ]
        }
      },
      {
        "box": {
          "maxclass": "number",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "",
            "bang"
          ],
          "parameter_enable": 0,
          "patching_rect": [
            365,
            199,
            50,
            22
          ],
          "id": "obj-23",
          "presentation": 1,
          "presentation_rect": [
            310,
            485,
            56,
            22
          ]
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "* 100",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "int"
          ],
          "patching_rect": [
            320,
            240,
            50,
            22
          ],
          "id": "obj-24"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "text": "pitchshiftcent $1",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            320,
            270,
            110,
            22
          ],
          "id": "obj-25"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "semitoni",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            900,
            240,
            80,
            20
          ],
          "id": "obj-26",
          "presentation": 1,
          "presentation_rect": [
            266,
            520,
            100,
            20
          ]
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "tapin~ 2000",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "tapconnect"
          ],
          "patching_rect": [
            540,
            270,
            80,
            22
          ],
          "id": "obj-27"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "tapout~ 250",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            540,
            305,
            80,
            22
          ],
          "id": "obj-28"
        }
      },
      {
        "box": {
          "maxclass": "panel",
          "numinlets": 1,
          "numoutlets": 0,
          "angle": 270.0,
          "background": 1,
          "bgcolor": [
            0.95,
            0.7,
            0.45,
            0.35
          ],
          "mode": 0,
          "proportion": 0.5,
          "patching_rect": [
            900,
            800,
            368,
            160
          ],
          "id": "obj-29",
          "presentation": 1,
          "presentation_rect": [
            8,
            590,
            368,
            160
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "DELAY",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            900,
            960,
            160,
            20
          ],
          "fontsize": 13.0,
          "id": "obj-30",
          "presentation": 1,
          "presentation_rect": [
            14,
            593,
            160,
            20
          ]
        }
      },
      {
        "box": {
          "maxclass": "live.gain~",
          "channels": 1,
          "lastchannelcount": 0,
          "numinlets": 1,
          "numoutlets": 4,
          "outlettype": [
            "signal",
            "",
            "float",
            "list"
          ],
          "parameter_enable": 1,
          "patching_rect": [
            540,
            340,
            48,
            136
          ],
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                -70
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Delay Level",
              "parameter_mmax": 0.0,
              "parameter_mmin": -70.0,
              "parameter_modmode": 3,
              "parameter_shortname": "Livello",
              "parameter_type": 0,
              "parameter_unitstyle": 4
            }
          },
          "varname": "Delay Level",
          "id": "obj-31",
          "presentation": 1,
          "presentation_rect": [
            14,
            612,
            48,
            136
          ]
        }
      },
      {
        "box": {
          "maxclass": "live.gain~",
          "channels": 1,
          "lastchannelcount": 0,
          "numinlets": 1,
          "numoutlets": 4,
          "outlettype": [
            "signal",
            "",
            "float",
            "list"
          ],
          "parameter_enable": 1,
          "patching_rect": [
            650,
            340,
            48,
            136
          ],
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                -70
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Feedback Level",
              "parameter_mmax": -6.0,
              "parameter_mmin": -70.0,
              "parameter_modmode": 3,
              "parameter_shortname": "Feedback",
              "parameter_type": 0,
              "parameter_unitstyle": 4
            }
          },
          "varname": "Feedback Level",
          "id": "obj-32",
          "presentation": 1,
          "presentation_rect": [
            200,
            612,
            48,
            136
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "quante volte\nsi ripete",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            1100,
            960,
            120,
            34
          ],
          "linecount": 2,
          "id": "obj-33",
          "presentation": 1,
          "presentation_rect": [
            254,
            660,
            120,
            34
          ]
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "loadmess 49",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            540,
            130,
            80,
            22
          ],
          "id": "obj-34"
        }
      },
      {
        "box": {
          "maxclass": "dial",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "float"
          ],
          "parameter_enable": 0,
          "size": 200,
          "min": 10,
          "mult": 10,
          "patching_rect": [
            540,
            160,
            40,
            40
          ],
          "id": "obj-35",
          "presentation": 1,
          "presentation_rect": [
            78,
            646,
            40,
            40
          ]
        }
      },
      {
        "box": {
          "maxclass": "number",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "",
            "bang"
          ],
          "parameter_enable": 0,
          "patching_rect": [
            585,
            169,
            50,
            22
          ],
          "id": "obj-36",
          "presentation": 1,
          "presentation_rect": [
            122,
            655,
            56,
            22
          ]
        }
      },
      {
        "box": {
          "maxclass": "message",
          "text": "$1 100",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            540,
            210,
            50,
            22
          ],
          "id": "obj-37"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "line~ 200",
          "numinlets": 2,
          "numoutlets": 2,
          "outlettype": [
            "signal",
            "bang"
          ],
          "patching_rect": [
            540,
            238,
            70,
            22
          ],
          "id": "obj-38"
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "tempo (ms)",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            900,
            270,
            80,
            20
          ],
          "id": "obj-39",
          "presentation": 1,
          "presentation_rect": [
            78,
            690,
            100,
            20
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "EFFETTI",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            900,
            300,
            120,
            22
          ],
          "fontsize": 14.0,
          "id": "obj-40",
          "presentation": 1,
          "presentation_rect": [
            10,
            394,
            200,
            22
          ]
        }
      },
      {
        "box": {
          "maxclass": "live.gain~",
          "channels": 1,
          "lastchannelcount": 0,
          "numinlets": 1,
          "numoutlets": 4,
          "outlettype": [
            "signal",
            "",
            "float",
            "list"
          ],
          "parameter_enable": 1,
          "patching_rect": [
            20,
            520,
            48,
            136
          ],
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                -6
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Main out",
              "parameter_mmax": -3.0,
              "parameter_mmin": -70.0,
              "parameter_modmode": 3,
              "parameter_shortname": "Registra",
              "parameter_type": 0,
              "parameter_unitstyle": 4
            }
          },
          "varname": "Main out",
          "id": "obj-41",
          "presentation": 1,
          "presentation_rect": [
            194,
            236,
            48,
            136
          ]
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "limi~ @threshold -3",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            20,
            680,
            130,
            22
          ],
          "id": "obj-42"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "clip~ -0.8 0.8",
          "numinlets": 3,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            20,
            712,
            100,
            22
          ],
          "id": "obj-43"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "sfrecord~",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            20,
            790,
            80,
            22
          ],
          "id": "obj-44"
        }
      },
      {
        "box": {
          "maxclass": "meter~",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "float"
          ],
          "patching_rect": [
            300,
            790,
            220,
            16
          ],
          "id": "obj-45",
          "presentation": 1,
          "presentation_rect": [
            65,
            196,
            310,
            16
          ]
        }
      },
      {
        "box": {
          "maxclass": "message",
          "text": "REC",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            120,
            640,
            50,
            22
          ],
          "id": "obj-46",
          "presentation": 1,
          "presentation_rect": [
            10,
            770,
            70,
            26
          ]
        }
      },
      {
        "box": {
          "maxclass": "message",
          "text": "STOP",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            180,
            640,
            50,
            22
          ],
          "id": "obj-47",
          "presentation": 1,
          "presentation_rect": [
            102,
            770,
            70,
            26
          ]
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "sel REC STOP",
          "numinlets": 2,
          "numoutlets": 3,
          "outlettype": [
            "bang",
            "bang",
            ""
          ],
          "patching_rect": [
            120,
            672,
            100,
            22
          ],
          "id": "obj-48"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "t b b",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "bang",
            "bang"
          ],
          "patching_rect": [
            120,
            700,
            50,
            22
          ],
          "id": "obj-49"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "text": "open mp3",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            160,
            730,
            70,
            22
          ],
          "id": "obj-50"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "text": "1",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            120,
            730,
            30,
            22
          ],
          "id": "obj-51"
        }
      },
      {
        "box": {
          "maxclass": "message",
          "text": "0",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            240,
            730,
            30,
            22
          ],
          "id": "obj-52"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "snapshot~ 250",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "float"
          ],
          "patching_rect": [
            20,
            822,
            90,
            22
          ],
          "id": "obj-53"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "/ 1000.",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            20,
            852,
            60,
            22
          ],
          "id": "obj-54"
        }
      },
      {
        "box": {
          "maxclass": "number",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "",
            "bang"
          ],
          "parameter_enable": 0,
          "patching_rect": [
            20,
            882,
            50,
            22
          ],
          "id": "obj-55",
          "presentation": 1,
          "presentation_rect": [
            194,
            772,
            50,
            22
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "secondi registrati",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            900,
            390,
            130,
            20
          ],
          "id": "obj-56",
          "presentation": 1,
          "presentation_rect": [
            246,
            774,
            130,
            20
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "livello della registrazione (resta sotto l'arancione)",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            900,
            420,
            320,
            20
          ],
          "id": "obj-57",
          "presentation": 1,
          "presentation_rect": [
            65,
            176,
            315,
            20
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "REGISTRAZIONE: REC registra, STOP salva l'MP3. Non usare il tasto Registra in alto: registrerebbe solo quello che senti in cuffia.",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            900,
            450,
            370,
            40
          ],
          "linecount": 3,
          "id": "obj-58",
          "presentation": 1,
          "presentation_rect": [
            10,
            804,
            370,
            48
          ]
        }
      },
      {
        "box": {
          "maxclass": "live.gain~",
          "channels": 1,
          "lastchannelcount": 0,
          "numinlets": 1,
          "numoutlets": 4,
          "outlettype": [
            "signal",
            "",
            "float",
            "list"
          ],
          "parameter_enable": 1,
          "patching_rect": [
            400,
            520,
            48,
            136
          ],
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                -70
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Headphones",
              "parameter_mmax": -3.0,
              "parameter_mmin": -70.0,
              "parameter_modmode": 3,
              "parameter_shortname": "Cuffie",
              "parameter_type": 0,
              "parameter_unitstyle": 4
            }
          },
          "varname": "Headphones",
          "id": "obj-59",
          "presentation": 1,
          "presentation_rect": [
            286,
            236,
            48,
            136
          ]
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "*~ 0",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            260,
            480,
            50,
            22
          ],
          "id": "obj-60"
        }
      },
      {
        "box": {
          "maxclass": "toggle",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "int"
          ],
          "parameter_enable": 0,
          "patching_rect": [
            320,
            440,
            24,
            24
          ],
          "id": "obj-61",
          "presentation": 1,
          "presentation_rect": [
            10,
            862,
            24,
            24
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "dry anche in cuffia (sconsigliato: lo senti in ritardo)",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            900,
            480,
            360,
            20
          ],
          "id": "obj-62",
          "presentation": 1,
          "presentation_rect": [
            40,
            864,
            340,
            20
          ]
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "limi~ @threshold -21",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            400,
            680,
            130,
            22
          ],
          "id": "obj-63"
        }
      },
      {
        "box": {
          "maxclass": "newobj",
          "text": "clip~ -0.8 0.8",
          "numinlets": 3,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            400,
            712,
            100,
            22
          ],
          "id": "obj-64"
        }
      },
      {
        "box": {
          "maxclass": "ezdac~",
          "numinlets": 2,
          "numoutlets": 0,
          "patching_rect": [
            400,
            745,
            45,
            45
          ],
          "id": "obj-65",
          "presentation": 1,
          "presentation_rect": [
            10,
            176,
            45,
            45
          ]
        }
      },
      {
        "box": {
          "maxclass": "comment",
          "text": "Versione per GRAPE di live_fx: in cuffia arrivano solo gli effetti (il suono diretto del microfono arriverebbe in ritardo); la registrazione (sfrecord~) contiene dry + effetti, con il limiter a -3 dB (quello delle cuffie resta a -21). 'open mp3' esiste solo in GRAPE.",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            20,
            940,
            560,
            40
          ],
          "linecount": 2,
          "id": "obj-66"
        }
      }
    ],
    "lines": [
      {
        "patchline": {
          "source": [
            "obj-5",
            0
          ],
          "destination": [
            "obj-6",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-6",
            0
          ],
          "destination": [
            "obj-7",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-7",
            0
          ],
          "destination": [
            "obj-8",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-7",
            0
          ],
          "destination": [
            "obj-9",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-9",
            0
          ],
          "destination": [
            "obj-12",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-13",
            0
          ],
          "destination": [
            "obj-14",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-14",
            0
          ],
          "destination": [
            "obj-9",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-14",
            0
          ],
          "destination": [
            "obj-15",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-7",
            0
          ],
          "destination": [
            "obj-17",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-17",
            0
          ],
          "destination": [
            "obj-20",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-21",
            0
          ],
          "destination": [
            "obj-22",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-22",
            0
          ],
          "destination": [
            "obj-23",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-22",
            0
          ],
          "destination": [
            "obj-24",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-24",
            0
          ],
          "destination": [
            "obj-25",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-25",
            0
          ],
          "destination": [
            "obj-17",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-7",
            0
          ],
          "destination": [
            "obj-27",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-27",
            0
          ],
          "destination": [
            "obj-28",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-28",
            0
          ],
          "destination": [
            "obj-31",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-28",
            0
          ],
          "destination": [
            "obj-32",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-32",
            0
          ],
          "destination": [
            "obj-27",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-34",
            0
          ],
          "destination": [
            "obj-35",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-35",
            0
          ],
          "destination": [
            "obj-36",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-35",
            0
          ],
          "destination": [
            "obj-37",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-37",
            0
          ],
          "destination": [
            "obj-38",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-38",
            0
          ],
          "destination": [
            "obj-28",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-8",
            0
          ],
          "destination": [
            "obj-41",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-12",
            0
          ],
          "destination": [
            "obj-41",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-20",
            0
          ],
          "destination": [
            "obj-41",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-31",
            0
          ],
          "destination": [
            "obj-41",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-41",
            0
          ],
          "destination": [
            "obj-42",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-42",
            0
          ],
          "destination": [
            "obj-43",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-43",
            0
          ],
          "destination": [
            "obj-44",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-43",
            0
          ],
          "destination": [
            "obj-45",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-46",
            0
          ],
          "destination": [
            "obj-48",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-47",
            0
          ],
          "destination": [
            "obj-48",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-48",
            0
          ],
          "destination": [
            "obj-49",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-48",
            1
          ],
          "destination": [
            "obj-52",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-49",
            1
          ],
          "destination": [
            "obj-50",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-49",
            0
          ],
          "destination": [
            "obj-51",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-50",
            0
          ],
          "destination": [
            "obj-44",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-51",
            0
          ],
          "destination": [
            "obj-44",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-52",
            0
          ],
          "destination": [
            "obj-44",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-44",
            0
          ],
          "destination": [
            "obj-53",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-53",
            0
          ],
          "destination": [
            "obj-54",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-54",
            0
          ],
          "destination": [
            "obj-55",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-12",
            0
          ],
          "destination": [
            "obj-59",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-20",
            0
          ],
          "destination": [
            "obj-59",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-31",
            0
          ],
          "destination": [
            "obj-59",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-8",
            0
          ],
          "destination": [
            "obj-60",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-61",
            0
          ],
          "destination": [
            "obj-60",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-60",
            0
          ],
          "destination": [
            "obj-59",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-59",
            0
          ],
          "destination": [
            "obj-63",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-63",
            0
          ],
          "destination": [
            "obj-64",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-64",
            0
          ],
          "destination": [
            "obj-65",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-64",
            0
          ],
          "destination": [
            "obj-65",
            1
          ]
        }
      }
    ],
    "dependency_cache": [],
    "autosave": 0
  }
}
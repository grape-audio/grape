# GRAPE

**GRaphical Audio Programming Environment**

A free visual patcher for audio that runs
in the browser, on computers and phones.
Nothing to install.

**Open it:** https://grape-audio.github.io/grape/

## What it can do

- About 100 objects: oscillators, filters,
  envelopes, delay, reverb, pitch shift,
  sound file players, live sampling
  (`buffer~`, `record~`, `groove~`),
  logic and math, MIDI-style helpers
- Interface objects: dials, sliders, number boxes,
  toggles, buttons, keyboard, faders,
  meters, oscilloscope, spectrum
- Patching mode and presentation mode,
  locked and edit views
- Record what you hear to MP3 or WAV
- Opens and saves `.maxpat` files
  (only the objects listed above)
- Touch: tap, drag, pinch to zoom,
  one finger to move the view
- Patches are kept in the browser;
  they can also be downloaded as files

## Open a patch from a link

Put a patch in the `patches/` folder,
for example `patches/live_fx.maxpat`.
This link opens it:

https://grape-audio.github.io/grape/?patch=live_fx

## Run it on your computer

These are static files, but the audio code
does not load from `file://`.
Serve the folder with any web server, e.g.:

```
python3 -m http.server
```

then open http://localhost:8000/

## Files

- `index.html`: the page
- `editor.js`: the patch editor
- `engine.js`: the objects
- `worklet.js`: the audio processors
- `example.js`: the example patch
- `mp3.js`, `lame.min.js`: MP3 recording
- `patches/`: patches opened by link

## Third-party code

- MP3 encoding: lamejs 1.2.1 (LGPL),
  see `LICENSE-lamejs.txt`
- Some filter designs are ported
  from cyclone (BSD 3-Clause),
  see `LICENSE-cyclone.txt`

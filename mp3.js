// MP3 encoding for the record button, with lamejs (lame.min.js, LGPL:
// see LICENSE-lamejs.txt).
// The page loads this file as a worker, so the encoding does not slow
// down the interface. If the page cannot start workers, it loads this
// file (and lame.min.js) as plain scripts and uses Mp3Stream directly.

// Turns stereo float chunks into MP3 data, piece by piece.
class Mp3Stream {
  constructor(sampleRate, kbps) {
    this.enc = new lamejs.Mp3Encoder(2, sampleRate, kbps);
    this.parts = [];
  }
  static toInt16(f) {
    const s = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const x = f[i] > 1 ? 1 : f[i] < -1 ? -1 : f[i];
      s[i] = x < 0 ? x * 32768 : x * 32767;
    }
    return s;
  }
  push(L, R) {
    const l = Mp3Stream.toInt16(L), r = Mp3Stream.toInt16(R);
    // lamejs works best with blocks of 1152 samples (one MP3 frame)
    for (let i = 0; i < l.length; i += 1152) {
      const b = this.enc.encodeBuffer(l.subarray(i, i + 1152), r.subarray(i, i + 1152));
      if (b.length) this.parts.push(b);
    }
  }
  end() {
    const b = this.enc.flush();
    if (b.length) this.parts.push(b);
    const blob = new Blob(this.parts, { type: "audio/mpeg" });
    this.parts = [];
    return blob;
  }
}
self.Mp3Stream = Mp3Stream;

// Worker mode. Messages: {init: {sampleRate, kbps}} -> {ready: 1};
// {L, R} adds a chunk; {end: 1} -> {blob}.
if (typeof importScripts === "function" && typeof window === "undefined") {
  importScripts("lame.min.js");
  let stream = null;
  self.onmessage = (e) => {
    const d = e.data;
    if (d.init) {
      stream = new Mp3Stream(d.init.sampleRate, d.init.kbps);
      self.postMessage({ ready: 1 });
    } else if (d.L && stream) {
      stream.push(d.L, d.R);
    } else if (d.end && stream) {
      self.postMessage({ blob: stream.end() });
      stream = null;
    }
  };
}

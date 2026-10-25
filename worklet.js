/* Audio processors for the patcher (AudioWorklet).
   One input per signal inlet: when a signal is connected to an inlet it
   replaces the number last sent to that inlet, like in Max. */
"use strict";

const TWO_PI = 2 * Math.PI;

// Signal of input k, or null when nothing is connected to it.
function sig(inputs, k) {
  const inp = inputs[k];
  return inp && inp.length ? inp[0] : null;
}

function wrap01(x) { return x - Math.floor(x); }

// Antialiasing corrections for a step (blep) and a corner (blamp).
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function blamp(t, dt) {
  if (t < dt) { t = 1 - t / dt; return t * t * t / 3; }
  if (t > 1 - dt) { t = 1 + (t - 1) / dt; return t * t * t / 3; }
  return 0;
}

class Base extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.p = Object.assign({}, (options.processorOptions || {}).params);
    this.alive = true;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.set) Object.assign(this.p, d.set);
      if (d.end) this.alive = false;
      this.msg(d);
    };
  }
  msg() {}
}

// ------------------------------------------------------------ cycle~
// inlet 0 frequency, inlet 1 phase offset (0..1): a signal there is phase modulation.
class Cycle extends Base {
  constructor(o) { super(o); this.ph = 0; }
  msg(d) { if (d.reset !== undefined) this.ph = wrap01(d.reset); }
  process(inputs, outputs) {
    const out = outputs[0][0];
    const fIn = sig(inputs, 0), pIn = sig(inputs, 1);
    const f = this.p.freq || 0, off = this.p.phase || 0, isr = 1 / sampleRate;
    let ph = this.ph;
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.cos(TWO_PI * (ph + (pIn ? pIn[i] : off)));
      ph += (fIn ? fIn[i] : f) * isr;
      ph -= Math.floor(ph);
    }
    this.ph = ph;
    return this.alive;
  }
}

// ------------------------------------------------------------ saw~ rect~ tri~
// Shared: frequency inlet, optional shape inlet, sync inlet (reset when the
// sync signal crosses the threshold upwards).
class Shape extends Base {
  constructor(o) { super(o); this.ph = 0; this.prevSync = 0; }
  process(inputs, outputs) {
    const out = outputs[0][0];
    const kind = this.kind;
    const fIn = sig(inputs, 0);
    const wIn = kind === "saw" ? null : sig(inputs, 1);
    const sIn = sig(inputs, kind === "saw" ? 1 : 2);
    const f = this.p.freq || 0, w0 = this.p.width === undefined ? 0.5 : this.p.width;
    const thr = this.p.synctrig === undefined ? 0.5 : this.p.synctrig;
    const isr = 1 / sampleRate;
    let ph = this.ph, prev = this.prevSync;
    for (let i = 0; i < out.length; i++) {
      if (sIn) {
        const s = sIn[i];
        if (prev < thr && s >= thr) ph = 0;
        prev = s;
      }
      const inc = (fIn ? fIn[i] : f) * isr;
      const dt = Math.min(0.5, Math.abs(inc));
      let y;
      if (kind === "saw") {
        y = 2 * ph - 1;
        if (dt > 0) y -= (inc >= 0 ? 1 : -1) * blep(ph, dt);
      } else if (kind === "rect") {
        const pw = wrap01(wIn ? wIn[i] : w0);
        y = ph < pw ? 1 : -1;
        if (dt > 0) y += blep(ph, dt) - blep(wrap01(ph - pw), dt);
      } else {
        let d = wrap01(wIn ? wIn[i] : w0);
        d = d < 0.05 ? 0.05 : d > 0.95 ? 0.95 : d;
        y = ph < d ? -1 + 2 * ph / d : 1 - 2 * (ph - d) / (1 - d);
        if (dt > 0) {
          const k = 2 / (d * (1 - d)) * dt;
          y += k * (blamp(ph, dt) - blamp(wrap01(ph - d), dt));
        }
      }
      out[i] = y;
      ph += inc;
      ph -= Math.floor(ph);
    }
    this.ph = ph;
    this.prevSync = prev;
    return this.alive;
  }
}
class Saw extends Shape { constructor(o) { super(o); this.kind = "saw"; } }
class Rect extends Shape { constructor(o) { super(o); this.kind = "rect"; } }
class Tri extends Shape { constructor(o) { super(o); this.kind = "tri"; } }

// ------------------------------------------------------------ lores~
// Same two-pole design as Max/cyclone lores~: resonance 0..1.
// Filter coefficients ported from cyclone's lores~ (BSD 3-Clause License,
// Copyright (c) 2003-2020 Krzysztof Czaja, Fred Jan Kraan, Alexandre Porres,
// Derek Kwan, Matt Barber and others). See LICENSE-cyclone.txt.
class Lores extends Base {
  constructor(o) { super(o); this.y1 = 0; this.y2 = 0; }
  msg(d) { if (d.clear) { this.y1 = 0; this.y2 = 0; } }
  process(inputs, outputs) {
    const out = outputs[0][0];
    const x = sig(inputs, 0), cIn = sig(inputs, 1), rIn = sig(inputs, 2);
    const k = TWO_PI / sampleRate;
    let y1 = this.y1, y2 = this.y2;
    let c1 = 0, c2 = 0, b0 = 0, lastC = NaN, lastR = NaN;
    for (let i = 0; i < out.length; i++) {
      const cut = cIn ? cIn[i] : (this.p.cutoff || 0);
      const res = rIn ? rIn[i] : (this.p.res || 0);
      if (cut !== lastC || res !== lastR) {
        lastC = cut; lastR = res;
        let om = cut * k;
        om = om < 0.0001 ? 0.0001 : om > Math.PI ? Math.PI : om;
        const r = res > 1 - 1e-20 ? 1 - 1e-20 : res;
        const radius = Math.exp(r * 0.125) * 0.882496902585;
        c1 = 2 * radius * Math.cos(om);
        c2 = radius * radius;
        b0 = 1 - c1 + c2;
      }
      let y = b0 * (x ? x[i] : 0) + c1 * y1 - c2 * y2;
      if (!(Math.abs(y) < 1e10)) y = 0; // blew up or NaN: restart quietly
      y2 = y1; y1 = y;
      out[i] = y;
    }
    this.y1 = Math.abs(y1) < 1e-30 ? 0 : y1;
    this.y2 = Math.abs(y2) < 1e-30 ? 0 : y2;
    return this.alive;
  }
}

// ------------------------------------------------------------ adsr~
// Inlet 0 trigger (number or signal), inlets 1-4 attack, decay, sustain, release.
// Output 0 envelope, output 1 = 1 during attack/decay/sustain, else 0.
const IDLE = 0, RETRIG = 1, ATTACK = 2, DECAY = 3, SUSTAIN = 4, RELEASE = 5;
class Adsr extends Base {
  constructor(o) {
    super(o);
    this.v = 0; this.stage = IDLE; this.from = 0; this.pos = 0; this.peak = 0;
    this.prevTrig = 0; this.held = 0; this.queue = [];
  }
  msg(d) { if (d.trig !== undefined) this.queue.push(d.trig); }
  go(stage) {
    this.stage = stage; this.from = this.v; this.pos = 0; this.held = 0;
  }
  noteOn(peak) {
    this.peak = peak;
    if (this.stage !== IDLE && !this.p.legato && this.v !== 0 && (this.p.retrigger || 0) > 0) this.go(RETRIG);
    else this.go(ATTACK);
    this.port.postMessage({ mute: 0 });
  }
  noteOff() {
    if (this.p.triggermode) return;
    if (this.stage !== IDLE && this.stage !== RELEASE) this.go(RELEASE);
  }
  trigger(v) { if (v !== 0) this.noteOn(v); else this.noteOff(); }
  process(inputs, outputs) {
    const out = outputs[0][0], gate = outputs[1][0];
    const tIn = sig(inputs, 0), aIn = sig(inputs, 1), dIn = sig(inputs, 2), sIn = sig(inputs, 3), rIn = sig(inputs, 4);
    const msPerSample = 1000 / sampleRate;
    while (this.queue.length) this.trigger(this.queue.shift());
    for (let i = 0; i < out.length; i++) {
      if (tIn) {
        const t = tIn[i];
        if (this.prevTrig === 0 && t !== 0) this.noteOn(t);
        else if (this.prevTrig !== 0 && t === 0) this.noteOff();
        this.prevTrig = t;
      }
      const sus = (sIn ? sIn[i] : (this.p.sustain || 0)) * this.peak;
      let ms;
      switch (this.stage) {
        case RETRIG:
          ms = this.p.retrigger || 0;
          this.pos += ms > 0 ? msPerSample / ms : 1;
          if (this.pos >= 1) { this.v = 0; this.go(ATTACK); }
          else this.v = this.from * (1 - this.pos);
          break;
        case ATTACK:
          ms = aIn ? aIn[i] : (this.p.attack || 0);
          this.pos += ms > 0 ? msPerSample / ms : 1;
          if (this.pos >= 1) { this.v = this.peak; this.go(DECAY); }
          else this.v = this.from + (this.peak - this.from) * this.pos;
          break;
        case DECAY:
          ms = dIn ? dIn[i] : (this.p.decay || 0);
          this.pos += ms > 0 ? msPerSample / ms : 1;
          if (this.pos >= 1) { this.v = sus; this.go(this.p.triggermode ? RELEASE : SUSTAIN); }
          else this.v = this.from + (sus - this.from) * this.pos;
          break;
        case SUSTAIN: {
          this.v = sus;
          const mx = this.p.maxsustain;
          if (typeof mx === "number" && mx >= 0) {
            this.held += msPerSample;
            if (this.held >= mx) this.go(RELEASE);
          }
          break;
        }
        case RELEASE:
          ms = rIn ? rIn[i] : (this.p.release || 0);
          this.pos += ms > 0 ? msPerSample / ms : 1;
          if (this.pos >= 1) { this.v = 0; this.stage = IDLE; this.port.postMessage({ mute: 1 }); }
          else this.v = this.from * (1 - this.pos);
          break;
        default:
          this.v = 0;
      }
      out[i] = this.v;
      gate[i] = this.stage === ATTACK || this.stage === DECAY || this.stage === SUSTAIN ? 1 : 0;
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ line~
// Receives lists of [target, ms] segments; reports when the last one ends.
class Line extends Base {
  constructor(o) {
    super(o);
    this.v = this.p.init || 0; this.segs = []; this.seg = null; this.paused = false;
  }
  msg(d) {
    if (d.line) { this.segs = d.line.slice(); this.seg = null; this.paused = false; this.next(); }
    if (d.stop) { this.segs = []; this.seg = null; }
    if (d.pause) this.paused = true;
    if (d.resume) this.paused = false;
  }
  next() {
    while (this.segs.length) {
      const [to, ms] = this.segs.shift();
      const n = Math.round(ms * sampleRate / 1000);
      if (n <= 0) { this.v = to; continue; }
      this.seg = { from: this.v, to, n, i: 0 };
      return;
    }
    this.seg = null;
    this.port.postMessage({ done: 1 });
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      const s = this.seg;
      if (s && !this.paused) {
        s.i++;
        this.v = s.from + (s.to - s.from) * (s.i / s.n);
        if (s.i >= s.n) { this.v = s.to; this.next(); }
      }
      out[i] = this.v;
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ helpers for delay lines
function wrapIndex(i, n) { i %= n; return i < 0 ? i + n : i; }
// 4-point cubic (Hermite) reading at a fractional position of a ring buffer.
function readCubic(b, pos, n) {
  const i = Math.floor(pos), f = pos - i;
  const xm1 = b[wrapIndex(i - 1, n)], x0 = b[wrapIndex(i, n)];
  const x1 = b[wrapIndex(i + 1, n)], x2 = b[wrapIndex(i + 2, n)];
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

// ------------------------------------------------------------ tapin~ / tapout~
// tapin~ writes its input into a delay memory that tapout~ objects read.
// Both run on this audio thread, so the memory is shared through TAPS.
// Positions follow the global sample clock (currentFrame): the order in
// which tapin~ and tapout~ run does not matter, because every delay is
// at least one block (128 samples), like the vector-size minimum in Max.
const TAPS = new Map(); // tapin~ id -> { buf, frozen }
const MIN_FIXED = 128, MIN_CONT = 131; // cubic reading needs 3 more
// The longest delay must stay one block (plus the cubic points) behind the
// write position: the block tapin~ is writing may already hold new samples.
const TAIL = 128 + 8;
class TapIn extends Base {
  constructor(o) {
    super(o);
    this.id = this.p.id;
    this.alloc(this.p.ms || 100);
  }
  alloc(ms) {
    const n = Math.max(512, Math.ceil(ms * sampleRate / 1000) + 2 * TAIL);
    TAPS.set(this.id, { buf: new Float32Array(n), frozen: false });
  }
  msg(d) {
    const t = TAPS.get(this.id);
    if (d.resize !== undefined) this.alloc(d.resize);
    else if (d.clear && t) t.buf.fill(0);
    if (d.freeze !== undefined && t) t.frozen = !!d.freeze;
    if (d.end) TAPS.delete(this.id);
  }
  process(inputs, outputs) {
    const t = TAPS.get(this.id);
    const x = sig(inputs, 0), len = outputs[0][0].length;
    if (t && !t.frozen) {
      const b = t.buf, n = b.length;
      for (let i = 0; i < len; i++) b[(currentFrame + i) % n] = x ? x[i] : 0;
    }
    return this.alive;
  }
}
// One output per tap. A signal in the tap's inlet: continuous delay with
// sub-sample reading. A number: fixed delay in whole samples.
class TapOut extends Base {
  process(inputs, outputs) {
    const t = TAPS.get(this.p.link);
    const delays = this.p.delays || [];
    for (let k = 0; k < outputs.length; k++) {
      const out = outputs[k][0];
      if (!t) { out.fill(0); continue; }
      const b = t.buf, n = b.length, maxD = n - TAIL;
      const dIn = sig(inputs, k), msr = sampleRate / 1000;
      if (dIn) {
        for (let i = 0; i < out.length; i++) {
          let d = dIn[i] * msr;
          d = d < MIN_CONT ? MIN_CONT : d > maxD ? maxD : d;
          out[i] = readCubic(b, currentFrame + i - d, n);
        }
      } else {
        let d = Math.round((delays[k] || 0) * msr);
        d = d < MIN_FIXED ? MIN_FIXED : d > maxD ? maxD : d;
        for (let i = 0; i < out.length; i++) out[i] = b[wrapIndex(currentFrame + i - d, n)];
      }
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ pitchshift~
// Delay-line pitch shifter: two read heads move through the recent input
// at `ratio` times the normal speed; each fades in and out (sin^2 window)
// so that the jump back of one head is covered by the other.
class PitchShift extends Base {
  constructor(o) {
    super(o);
    this.ch = Math.max(1, this.p.ch || 1);
    this.n = 1 << 15;
    this.bufs = Array.from({ length: this.ch }, () => new Float32Array(this.n));
    this.w = 0;
    this.ph = 0;
  }
  process(inputs, outputs) {
    const ch = this.ch, n = this.n;
    const rIn = sig(inputs, ch);
    const W = Math.max(64, Math.round((this.p.window || 40) * sampleRate / 1000));
    const on = this.p.enabled !== 0;
    const len = outputs[0][0].length;
    const xs = [];
    for (let c = 0; c < ch; c++) xs.push(sig(inputs, c));
    for (let i = 0; i < len; i++) {
      let r = this.p.ratio === undefined ? 1 : this.p.ratio;
      if (rIn) r = this.p.usecents ? Math.pow(2, rIn[i] / 1200) : rIn[i];
      this.ph += (1 - r) / W;
      this.ph -= Math.floor(this.ph);
      const p0 = this.ph, p1 = p0 < 0.5 ? p0 + 0.5 : p0 - 0.5;
      const g0 = Math.sin(Math.PI * p0) ** 2, g1 = 1 - g0;
      const d0 = 4 + p0 * W, d1 = 4 + p1 * W;
      for (let c = 0; c < ch; c++) {
        const b = this.bufs[c], x = xs[c] ? xs[c][i] : 0;
        b[this.w] = x;
        outputs[c][0][i] = on
          ? g0 * readCubic(b, this.w - d0, n) + g1 * readCubic(b, this.w - d1, n)
          : x;
      }
      this.w = (this.w + 1) % n;
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ cverb~
// Mono reverberator: 8 parallel damped combs and 4 allpasses in series
// (the Freeverb structure). The reverb time sets the comb feedback so
// that the tail falls by 60 dB in that many milliseconds.
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
class CVerb extends Base {
  constructor(o) {
    super(o);
    const k = sampleRate / 44100;
    this.combs = COMBS.map((l) => ({ b: new Float32Array(Math.round(l * k)), i: 0, z: 0 }));
    this.aps = ALLPASSES.map((l) => ({ b: new Float32Array(Math.round(l * k)), i: 0 }));
  }
  msg(d) {
    if (d.clear) {
      for (const c of this.combs) { c.b.fill(0); c.z = 0; }
      for (const a of this.aps) a.b.fill(0);
    }
  }
  process(inputs, outputs) {
    const x = sig(inputs, 0), tIn = sig(inputs, 1);
    const out = outputs[0][0];
    const ms = Math.max(1, tIn ? tIn[0] : (this.p.time || 1000));
    const T = ms * sampleRate / 1000; // reverb time in samples
    const damp = 0.2;
    for (const c of this.combs) c.g = Math.pow(10, -3 * c.b.length / T);
    for (let i = 0; i < out.length; i++) {
      const xi = (x ? x[i] : 0) * 0.015;
      let y = 0;
      for (const c of this.combs) {
        const o = c.b[c.i];
        c.z = o * (1 - damp) + c.z * damp;
        c.b[c.i] = xi + c.z * c.g;
        if (++c.i >= c.b.length) c.i = 0;
        y += o;
      }
      for (const a of this.aps) {
        const o = a.b[a.i];
        a.b[a.i] = y + o * 0.5;
        y = o - y;
        if (++a.i >= a.b.length) a.i = 0;
      }
      out[i] = y * 2.5;
    }
    for (const c of this.combs) if (Math.abs(c.z) < 1e-30) c.z = 0;
    return this.alive;
  }
}

// ------------------------------------------------------------ clip~
// Inlets: signal, minimum, maximum (numbers or signals). mode 1: zero outside.
class ClipSig extends Base {
  process(inputs, outputs) {
    const out = outputs[0][0];
    const x = sig(inputs, 0), lo = sig(inputs, 1), hi = sig(inputs, 2);
    const l0 = this.p.min || 0, h0 = this.p.max || 0, zero = this.p.mode === 1;
    for (let i = 0; i < out.length; i++) {
      const v = x ? x[i] : 0, a = lo ? lo[i] : l0, b = hi ? hi[i] : h0;
      out[i] = v < a ? (zero ? 0 : a) : v > b ? (zero ? 0 : b) : v;
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ phasor~
// Ramp 0..1. p.sync (syncupdate): a new frequency waits for the wrap.
class Phasor extends Base {
  constructor(o) { super(o); this.ph = 0; this.f = this.p.freq || 0; }
  msg(d) {
    if (d.phase !== undefined) this.ph = wrap01(d.phase);
    if (d.now) this.f = this.p.freq || 0;
  }
  process(inputs, outputs) {
    const out = outputs[0][0], fIn = sig(inputs, 0), isr = 1 / sampleRate, sync = this.p.sync;
    let ph = this.ph, f = sync ? this.f : (this.p.freq || 0);
    for (let i = 0; i < out.length; i++) {
      out[i] = ph;
      ph += (fIn ? fIn[i] : f) * isr;
      if (ph >= 1 || ph < 0) {
        ph -= Math.floor(ph);
        if (sync) f = this.p.freq || 0;
      }
    }
    this.ph = ph;
    this.f = f;
    return this.alive;
  }
}

// ------------------------------------------------------------ peakamp~, meter~
// Largest absolute value since the last report (p.signed: with its sign).
// Reports on request (get) or every p.every samples.
class Probe extends Base {
  constructor(o) { super(o); this.peak = 0; this.speak = 0; this.count = 0; }
  report() {
    this.port.postMessage({ v: this.p.signed ? this.speak : this.peak });
    this.peak = 0;
    this.speak = 0;
  }
  msg(d) { if (d.get) this.report(); }
  process(inputs) {
    const x = sig(inputs, 0);
    if (x) {
      for (let i = 0; i < x.length; i++) {
        const a = Math.abs(x[i]);
        if (a > this.peak) { this.peak = a; this.speak = x[i]; }
      }
    }
    const every = this.p.every || 0;
    if (every > 0) {
      this.count += 128;
      if (this.count >= every) { this.count = this.count % every; this.report(); }
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ degrade~
// Sample-and-hold at p.ratio of the sampling rate, quantized to p.bits
// (as cyclone's degrade~, which follows Max).
class Degrade extends Base {
  constructor(o) { super(o); this.ph = 0; this.hold = 0; }
  process(inputs, outputs) {
    const out = outputs[0][0], x = sig(inputs, 0), rIn = sig(inputs, 1), bIn = sig(inputs, 2);
    const stepsOf = (b) => Math.pow(2, b > 52 ? 52 : b < 1 ? 1 : b) / 2;
    const s0 = stepsOf(this.p.bits), r0 = this.p.ratio;
    let ph = this.ph, hold = this.hold;
    for (let i = 0; i < out.length; i++) {
      let v = x ? x[i] : 0;
      const st = bIn ? stepsOf(bIn[i]) : s0;
      v = v > 0 ? Math.trunc(v * st) / st : Math.trunc(v * st) / st - 1 / st;
      let r = rIn ? rIn[i] : r0;
      r = r > 1 ? 1 : r < 0 ? 0 : r;
      if (ph >= 1) hold = v;
      out[i] = hold;
      ph = (ph % 1) + r;
    }
    this.ph = ph;
    this.hold = hold;
    return this.alive;
  }
}

// ------------------------------------------------------------ overdrive~
class Overdrive extends Base {
  process(inputs, outputs) {
    const out = outputs[0][0], x = sig(inputs, 0), dIn = sig(inputs, 1), d0 = this.p.drive;
    for (let i = 0; i < out.length; i++) {
      const f = x ? x[i] : 0, d = dIn ? dIn[i] : d0;
      out[i] = f >= 1 ? 1 : f > 0 ? 1 - Math.pow(1 - f, d) : f > -1 ? Math.pow(1 + f, d) - 1 : -1;
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ comb~
// y[n] = a x[n] + b x[n-d] + c y[n-d], d in ms (at least one sample),
// read with linear interpolation.
class Comb extends Base {
  constructor(o) {
    super(o);
    this.size = Math.ceil(Math.max(0.001, this.p.max) * sampleRate / 1000) + 2;
    this.xb = new Float64Array(this.size);
    this.yb = new Float64Array(this.size);
    this.w = 0;
  }
  msg(d) { if (d.clear) { this.xb.fill(0); this.yb.fill(0); } }
  read(buf, d) {
    let r = this.w - d;
    while (r < 0) r += this.size;
    const i0 = Math.floor(r), fr = r - i0, i1 = i0 + 1 >= this.size ? 0 : i0 + 1;
    return buf[i0] + (buf[i1] - buf[i0]) * fr;
  }
  process(inputs, outputs) {
    const out = outputs[0][0], x = sig(inputs, 0), dI = sig(inputs, 1), aI = sig(inputs, 2), bI = sig(inputs, 3), cI = sig(inputs, 4);
    const kms = sampleRate / 1000, max = this.p.max, p = this.p;
    for (let i = 0; i < out.length; i++) {
      const v = x ? x[i] : 0;
      this.xb[this.w] = v;
      let ms = dI ? dI[i] : p.del;
      ms = ms < 0 ? 0 : ms > max ? max : ms;
      const d = Math.max(1, ms * kms);
      const y = (aI ? aI[i] : p.a) * v + (bI ? bI[i] : p.b) * this.read(this.xb, d) + (cI ? cI[i] : p.c) * this.read(this.yb, d);
      this.yb[this.w] = y;
      out[i] = y;
      this.w = this.w + 1 >= this.size ? 0 : this.w + 1;
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ reson~
// Smith-Angell resonator: y = g (1-r) (x[n] - r x[n-2]) + 2r cos(w) y[n-1] - r^2 y[n-2],
// r = exp(-w / Q) (as cyclone's reson~).
class Reson extends Base {
  constructor(o) { super(o); this.clear(); }
  clear() { this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  msg(d) { if (d.clear) this.clear(); }
  coefs(cf, q) {
    let w = cf * TWO_PI / sampleRate;
    w = w < 0.0001 ? 0.0001 : w > Math.PI ? Math.PI : w;
    const r = Math.exp(w * (q > 1e-20 ? -1 / q : -1e20));
    this.r = r;
    this.c1 = 2 * r * Math.cos(w);
    this.c2 = r * r;
    this.sc = 1 - r;
  }
  process(inputs, outputs) {
    const out = outputs[0][0], x = sig(inputs, 0), gI = sig(inputs, 1), fI = sig(inputs, 2), qI = sig(inputs, 3);
    let x1 = this.x1, x2 = this.x2, y1 = this.y1, y2 = this.y2, lf = NaN, lq = NaN;
    for (let i = 0; i < out.length; i++) {
      const cf = fI ? fI[i] : this.p.cf, q = qI ? qI[i] : this.p.q;
      if (cf !== lf || q !== lq) { this.coefs(cf, q); lf = cf; lq = q; }
      const xn = x ? x[i] : 0, g = gI ? gI[i] : this.p.gain;
      const yn = g * this.sc * (xn - this.r * x2) + this.c1 * y1 - this.c2 * y2;
      x2 = x1; x1 = xn; y2 = y1; y1 = yn;
      out[i] = yn;
    }
    const tidy = (v) => (Math.abs(v) < 1e-30 || !(Math.abs(v) < 1e30) ? 0 : v);
    this.x1 = x1; this.x2 = x2; this.y1 = tidy(y1); this.y2 = tidy(y2);
    return this.alive;
  }
}

// ------------------------------------------------------------ freqshift~
// Hilbert pair from two chains of allpass filters (Olli Niemitalo's
// coefficients, 90 degrees apart over most of the audio band), then
// single-sideband modulation: re cos + im sin shifts every partial up by p.shift Hz
// (path A is delayed by one sample, which keeps the two paths 90 degrees apart).
const HB_A = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737].map((c) => c * c);
const HB_B = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278].map((c) => c * c);
class FreqShift extends Base {
  constructor(o) { super(o); this.clear(); this.ph = 0; }
  clear() { this.sa = new Float64Array(16); this.sb = new Float64Array(16); this.ad = 0; }
  msg(d) {
    if (d.clear) this.clear();
    if (d.resetphase) this.ph = 0;
  }
  // four sections y[n] = c (x[n] + y[n-2]) - x[n-2]; state x1 x2 y1 y2 each
  chain(s, cs, v) {
    for (let k = 0; k < 4; k++) {
      const o = k * 4;
      const y = cs[k] * (v + s[o + 3]) - s[o + 1];
      s[o + 1] = s[o]; s[o] = v; s[o + 3] = s[o + 2]; s[o + 2] = y;
      v = y;
    }
    return v;
  }
  process(inputs, outputs) {
    const out = outputs[0][0], x = sig(inputs, 0), sI = sig(inputs, 1), isr = 1 / sampleRate;
    let ph = this.ph;
    for (let i = 0; i < out.length; i++) {
      const v = x ? x[i] : 0;
      const a = this.chain(this.sa, HB_A, v), re = this.ad, im = this.chain(this.sb, HB_B, v);
      this.ad = a;
      const w = TWO_PI * ph;
      out[i] = re * Math.cos(w) + im * Math.sin(w);
      ph += (sI ? sI[i] : this.p.shift) * isr;
      ph -= Math.floor(ph);
    }
    this.ph = ph;
    return this.alive;
  }
}

// ------------------------------------------------------------ buffer~, record~, groove~
// Sample memory shared by every processor of the page (they all run in
// this scope): name -> { ch: [Float32Array per channel], frames, owner }.
// owner: the buffer~ that defined it last, so a late "free" from an old
// buffer~ (for example after reopening a patch) does not erase a new one.
const BUFS = new Map();
function bufMake(frames, chans, old) {
  const ch = [];
  for (let c = 0; c < chans; c++) {
    const a = new Float32Array(frames);
    if (old && old.ch[c]) a.set(old.ch[c].subarray(0, Math.min(frames, old.frames)));
    ch.push(a);
  }
  return { ch, frames, owner: old ? old.owner : 0 };
}
class BufferProc extends Base {
  msg(d) {
    const op = d.op;
    if (!op) return;
    if (op === "rename") {
      const ob = BUFS.get(d.from);
      if (ob && ob.owner === d.owner) BUFS.delete(d.from);
      if (ob && d.to) { ob.owner = d.owner; BUFS.set(d.to, ob); }
      return;
    }
    const b = BUFS.get(d.name);
    if (op === "define") {
      const nb = bufMake(d.frames, d.chans, b);
      nb.owner = d.owner;
      BUFS.set(d.name, nb);
    } else if (op === "load") {
      const n = d.data.length ? d.data[0].length : 0;
      const frames = d.resize ? n : Math.max(n, b ? b.frames : 0);
      const chans = Math.max(1, d.resize ? d.data.length : Math.max(d.data.length, b ? b.ch.length : 1));
      const nb = bufMake(frames, chans, null);
      d.data.forEach((x, c) => { if (c < chans) nb.ch[c].set(x.subarray(0, Math.min(frames, n))); });
      nb.owner = d.owner;
      BUFS.set(d.name, nb);
      this.port.postMessage({ loaded: d.name, frames, chans });
    } else if (op === "free") {
      if (b && b.owner === d.owner) BUFS.delete(d.name);
    } else if (op === "get") {
      if (b) this.port.postMessage({ data: b.ch.map((a) => a.slice()), frames: b.frames });
      else this.port.postMessage({ data: [new Float32Array(0)], frames: 0 });
    } else if (b) {
      const each = (fn) => b.ch.forEach((a) => { for (let i = 0; i < a.length; i++) a[i] = fn(a[i]); });
      if (op === "clear") b.ch.forEach((a) => a.fill(0));
      else if (op === "fill") b.ch.forEach((a) => a.fill(d.v));
      else if (op === "gain") each((x) => x * d.v);
      else if (op === "offset") each((x) => x + d.v);
      else if (op === "normalize") {
        let pk = 0;
        b.ch.forEach((a) => { for (let i = 0; i < a.length; i++) { const x = Math.abs(a[i]); if (x > pk) pk = x; } });
        if (pk > 0) { const g = d.v / pk; each((x) => x * g); }
      } else if (op === "crop") {
        const s = Math.max(0, Math.min(b.frames, d.s)), e = d.e > s ? Math.min(b.frames, d.e) : b.frames;
        BUFS.set(d.name, { ch: b.ch.map((a) => a.slice(s, e)), frames: e - s, owner: b.owner });
        this.port.postMessage({ resized: d.name, frames: e - s, chans: b.ch.length });
      }
    }
  }
  process() { return this.alive; }
}

// record~: writes inputs 0..ch-1 into the buffer p.name between p.start
// and p.end (ms; inputs ch and ch+1 can give them as signals). Output: 0..1
// along the recording; it stays at 1 when the end stops it (loop off).
class RecordProc extends Base {
  constructor(o) { super(o); this.run = false; this.fresh = false; this.phase = 0; this.sync = 0; }
  msg(d) {
    if (d.run !== undefined) {
      this.run = !!d.run;
      if (this.run) this.fresh = true;
      else { this.sync = 0; if (!this.p.append) this.phase = 0; }
    }
    if (d.reset) {
      this.p.start = 0;
      this.p.end = 1e32;
      this.phase = 0;
      if (this.sync > 0) this.run = true;
    }
  }
  process(inputs, outputs) {
    const out = outputs[0][0], nch = this.p.ch, b = BUFS.get(this.p.name), kms = sampleRate / 1000;
    const sI = sig(inputs, nch), eI = sig(inputs, nch + 1), ins = [];
    for (let c = 0; c < nch; c++) ins.push(sig(inputs, c));
    for (let i = 0; i < out.length; i++) {
      if (this.run && b && b.frames > 0) {
        const n = b.frames;
        let sms = sI ? sI[i] : this.p.start, ems = eI ? eI[i] : this.p.end;
        if (sms < 0) sms = 0;
        if (ems < 0) ems = 0;
        if (sms < ems) {
          let ss = Math.floor(sms * kms), es = Math.floor(ems * kms);
          if (ss >= n) ss = n - 1;
          if (es > n) es = n;
          if (this.fresh) {
            this.fresh = false;
            if (!this.p.append) { this.phase = ss; this.sync = 0; }
          }
          let ph = this.phase;
          if (ph >= es) {
            if (this.p.loop) ph = ss;
            else { this.run = false; this.sync = 1; }
          }
          if (ph < ss) ph = ss;
          if (this.run) {
            const m = Math.min(nch, b.ch.length);
            for (let c = 0; c < m; c++) b.ch[c][ph] = ins[c] ? ins[c][i] : 0;
            this.sync = es > ss ? (ph - ss) / (es - ss) : 0;
            this.phase = ph + 1;
          }
        }
      }
      out[i] = this.sync;
    }
    return this.alive;
  }
}

// groove~: reads the buffer p.name at the speed given by input 0 (a
// signal), with cubic interpolation. Inputs 1 and 2: loop start and end
// (ms, also as numbers in p.ls / p.le; end 0 = end of the buffer). With
// p.loop it jumps back at the loop end (forward) or start (backwards);
// without, it stops at either end of the buffer. Last output: 0..1 across
// the loop.
class GrooveProc extends Base {
  constructor(o) { super(o); this.pos = 0; this.playing = false; }
  loopPts(n, lsms, lems, kms) {
    let ls = lsms * kms, le = lems * kms;
    if (le <= 0 || le > n) le = n;
    if (ls < 0) ls = 0;
    if (ls >= le) ls = 0;
    return [ls, le];
  }
  msg(d) {
    const kms = sampleRate / 1000, b = BUFS.get(this.p.name), n = b ? b.frames : 0;
    if (d.pos !== undefined) { this.pos = Math.max(0, d.pos * kms); this.playing = true; }
    if (d.startloop) { this.pos = this.loopPts(n, this.p.ls, this.p.le, kms)[0]; this.playing = true; }
    if (d.endloop) this.pos = this.loopPts(n, this.p.ls, this.p.le, kms)[1];
    if (d.stop) this.playing = false;
  }
  process(inputs, outputs) {
    const nout = this.p.nout, b = BUFS.get(this.p.name), kms = sampleRate / 1000;
    const spI = sig(inputs, 0), lsI = sig(inputs, 1), leI = sig(inputs, 2);
    const sync = outputs[nout][0], len = sync.length;
    const n = b ? b.frames : 0, nb = b ? b.ch.length : 0;
    let [ls, le] = this.loopPts(n, this.p.ls, this.p.le, kms);
    for (let i = 0; i < len; i++) {
      if (lsI || leI) [ls, le] = this.loopPts(n, lsI ? lsI[i] : this.p.ls, leI ? leI[i] : this.p.le, kms);
      let pos = this.pos;
      if (this.playing && (pos >= n || pos < 0)) this.playing = false;
      if (!this.playing) {
        for (let k = 0; k < nout; k++) outputs[k][0][i] = 0;
        sync[i] = 0;
        continue;
      }
      if (nout === 1 && nb > 1) {
        let s = 0;
        for (let c = 0; c < nb; c++) s += readEdge(b.ch[c], pos, n);
        outputs[0][0][i] = s / nb;
      } else {
        for (let k = 0; k < nout; k++) outputs[k][0][i] = k < nb ? readEdge(b.ch[k], pos, n) : 0;
      }
      sync[i] = le > ls ? Math.max(0, Math.min(1, (pos - ls) / (le - ls))) : 0;
      const sp = spI ? spI[i] : 0, before = pos;
      pos += sp;
      if (this.p.loop && le > ls) {
        const L = le - ls;
        if (sp > 0 && pos >= le) pos = ls + ((pos - le) % L);
        else if (sp < 0 && pos < ls && before >= ls) pos = le - ((ls - pos) % L);
      }
      this.pos = pos;
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ selector~, gate~
// p.n inputs (selector~) or outlets (gate~). The choice: 0 or less closes
// all, 1 the first, above n the last. It comes from numbers (sel, next) or,
// when a signal is connected to input 0 (p.sigctl), from that signal, sample
// by sample. p.ramp (ms) crossfades on a change. p.step (stepmode): each
// change of the whole number moves on by one, wrapping; 0 closes.
class Switch extends Base {
  constructor(o) {
    super(o);
    this.n = Math.max(1, this.p.n || 1);
    this.g = new Float32Array(this.n + 1);
    this.cur = 0;
    this.last = 0;
    this.choose(this.p.open || 0, false);
    if (this.cur) this.g[this.cur] = 1;
  }
  choose(v, step) {
    if (!step) { this.cur = v >= 1 ? Math.min(Math.floor(v), this.n) : 0; return; }
    const w = Math.floor(v);
    if (w === this.last) return;
    this.last = w;
    this.cur = w <= 0 ? 0 : this.cur >= this.n ? 1 : this.cur + 1;
  }
  msg(d) {
    if (this.p.sigctl) return;
    if (d.sel !== undefined) this.choose(d.sel, this.p.step);
    if (d.next) this.cur = this.cur <= 0 || this.cur >= this.n ? 1 : this.cur + 1;
  }
  // moves each gain one sample towards 1 (chosen) or 0
  glide(rate) {
    const g = this.g;
    for (let k = 1; k <= this.n; k++) {
      const t = k === this.cur ? 1 : 0;
      if (g[k] !== t) g[k] = g[k] < t ? Math.min(t, g[k] + rate) : Math.max(t, g[k] - rate);
    }
  }
  rate() { return this.p.ramp > 0 ? 1000 / (this.p.ramp * sampleRate) : 1; }
}
class Selector extends Switch {
  process(inputs, outputs) {
    const out = outputs[0][0], n = this.n, g = this.g, rate = this.rate(), step = this.p.step;
    const ctl = this.p.sigctl ? sig(inputs, 0) : null;
    const ins = [];
    for (let k = 1; k <= n; k++) ins[k] = sig(inputs, k);
    for (let i = 0; i < out.length; i++) {
      if (ctl) this.choose(ctl[i], step);
      this.glide(rate);
      let y = 0;
      for (let k = 1; k <= n; k++) if (g[k] && ins[k]) y += ins[k][i] * g[k];
      out[i] = y;
    }
    return this.alive;
  }
}
class GateSig extends Switch {
  process(inputs, outputs) {
    const n = this.n, g = this.g, rate = this.rate(), step = this.p.step;
    const ctl = this.p.sigctl ? sig(inputs, 0) : null, x = sig(inputs, 1);
    const len = outputs[0][0].length;
    for (let i = 0; i < len; i++) {
      if (ctl) this.choose(ctl[i], step);
      this.glide(rate);
      const v = x ? x[i] : 0;
      for (let k = 1; k <= n; k++) outputs[k - 1][0][i] = v * g[k];
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ limi~
// Lookahead peak limiter. The input is delayed by `lookahead` samples; the
// gain needed by the loudest coming sample (sliding minimum) is smoothed by
// a moving average over the same length, so it is reached exactly when that
// sample comes out. Then the gain recovers in `release` ms (mode 0 linear,
// 1 exponential). All channels share the same gain.
class Limiter extends Base {
  constructor(o) {
    super(o);
    this.ch = Math.max(1, this.p.ch || 1);
    this.size = Math.max(1, this.p.bufsize || 512);
    this.reset();
  }
  look() { return Math.max(0, Math.min(this.size, Math.round(this.p.lookahead ?? 100))); }
  reset() {
    const L = this.L = this.look();
    this.dl = Array.from({ length: this.ch }, () => new Float32Array(L + 1));
    this.dw = 0;
    let cap = 4;
    while (cap < L + 2) cap *= 2;
    this.mask = cap - 1;
    this.qv = new Float32Array(cap);
    this.qi = new Float64Array(cap);
    this.head = 0; this.tail = 0; this.t = 0;
    this.ring = new Float64Array(Math.max(1, L));
    this.ri = 0;
    this.sum = Math.max(1, L);
    this.ring.fill(1);
    this.g = 1;
    this.dc = Array.from({ length: this.ch }, () => ({ x1: 0, y1: 0 }));
  }
  msg(d) {
    if (d.clear || (d.set && "lookahead" in d.set && this.look() !== this.L)) this.reset();
  }
  process(inputs, outputs) {
    const ch = this.ch, L = this.L, p = this.p;
    const len = outputs[0][0].length;
    const xs = [];
    for (let c = 0; c < ch; c++) xs.push(sig(inputs, c));
    if (p.bypass) {
      for (let c = 0; c < ch; c++) {
        const o = outputs[c][0], x = xs[c];
        for (let i = 0; i < len; i++) o[i] = x ? x[i] : 0;
      }
      return this.alive;
    }
    const thr = Math.pow(10, (p.threshold || 0) / 20);
    const pre = Math.pow(10, (p.preamp || 0) / 20), post = Math.pow(10, (p.postamp || 0) / 20);
    const relN = Math.max(1, (p.release ?? 1000) * sampleRate / 1000);
    const step = 1 / relN, coef = Math.exp(-4.6 / relN);
    const qv = this.qv, qi = this.qi, mask = this.mask;
    for (let i = 0; i < len; i++) {
      let peak = 0;
      for (let c = 0; c < ch; c++) {
        let v = xs[c] ? xs[c][i] : 0;
        if (p.dcblock) {
          const s = this.dc[c];
          const y = v - s.x1 + 0.995 * s.y1;
          s.x1 = v; s.y1 = y; v = y;
        }
        v *= pre;
        this.dl[c][this.dw] = v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
      const r = peak > thr ? thr / peak : 1;
      // sliding minimum of r over the last L + 1 samples
      const t = this.t++;
      while (this.tail > this.head && qv[(this.tail - 1) & mask] >= r) this.tail--;
      qv[this.tail & mask] = r; qi[this.tail & mask] = t; this.tail++;
      while (qi[this.head & mask] < t - L) this.head++;
      const m = qv[this.head & mask];
      // moving average over L samples
      let target = m;
      if (L > 0) {
        this.sum += m - this.ring[this.ri];
        this.ring[this.ri] = m;
        this.ri = (this.ri + 1) % L;
        target = Math.min(1, this.sum / L);
      }
      if (target < this.g) this.g = target;
      else this.g = p.mode === 0 ? Math.min(target, this.g + step) : target - (target - this.g) * coef;
      const rd = (this.dw + 1) % (L + 1); // oldest sample = delayed by L
      for (let c = 0; c < ch; c++) outputs[c][0][i] = this.dl[c][rd] * this.g * post;
      this.dw = rd;
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ recorder
// Collects the stereo output while recording and sends it in chunks.
class Recorder extends Base {
  constructor(o) {
    super(o);
    this.on = false;
    this.chunk = 16384;
    this.newBufs();
  }
  newBufs() { this.L = new Float32Array(this.chunk); this.R = new Float32Array(this.chunk); this.n = 0; }
  flush() {
    if (!this.n) return;
    const L = this.L.slice(0, this.n), R = this.R.slice(0, this.n);
    this.port.postMessage({ L, R }, [L.buffer, R.buffer]);
    this.n = 0;
  }
  msg(d) {
    if (d.rec !== undefined) {
      if (!d.rec) { this.flush(); this.port.postMessage({ done: 1 }); }
      this.on = !!d.rec;
    }
  }
  process(inputs) {
    if (!this.on) return this.alive;
    const inp = inputs[0];
    const l = inp && inp.length ? inp[0] : null, r = inp && inp.length > 1 ? inp[1] : l;
    const len = l ? l.length : 128;
    for (let i = 0; i < len; i++) {
      this.L[this.n] = l ? l[i] : 0;
      this.R[this.n] = r ? r[i] : 0;
      if (++this.n >= this.chunk) this.flush();
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ sfplay~
// Plays a sound file decoded by the page, which sends its channels once
// ({load: [Float32Array, ...]}). Outputs: one per channel of the object,
// then the position in ms when p.pos is set. Messages: {play: [from, to]}
// in samples, {stop}, {pause}, {resume}; params rate (speed, negative
// plays backwards) and loop. Posts {done: 1} when the file or the region
// ends (not while looping) and after {stop}.
// Cubic reading at a fractional position, clamped at the edges.
function readEdge(b, pos, n) {
  const i = Math.floor(pos), f = pos - i;
  if (f === 0) return b[i];
  const at = (k) => b[k < 0 ? 0 : k >= n ? n - 1 : k];
  const xm1 = at(i - 1), x0 = at(i), x1 = at(i + 1), x2 = at(i + 2);
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}
class SfPlay extends Base {
  constructor(o) {
    super(o);
    this.data = [];
    this.len = 0;
    this.pos = 0;
    this.from = 0;
    this.to = 0;
    this.state = 0; // 0 stopped, 1 playing, 2 paused
  }
  msg(d) {
    if (d.load) {
      this.data = d.load;
      this.len = d.load.length ? d.load[0].length : 0;
      this.state = 0;
      this.pos = 0;
    }
    if (d.play && this.len) {
      this.from = Math.min(Math.max(0, Math.floor(d.play[0])), this.len - 1);
      this.to = Math.min(Math.max(this.from + 1, Math.floor(d.play[1])), this.len);
      this.pos = this.p.rate < 0 ? this.to - 1 : this.from;
      this.state = 1;
    }
    if (d.stop && this.state) {
      this.state = 0;
      this.port.postMessage({ done: 1 });
    }
    if (d.pause && this.state === 1) this.state = 2;
    if (d.resume && this.state === 2) this.state = 1;
  }
  process(inputs, outputs) {
    const posOut = this.p.pos ? outputs[outputs.length - 1][0] : null;
    const nch = outputs.length - (posOut ? 1 : 0);
    const n = outputs[0][0].length, ms = 1000 / sampleRate;
    let i = 0;
    if (this.state === 1) {
      const rate = this.p.rate, loop = this.p.loop, span = this.to - this.from;
      for (; i < n; i++) {
        for (let c = 0; c < nch; c++) {
          const b = this.data[c];
          outputs[c][0][i] = b ? readEdge(b, this.pos, this.len) : 0;
        }
        if (posOut) posOut[i] = this.pos * ms;
        this.pos += rate;
        if (this.pos >= this.to || this.pos < this.from) {
          if (loop && span > 0) {
            while (this.pos >= this.to) this.pos -= span;
            while (this.pos < this.from) this.pos += span;
          } else {
            this.state = 0;
            this.pos = Math.min(Math.max(this.pos, this.from), this.to - 1);
            this.port.postMessage({ done: 1 });
            i++;
            break;
          }
        }
      }
    }
    for (; i < n; i++) {
      for (let c = 0; c < nch; c++) outputs[c][0][i] = 0;
      if (posOut) posOut[i] = this.pos * ms;
    }
    return this.alive;
  }
}

// ------------------------------------------------------------ playlist~
// The page decodes each clip and sends it once ({clip: {id, data}}); the
// order of the clips comes with {order: [ids]}, their settings with
// {clipset: {id, s, e, loop, speed}} (selection in samples; speed null =
// the object's speed, p.rate). Playback: {play: {id, at}}, {stop},
// {pause}, {resume}, {seek: {id, at}}, {drop: id}. A selection that moves
// away from the playhead takes it to its start.
// Input: a signal whose integer part starts that clip (0 stops), as cue
// triggering. Outputs: one per channel, then the position (clip number +
// fraction of the clip). Posts {start: id}, {done: id}, {looped: id} and,
// while playing, {pos: [id, fraction]} for the display.
class Playlist extends Base {
  constructor(o) {
    super(o);
    this.clips = new Map();
    this.order = [];
    this.cur = null;
    this.pos = 0;
    this.state = 0; // 0 stopped, 1 playing, 2 paused
    this.lastIn = null;
    this.count = 0;
  }
  rateOf(c) { return c.speed === null || c.speed === undefined ? this.p.rate : c.speed; }
  begin(id, at) {
    const c = this.clips.get(id);
    if (!c || !c.len) return;
    if (this.state && this.cur !== null && this.cur !== id) this.port.postMessage({ done: this.cur });
    this.cur = id;
    const r = this.rateOf(c);
    this.pos = at === undefined || at === null ? (r < 0 ? c.e - 1 : c.s) : Math.min(Math.max(at, c.s), c.e - 1);
    this.state = 1;
    this.port.postMessage({ start: id });
    this.report();
  }
  end() {
    if (!this.state) return;
    this.state = 0;
    this.port.postMessage({ done: this.cur });
    this.report();
  }
  report() {
    const c = this.clips.get(this.cur);
    this.port.postMessage({ pos: c && this.state ? [this.cur, this.pos / c.len, this.state] : null });
  }
  msg(d) {
    if (d.clip) {
      const old = this.clips.get(d.clip.id) || { s: 0, e: 0, loop: 0, speed: null };
      const len = d.clip.data.length ? d.clip.data[0].length : 0;
      this.clips.set(d.clip.id, Object.assign(old, { data: d.clip.data, len, s: 0, e: len }));
    }
    if (d.order) this.order = d.order;
    if (d.clipset) {
      const c = this.clips.get(d.clipset.id);
      if (c) {
        c.s = Math.min(Math.max(0, Math.floor(d.clipset.s)), Math.max(0, c.len - 1));
        c.e = Math.min(Math.max(c.s + 1, Math.floor(d.clipset.e)), c.len);
        c.loop = d.clipset.loop;
        c.speed = d.clipset.speed;
        if (this.cur === d.clipset.id && this.state && (this.pos < c.s || this.pos >= c.e)) {
          this.pos = this.rateOf(c) < 0 ? c.e - 1 : c.s;
        }
      }
    }
    if (d.drop !== undefined) {
      if (this.cur === d.drop) { this.state = 0; this.cur = null; this.report(); }
      this.clips.delete(d.drop);
    }
    if (d.play) this.begin(d.play.id, d.play.at);
    if (d.stop) this.end();
    if (d.pause && this.state === 1) { this.state = 2; this.report(); }
    if (d.resume && this.state === 2) { this.state = 1; this.report(); }
    if (d.seek && this.state && this.cur === d.seek.id) {
      const c = this.clips.get(this.cur);
      if (c) this.pos = Math.min(Math.max(d.seek.at, c.s), c.e - 1);
      this.report();
    }
  }
  process(inputs, outputs) {
    const inp = sig(inputs, 0);
    const posOut = outputs[outputs.length - 1][0];
    const nch = outputs.length - 1, n = posOut.length;
    for (let i = 0; i < n; i++) {
      if (inp) {
        const k = Math.trunc(inp[i]);
        if (k !== this.lastIn) {
          this.lastIn = k;
          if (k === 0) this.end();
          else if (k > 0 && k <= this.order.length) this.begin(this.order[k - 1]);
        }
      }
      const c = this.state ? this.clips.get(this.cur) : null;
      if (this.state === 1 && c) {
        for (let ch = 0; ch < nch; ch++) {
          const b = c.data[ch];
          outputs[ch][0][i] = b ? readEdge(b, this.pos, c.len) : 0;
        }
        posOut[i] = this.order.indexOf(this.cur) + 1 + this.pos / c.len;
        this.pos += this.rateOf(c);
        if (this.pos >= c.e || this.pos < c.s) {
          if (c.loop && c.e > c.s) {
            const span = c.e - c.s;
            while (this.pos >= c.e) this.pos -= span;
            while (this.pos < c.s) this.pos += span;
            this.port.postMessage({ looped: this.cur });
          } else {
            this.end();
          }
        }
      } else {
        for (let ch = 0; ch < nch; ch++) outputs[ch][0][i] = 0;
        posOut[i] = c ? this.order.indexOf(this.cur) + 1 + this.pos / c.len : 0;
      }
    }
    if (this.state === 1 && (this.count += n) >= 2048) { this.count = 0; this.report(); }
    return this.alive;
  }
}

// ------------------------------------------------------------ sfrecord~
// Records its inputs (one channel per inlet) for the page, which writes the
// file. Messages: {rec: {frames}} starts (0 frames = until stop), {loop:
// {frames}} keeps only the most recent frames, {stop} ends. Posts {chunk:
// [Float32Array per channel]} while recording (the loop content at the end),
// then {done: frames}. Output: elapsed time in ms, which stays at the length
// of the last recording once it stops.
class SfRecord extends Base {
  constructor(o) {
    super(o);
    this.nch = Math.max(1, this.p.ch | 0);
    this.mode = 0; // 0 idle, 1 recording, 2 loop recording
    this.chunk = 16384;
    this.elapsed = 0;
    this.count = 0;
  }
  newBufs() {
    this.bufs = [];
    for (let c = 0; c < this.nch; c++) this.bufs.push(new Float32Array(this.chunk));
    this.n = 0;
  }
  flush() {
    if (!this.n) return;
    const out = this.bufs.map((b) => b.slice(0, this.n));
    this.port.postMessage({ chunk: out }, out.map((x) => x.buffer));
    this.n = 0;
  }
  msg(d) {
    if (d.rec) {
      this.mode = 1;
      this.limit = Math.max(0, Math.floor(d.rec.frames || 0));
      this.count = 0;
      this.newBufs();
    }
    if (d.loop) {
      this.mode = 2;
      this.len = Math.max(1, Math.floor(d.loop.frames || 1));
      this.ring = [];
      for (let c = 0; c < this.nch; c++) this.ring.push(new Float32Array(this.len));
      this.w = 0;
      this.count = 0;
    }
    if (d.stop) this.finish();
  }
  finish() {
    let frames = this.count;
    if (this.mode === 1) {
      this.flush();
    } else if (this.mode === 2) {
      // oldest sample first
      const n = Math.min(this.count, this.len), start = this.count > this.len ? this.w : 0;
      const out = this.ring.map((r) => {
        const o = new Float32Array(n);
        for (let i = 0; i < n; i++) o[i] = r[(start + i) % this.len];
        return o;
      });
      this.port.postMessage({ chunk: out }, out.map((x) => x.buffer));
      frames = n;
      this.ring = null;
    } else {
      return;
    }
    this.mode = 0;
    this.elapsed = frames * 1000 / sampleRate;
    this.port.postMessage({ done: frames });
  }
  process(inputs, outputs) {
    const out = outputs[0][0], n = out.length, ms = 1000 / sampleRate;
    if (!this.mode) { out.fill(this.elapsed); return this.alive; }
    const ins = [];
    for (let c = 0; c < this.nch; c++) ins.push(sig(inputs, c));
    for (let i = 0; i < n; i++) {
      if (!this.mode) { out[i] = this.elapsed; continue; }
      if (this.mode === 1) {
        for (let c = 0; c < this.nch; c++) this.bufs[c][this.n] = ins[c] ? ins[c][i] : 0;
        if (++this.n >= this.chunk) this.flush();
      } else {
        for (let c = 0; c < this.nch; c++) this.ring[c][this.w] = ins[c] ? ins[c][i] : 0;
        this.w = (this.w + 1) % this.len;
      }
      this.count++;
      out[i] = this.count * ms;
      if (this.mode === 1 && this.limit && this.count >= this.limit) this.finish();
    }
    return this.alive;
  }
}

registerProcessor("pe-cycle", Cycle);
registerProcessor("pe-saw", Saw);
registerProcessor("pe-rect", Rect);
registerProcessor("pe-tri", Tri);
registerProcessor("pe-lores", Lores);
registerProcessor("pe-adsr", Adsr);
registerProcessor("pe-line", Line);
registerProcessor("pe-tapin", TapIn);
registerProcessor("pe-tapout", TapOut);
registerProcessor("pe-pitchshift", PitchShift);
registerProcessor("pe-cverb", CVerb);
registerProcessor("pe-clip", ClipSig);
registerProcessor("pe-limi", Limiter);
registerProcessor("pe-selector", Selector);
registerProcessor("pe-gate", GateSig);
registerProcessor("pe-phasor", Phasor);
registerProcessor("pe-probe", Probe);
registerProcessor("pe-degrade", Degrade);
registerProcessor("pe-overdrive", Overdrive);
registerProcessor("pe-comb", Comb);
registerProcessor("pe-reson", Reson);
registerProcessor("pe-freqshift", FreqShift);
registerProcessor("pe-buffer", BufferProc);
registerProcessor("pe-record", RecordProc);
registerProcessor("pe-groove", GrooveProc);
registerProcessor("pe-rec", Recorder);
registerProcessor("pe-sfplay", SfPlay);
registerProcessor("pe-playlist", Playlist);
registerProcessor("pe-sfrec", SfRecord);

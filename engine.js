/* Patcher engine: Max-style objects on top of Web Audio, and the patch model
   (boxes + patch cords) in the same JSON format as Max .maxpat files. */
(function () {
  "use strict";

  // ------------------------------------------------------------ audio graph
  const AC = new (window.AudioContext || window.webkitAudioContext)();
  const master = AC.createGain();
  const merger = AC.createChannelMerger(2);
  merger.connect(master);
  master.connect(AC.destination);
  // Silent sink: keeps analysers and unconnected branches running.
  const sink = AC.createGain();
  sink.gain.value = 0;
  sink.connect(AC.destination);
  // Target for signal inlets that ignore their input.
  const nullIn = AC.createGain();
  nullIn.connect(sink);

  // Custom DSP (worklet.js). Without it, simpler built-in nodes are used.
  let WK = false;
  const ready = (async () => {
    try {
      if (!AC.audioWorklet || typeof AudioWorkletNode === "undefined") throw new Error("AudioWorklet not supported");
      const url = new URL("worklet.js", document.baseURI).href;
      await Promise.race([
        AC.audioWorklet.addModule(url),
        new Promise((res, rej) => setTimeout(() => rej(new Error("timeout")), 6000)),
      ]);
      WK = true;
    } catch (err) {
      console.warn("worklet not loaded, using built-in nodes:", err);
    }
    return WK;
  })();

  function wnode(name, nin, nout, params) {
    return new AudioWorkletNode(AC, name, {
      numberOfInputs: nin, numberOfOutputs: nout, outputChannelCount: new Array(nout).fill(1),
      channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers",
      processorOptions: { params },
    });
  }

  function konst(value) {
    const c = AC.createConstantSource();
    c.offset.value = value;
    c.start();
    return c;
  }

  let noiseBuf = null;
  function noiseBuffer() {
    if (!noiseBuf) {
      noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  function setParam(param, value, tc) {
    const t = AC.currentTime;
    param.cancelScheduledValues(t);
    param.setTargetAtTime(value, t, tc || 0.003);
  }
  function jumpParam(param, value) {
    const t = AC.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(value, t);
  }

  // ------------------------------------------------------------ atoms
  const BANG = ["bang"];
  const isBang = (m) => m.length > 0 && m[0] === "bang";
  const isNumText = (t) => /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t);
  function parseAtoms(text) {
    return String(text).trim().split(/\s+/).filter(Boolean)
      .map((t) => (isNumText(t) ? Number(t) : t));
  }
  function num(m) {
    for (const a of m) if (typeof a === "number") return a;
    return 0;
  }
  const sel = (m) => (m.length && typeof m[0] === "string" ? m[0] : null);
  const isNum = (m) => m.length > 0 && typeof m[0] === "number";
  function fmt(x) {
    if (typeof x !== "number") return String(x);
    if (Number.isInteger(x)) return String(x);
    return String(Math.round(x * 1e6) / 1e6);
  }
  const fmtMsg = (m) => m.map(fmt).join(" ");

  // "name a b @attr x y" -> args [a, b], attrs { attr: [x, y] }
  function splitAttrs(atoms) {
    const args = [], attrs = {};
    const isAttr = (t) => typeof t === "string" && t.length > 1 && t[0] === "@";
    let k = 0;
    while (k < atoms.length && !isAttr(atoms[k])) args.push(atoms[k++]);
    while (k < atoms.length) {
      const name = String(atoms[k++]).slice(1), vals = [];
      while (k < atoms.length && !isAttr(atoms[k])) vals.push(atoms[k++]);
      attrs[name] = vals;
    }
    return { args, attrs };
  }
  let ATTRS = {}; // attributes of the object being created

  // ------------------------------------------------------------ base object
  class Obj {
    constructor(patch, box, args) {
      this.patch = patch;
      this.box = box;
      this.args = args;
      this.attrs = ATTRS;
      this.nin = 1;
      this.outTypes = [""];
      this.sigIn = new Set();
      this.sigCount = {};
    }
    get name() {
      if (this.box.maxclass !== "newobj") return this.box.maxclass;
      return String(this.box.text || "").trim().split(/\s+/)[0] || "newobj";
    }
    attr(name, def) {
      const v = this.attrs[name];
      return v && v.length ? v[0] : def;
    }
    // Position and size in the current view: patch or presentation.
    rect() {
      const b = this.box;
      return this.patch.presenting && b.presentation && b.presentation_rect ? b.presentation_rect : b.patching_rect;
    }
    // Box attribute saved in the .maxpat (GUI objects), or default.
    battr(name, def) { return this.box[name] !== undefined ? this.box[name] : def; }
    nope(m) { this.patch.log(`${this.name}: non capisce il messaggio "${fmtMsg(m)}"`); }
    receive() {}
    out(outlet, msg) { this.patch.send(this.box.id, outlet, msg); }
    sigOut() { return null; }
    sigTarget() { return { node: nullIn }; }
    sigConnected(inlet, delta) {
      this.sigCount[inlet] = (this.sigCount[inlet] || 0) + delta;
      if (this.onSig) this.onSig(inlet, this.sigCount[inlet]);
    }
    destroy() {}
    build() {}
    draw() {}
    press() { return null; }
    loadbang() {}
  }

  // Object running custom DSP in the audio worklet.
  class WObj extends Obj {
    dsp(name, nin, nout, params) {
      this.node = wnode(name, nin, nout, params);
      this.node.connect(sink);
      this.node.port.onmessage = (e) => this.fromDsp(e.data);
    }
    fromDsp() {}
    post(d) { this.node.port.postMessage(d); }
    setp(o) { this.post({ set: o }); }
    sigOut(o) { return this.outTypes[o] === "signal" ? { node: this.node, index: o } : null; }
    sigTarget(i) { return i < this.node.numberOfInputs ? { node: this.node, input: i } : { node: nullIn }; }
    destroy() { this.node.port.onmessage = null; this.post({ end: 1 }); this.node.disconnect(); }
  }

  class Bad extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.bad = true;
      this.nin = b.numinlets || 1;
      this.outTypes = b.outlettype && b.outlettype.length ? b.outlettype.slice()
        : new Array(b.numoutlets || 1).fill("");
    }
  }

  // Types from creation arguments, as in pack/unpack: 0 -> int, 0. -> float, s -> symbol.
  function argTypes(box, args, def) {
    const toks = String(box.text || "").trim().split(/\s+/).slice(1);
    const n = args.length;
    if (!n) return def.map((d) => ({ type: d, init: d === "f" ? 0 : d === "s" ? "" : 0 }));
    return args.map((a, k) => {
      const t = toks[k] || "";
      if (typeof a === "number") return t.includes(".") || /e/i.test(t) ? { type: "f", init: a } : { type: "i", init: a };
      if (a === "f" || a === "float") return { type: "f", init: 0 };
      if (a === "i" || a === "int") return { type: "i", init: 0 };
      if (a === "s" || a === "sym" || a === "symbol") return { type: "s", init: "" };
      if (a === "l" || a === "list") return { type: "l", init: 0 };
      return { type: "s", init: a };
    });
  }
  function coerce(type, v) {
    if (type === "i") return typeof v === "number" ? Math.trunc(v) : 0;
    if (type === "f") return typeof v === "number" ? v : 0;
    return v;
  }

  // ------------------------------------------------------------ control objects
  class Mtof extends Obj {
    constructor(p, b, a) { super(p, b, a); this.v = [0]; this.base = Number(this.attr("base", 440)) || 440; }
    receive(i, m) {
      if (sel(m) === "base") { this.base = num(m.slice(1)) || 440; return; }
      if (!isBang(m)) {
        if (!isNum(m)) return this.nope(m);
        this.v = m.filter((x) => typeof x === "number").map((x) => this.base * Math.pow(2, (x - 69) / 12));
      }
      this.out(0, this.v);
    }
  }

  class Ftom extends Obj {
    constructor(p, b, a) { super(p, b, a); this.v = [0]; this.base = Number(this.attr("base", 440)) || 440; }
    receive(i, m) {
      if (sel(m) === "base") { this.base = num(m.slice(1)) || 440; return; }
      if (!isBang(m)) {
        if (!isNum(m)) return this.nope(m);
        this.v = m.filter((x) => typeof x === "number").map((f) => (f > 0 ? 69 + 12 * Math.log2(f / this.base) : -1500));
      }
      this.out(0, this.v);
    }
  }

  class Arith extends Obj {
    constructor(p, b, a, op) {
      super(p, b, a);
      this.op = op;
      this.nin = 2;
      const argText = String(b.text || "").split(/\s+/)[1] || "";
      this.float = argText.includes(".");
      this.r = a.length && typeof a[0] === "number" ? a[0] : 0;
      this.l = 0;
    }
    calc() {
      let l = this.l, r = this.r, v;
      if (!this.float) { l = Math.trunc(l); r = Math.trunc(r); }
      if (this.op === "+") v = l + r;
      else if (this.op === "-") v = l - r;
      else if (this.op === "*") v = l * r;
      else v = r === 0 ? 0 : l / r;
      return this.float ? v : Math.trunc(v);
    }
    receive(i, m) {
      if (i === 1) { if (isNum(m)) this.r = m[0]; else this.nope(m); return; }
      if (sel(m) === "set") { this.l = num(m.slice(1)); return; }
      if (!isBang(m)) {
        if (!isNum(m)) return this.nope(m);
        this.l = m[0];
        if (m.length > 1 && typeof m[1] === "number") this.r = m[1];
      }
      this.out(0, [this.calc()]);
    }
  }

  class Select extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.match = a.length ? a.slice() : [0];
      // As in Max: a right inlet only with no argument or one int argument.
      const word = String(b.text || "").trim().split(/\s+/)[1] || "";
      const oneInt = a.length === 1 && typeof a[0] === "number" && !/[.e]/i.test(word);
      this.nin = !a.length || oneInt ? 2 : 1;
      this.outTypes = this.match.map(() => "bang").concat([""]);
    }
    receive(i, m) {
      if (i === 1) { if (isNum(m)) this.match = [m[0]]; return; }
      const k = this.match.findIndex((x) => x === m[0]);
      if (k >= 0) this.out(k, BANG);
      else this.out(this.match.length, m);
    }
  }

  class Trigger extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.types = a.length ? a.slice() : ["i", "i"];
      this.outTypes = this.types.map(() => "");
    }
    receive(i, m) {
      for (let k = this.types.length - 1; k >= 0; k--) {
        const t = this.types[k];
        let o;
        if (typeof t === "number") o = [t];
        else if (t === "b") o = BANG;
        else if (t === "f") o = [num(m)];
        else if (t === "i") o = [Math.trunc(num(m))];
        else if (t === "l" || t === "a") o = m;
        else if (t === "s") o = [String(m[0])];
        else o = [t];
        this.out(k, o);
      }
    }
  }

  class Store extends Obj {
    constructor(p, b, a, isInt) {
      super(p, b, a);
      this.nin = 2;
      this.isInt = isInt;
      this.v = this.conv(a.length ? num(a) : 0);
    }
    conv(v) { return this.isInt ? Math.trunc(v) : v; }
    receive(i, m) {
      if (sel(m) === "set") { this.v = this.conv(num(m.slice(1))); return; }
      if (!isBang(m)) {
        if (!isNum(m)) return this.nope(m);
        this.v = this.conv(m[0]);
      }
      if (i === 0) this.out(0, [this.v]);
    }
  }

  class Metro extends Obj {
    constructor(p, b, a) { super(p, b, a); this.nin = 2; this.ms = num(a) || Number(this.attr("interval", 5)) || 5; this.t = null; }
    start() {
      this.stop();
      const tick = () => this.out(0, BANG);
      tick();
      this.t = setInterval(tick, Math.max(1, this.ms));
    }
    stop() { if (this.t) clearInterval(this.t); this.t = null; }
    receive(i, m) {
      if (i === 1) { if (isNum(m)) { this.ms = m[0]; if (this.t) this.start(); } return; }
      const s = sel(m);
      if (s === "stop") this.stop();
      else if (s === "interval") { this.ms = num(m.slice(1)); if (this.t) this.start(); }
      else if (isBang(m)) this.start();
      else if (isNum(m)) { if (m[0] !== 0) this.start(); else this.stop(); }
      else this.nope(m);
    }
    destroy() { this.stop(); }
  }

  class Delay extends Obj {
    constructor(p, b, a) { super(p, b, a); this.nin = 2; this.ms = num(a) || 0; this.t = null; }
    receive(i, m) {
      if (i === 1) { if (isNum(m)) this.ms = m[0]; return; }
      const s = sel(m);
      if (s && s !== "bang" && s !== "stop") return this.nope(m);
      if (this.t) clearTimeout(this.t);
      this.t = null;
      if (s === "stop") return;
      if (isNum(m)) this.ms = m[0];
      this.t = setTimeout(() => { this.t = null; this.out(0, BANG); }, Math.max(0, this.ms));
    }
    destroy() { if (this.t) clearTimeout(this.t); }
  }

  class Random extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 2;
      this.n = num(a) || 1;
      this.seed(a.length > 1 && typeof a[1] === "number" ? a[1] : 0);
    }
    seed(s) {
      if (!s) { this.rnd = Math.random; return; }
      let x = Math.trunc(s) >>> 0;
      this.rnd = () => { // mulberry32
        x = (x + 0x6d2b79f5) >>> 0;
        let t = x;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    receive(i, m) {
      if (i === 1) { if (isNum(m)) this.n = m[0]; return; }
      if (sel(m) === "seed") { this.seed(num(m.slice(1))); return; }
      this.out(0, [Math.floor(this.rnd() * Math.max(1, Math.trunc(this.n)))]);
    }
  }

  class Pack extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.types = argTypes(b, a, ["i", "i"]);
      this.vals = this.types.map((t) => t.init);
      this.nin = this.vals.length;
    }
    receive(i, m) {
      if (sel(m) === "set" && i === 0) { if (m.length > 1) this.vals[0] = coerce(this.types[0].type, m[1]); return; }
      if (!isBang(m)) {
        if (i === 0 && m.length > 1) m.forEach((v, k) => { if (k < this.vals.length) this.vals[k] = coerce(this.types[k].type, v); });
        else if (m.length) this.vals[i] = coerce(this.types[i].type, m[0]);
      }
      if (i === 0) this.out(0, this.vals.slice());
    }
  }

  class Unpack extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.types = argTypes(b, a, ["i", "i"]);
      this.outTypes = this.types.map(() => "");
    }
    receive(i, m) {
      for (let k = Math.min(this.types.length, m.length) - 1; k >= 0; k--) this.out(k, [coerce(this.types[k].type, m[k])]);
    }
  }

  // poly [voices] [steal]: voice allocation for notes (16 voices if no
  // argument). Inlets: pitch, velocity. Outlets: voice number, pitch,
  // velocity and, without stealing, the notes it cannot hold (pitch
  // velocity lists). A note-on takes the lowest free voice; a note-off
  // (velocity 0) frees the oldest voice with that pitch. With stealing, a
  // note-on with every voice busy turns off the note held the longest and
  // takes its voice. stop: note-offs for every note held.
  class PolyAlloc extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.n = Math.max(1, Math.trunc(typeof a[0] === "number" ? a[0] : 16));
      this.steal = typeof a[1] === "number" && a[1] !== 0;
      this.nin = 2;
      this.outTypes = ["int", "int", "int"].concat(this.steal ? [] : ["list"]);
      this.vel = 0;
      this.voices = new Array(this.n).fill(null); // { pitch, t } or null
      this.t = 0;
    }
    emit(k, pitch, vel) { this.out(2, [vel]); this.out(1, [pitch]); this.out(0, [k + 1]); }
    note(pitch, vel) {
      pitch = Math.trunc(pitch);
      vel = Math.trunc(vel);
      const v = this.voices;
      if (vel !== 0) {
        let k = v.indexOf(null);
        if (k < 0) {
          if (!this.steal) return this.out(3, [pitch, vel]);
          k = 0;
          for (let i = 1; i < v.length; i++) if (v[i].t < v[k].t) k = i;
          const old = v[k];
          v[k] = null;
          this.emit(k, old.pitch, 0);
        }
        v[k] = { pitch, t: this.t++ };
        return this.emit(k, pitch, vel);
      }
      let k = -1;
      for (let i = 0; i < v.length; i++) if (v[i] && v[i].pitch === pitch && (k < 0 || v[i].t < v[k].t)) k = i;
      if (k < 0) { if (!this.steal) this.out(3, [pitch, 0]); return; } // its note-on went out the overflow outlet
      v[k] = null;
      this.emit(k, pitch, 0);
    }
    receive(i, m) {
      if (i === 1) { if (isNum(m)) this.vel = m[0]; else this.nope(m); return; }
      if (sel(m) === "stop") {
        const held = this.voices.map((x, k) => [x, k]).filter(([x]) => x).sort((a, b) => a[0].t - b[0].t);
        for (const [x, k] of held) { this.voices[k] = null; this.emit(k, x.pitch, 0); }
        return;
      }
      if (isNum(m)) {
        if (typeof m[1] === "number") this.vel = m[1]; // pitch velocity
        return this.note(m[0], this.vel);
      }
      this.nope(m);
    }
  }

  const bus = new Map();
  class Send extends Obj {
    constructor(p, b, a) { super(p, b, a); this.dest = String(a[0] || ""); this.outTypes = []; }
    receive(i, m) { this.patch.sendTo(this.dest, m); }
  }
  class Receive extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 0;
      this.join(String(a[0] || ""));
    }
    join(name) {
      this.leave();
      this.rname = name;
      if (!bus.has(name)) bus.set(name, new Set());
      bus.get(name).add(this);
    }
    leave() { const s = bus.get(this.rname); if (s) s.delete(this); }
    destroy() { this.leave(); }
  }

  class Print extends Obj {
    constructor(p, b, a) { super(p, b, a); this.label = a.length ? String(a[0]) : "print"; this.outTypes = []; }
    receive(i, m) { this.patch.log(this.label + ": " + fmtMsg(m)); }
  }

  class Loadbang extends Obj {
    loadbang() { this.out(0, BANG); }
    receive() { this.out(0, BANG); }
  }
  class Loadmess extends Obj {
    loadbang() { if (this.args.length) this.out(0, this.args.slice()); }
    receive(i, m) {
      if (sel(m) === "set") { this.args = m.slice(1); return; }
      this.loadbang();
    }
  }

  // counter [dir] [min] max: counts bangs. dir 0 up, 1 down, 2 up and down.
  // Inlets: 0 count, 1 direction, 2 set next value, 3 set and output,
  // 4 max. Outlets: 0 count, 1 down limit, 2 up limit, 3 times max reached.
  class Counter extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 5;
      this.outTypes = ["", "", "", ""];
      const n = a.filter((x) => typeof x === "number").map(Math.trunc);
      this.dir = 0; this.min = 0; this.max = 2147483647;
      if (n.length === 1) this.max = n[0];
      else if (n.length === 2) [this.min, this.max] = n;
      else if (n.length >= 3) [this.dir, this.min, this.max] = n;
      this.dir = [0, 1, 2].includes(this.dir) ? this.dir : 0;
      this.down = this.dir === 1;
      this.count = this.down ? this.max : this.min; // next value out
      this.last = this.count;
      this.atMax = false; this.atMin = false;
      this.carries = 0;
      this.carryBang = false;
    }
    top() { return Math.max(this.min, this.max); }
    // Output v (with the limit outlets), then prepare the next value.
    fire(v) {
      const lo = this.min, hi = this.top();
      if (this.dir !== 1 && v >= hi) {
        this.carries++;
        this.out(3, [this.carries]);
        this.out(2, this.carryBang ? BANG : [1]);
        this.atMax = true;
      } else if (this.atMax) {
        this.atMax = false;
        if (!this.carryBang) this.out(2, [0]);
      }
      if (this.dir !== 0 && v <= lo) {
        this.out(1, this.carryBang ? BANG : [1]);
        this.atMin = true;
      } else if (this.atMin) {
        this.atMin = false;
        if (!this.carryBang) this.out(1, [0]);
      }
      this.last = v;
      this.out(0, [v]);
      this.count = this.step(v);
    }
    step(v) {
      const lo = this.min, hi = this.top();
      if (lo === hi) return lo;
      if (this.dir === 0) return v >= hi ? lo : v + 1;
      if (this.dir === 1) return v <= lo ? hi : v - 1;
      if (v >= hi) this.down = true;
      else if (v <= lo) this.down = false;
      return this.down ? v - 1 : v + 1;
    }
    setDir(d) {
      this.dir = [0, 1, 2].includes(d) ? d : 0;
      if (this.dir !== 2) this.down = this.dir === 1;
      this.count = this.step(this.last);
    }
    receive(i, m) {
      const s = sel(m), x = Math.trunc(num(m.slice(s ? 1 : 0)));
      if (i === 1) {
        if (isBang(m)) {
          if (this.dir === 2) this.down = !this.down;
          else this.dir = this.dir === 0 ? 1 : 0;
          this.count = this.step(this.last);
        } else if (isNum(m)) this.setDir(Math.trunc(m[0]));
        return;
      }
      if (i === 2 || i === 3) {
        if (isBang(m)) this.count = this.min;
        else if (isNum(m)) {
          this.count = Math.trunc(m[0]);
          if (this.count < this.min) this.min = this.count;
          if (this.count > this.top()) this.min = this.top();
        } else return this.nope(m);
        if (i === 3) this.fire(this.count);
        return;
      }
      if (i === 4) {
        if (isBang(m)) this.fire(this.top());
        else if (isNum(m)) this.max = Math.trunc(m[0]);
        return;
      }
      if (isBang(m) || isNum(m) || s === "next") return this.fire(this.count);
      if (s === "inc" || s === "dec") {
        let v = this.last + (s === "inc" ? 1 : -1);
        if (v > this.top()) v = this.min;
        if (v < this.min) v = this.top();
        return this.fire(v);
      }
      if (s === "set" || s === "goto") { this.count = x; return; }
      if (s === "jam") {
        if (x >= this.min && x <= this.top()) this.fire(x);
        return;
      }
      if (s === "min") {
        this.min = Math.min(x, this.top());
        return this.fire(this.min);
      }
      if (s === "max") { this.max = x; return; }
      if (s === "setmin") { this.min = x; return; }
      if (s === "up") return this.setDir(0);
      if (s === "down") return this.setDir(1);
      if (s === "updown") return this.setDir(2);
      if (s === "carrybang") { this.carryBang = true; return; }
      if (s === "carryint") { this.carryBang = false; return; }
      if (s === "flags") { this.carryBang = x !== 0; return; }
      if (s === "state") {
        const d = ["up", "down", "updown"][this.dir];
        return this.patch.log(`counter: ${d}, min ${this.min}, ` +
          `max ${this.top()}, next ${this.count}, max reached ${this.carries}`);
      }
      this.nope(m);
    }
  }

  // line [initial] [grain]: ramps between numbers at control rate.
  // Inlets: 0 target or list, 1 ramp time (ms), 2 grain (ms).
  // Outlets: 0 values every `grain` ms, 1 bang at the end.
  class LineCtl extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 3;
      this.outTypes = ["", "bang"];
      const word = String(b.text || "").trim().split(/\s+/)[1] || "";
      this.floatArg = typeof a[0] === "number" && word.includes(".");
      this.v = typeof a[0] === "number" ? a[0] : 0;
      this.grain = typeof a[1] === "number" && a[1] >= 1 ? a[1] : 20;
      if (this.attrs.grain) this.grain = Math.max(1, num(this.attrs.grain));
      // floatoutput: 0 off, 1 on (float argument), 2 auto (default)
      this.floatMode = this.attrs.floatoutput ? num(this.attrs.floatoutput) : 2;
      this.time = 0;
      this.segs = [];
      this.ramp = null;
      this.timer = null;
      this.paused = false;
    }
    conv(v) { return this.useFloat ? v : Math.trunc(v); }
    emit(v) { this.out(0, [this.conv(v)]); }
    clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
    // Start the next pending segment, or finish with a bang.
    next() {
      this.clearTimer();
      const seg = this.segs.shift();
      if (!seg) { this.ramp = null; this.out(1, BANG); return; }
      const [to, ms] = seg;
      const from = this.v;
      const auto = this.floatMode === 2 && Math.abs(to - from) <= 1 &&
        (ms <= 0 || Math.abs(to - from) * this.grain / ms < 0.4);
      this.useFloat = this.floatMode !== 0 && (this.floatArg || auto);
      if (ms <= 0) { this.v = to; this.emit(to); this.next(); return; }
      this.ramp = { from, to, ms, t0: performance.now(), done: 0 };
      this.tick();
    }
    tick() {
      const r = this.ramp;
      if (!r || this.paused) return;
      const t = Math.min(r.ms, performance.now() - r.t0);
      this.v = r.from + (r.to - r.from) * (t / r.ms);
      if (t >= r.ms) { this.v = r.to; this.emit(r.to); this.next(); return; }
      this.emit(this.v);
      this.timer = setTimeout(() => this.tick(), this.grain);
    }
    start(segs) {
      this.segs = segs;
      this.paused = false;
      this.next();
    }
    receive(i, m) {
      const s = sel(m);
      if (i === 1) { if (isNum(m)) this.time = m[0]; return; }
      if (i === 2) { if (isNum(m)) this.grain = m[0] >= 1 ? m[0] : 20; return; }
      if (s === "stop") { this.clearTimer(); this.ramp = null; this.segs = []; return; }
      if (s === "set") {
        this.clearTimer(); this.ramp = null; this.segs = [];
        this.v = num(m.slice(1));
        return;
      }
      if (s === "pause") {
        if (this.ramp && !this.paused) {
          this.paused = true;
          this.clearTimer();
          this.ramp.left = this.ramp.ms - (performance.now() - this.ramp.t0);
        }
        return;
      }
      if (s === "resume") {
        if (this.ramp && this.paused) {
          this.paused = false;
          this.ramp = { from: this.v, to: this.ramp.to,
            ms: Math.max(1, this.ramp.left), t0: performance.now() };
          this.tick();
        }
        return;
      }
      if (isBang(m)) return;
      if (!isNum(m)) return this.nope(m);
      const n = m.filter((x) => typeof x === "number");
      let segs;
      if (n.length === 1) segs = [[n[0], this.time]];
      else if (n.length <= 3) {
        segs = [[n[0], n[1]]];
        if (n.length === 3 && n[2] >= 1) this.grain = n[2];
      } else {
        segs = [];
        for (let k = 0; k + 1 < n.length; k += 2) segs.push([n[k], n[k + 1]]);
      }
      this.time = 0;
      this.start(segs);
    }
    destroy() { this.clearTimer(); }
  }

  // ------------------------------------------------------------ signal objects (worklet)
  // cycle~: frequency, phase (0..1); a signal in the phase inlet = phase modulation.
  class Cycle extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 2;
      this.outTypes = ["signal"];
      this.sigIn = new Set([0, 1]);
      const freq = typeof a[0] === "number" ? a[0] : Number(this.attr("frequency", 0)) || 0;
      this.dsp("pe-cycle", 2, 1, { freq, phase: Number(this.attr("phase", 0)) || 0 });
    }
    receive(i, m) {
      const s = sel(m);
      if (s === "frequency") return this.setp({ freq: num(m.slice(1)) });
      if (s === "phase") return this.setp({ phase: num(m.slice(1)) });
      if (s === "reset") return this.post({ reset: num(m.slice(1)) });
      if (s === "set" || s === "setall" || s === "buffer") return this.patch.log(`${this.name}: le tabelle (buffer~) non sono disponibili, uso il coseno`);
      if (isBang(m)) return;
      if (!isNum(m)) return this.nope(m);
      this.setp(i === 0 ? { freq: m[0] } : { phase: m[0] });
    }
  }

  // saw~ (frequency, sync), rect~ / tri~ (frequency, pulse width or duty, sync).
  class Shape extends WObj {
    constructor(p, b, a, kind) {
      super(p, b, a);
      this.kind = kind;
      this.nin = kind === "saw" ? 2 : 3;
      this.outTypes = ["signal"];
      this.sigIn = new Set(kind === "saw" ? [0, 1] : [0, 1, 2]);
      const params = { freq: typeof a[0] === "number" ? a[0] : 0, width: typeof a[1] === "number" ? a[1] : 0.5 };
      this.dsp("pe-" + kind, this.nin, 1, params);
    }
    receive(i, m) {
      const s = sel(m);
      if (s === "synctrig") return this.setp({ synctrig: num(m.slice(1)) });
      if (isBang(m)) return;
      if (!isNum(m)) return this.nope(m);
      if (i === 0) this.setp({ freq: m[0] });
      else if (i === 1 && this.kind !== "saw") this.setp({ width: m[0] });
    }
  }

  // lores~: input, cutoff, resonance (0..1).
  class Lores extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 3;
      this.outTypes = ["signal"];
      this.sigIn = new Set([0, 1, 2]);
      this.dsp("pe-lores", 3, 1, { cutoff: typeof a[0] === "number" ? a[0] : 0, res: typeof a[1] === "number" ? a[1] : 0 });
    }
    receive(i, m) {
      if (sel(m) === "clear") return this.post({ clear: 1 });
      if (isBang(m)) return;
      if (!isNum(m)) return this.nope(m);
      if (i === 1) this.setp({ cutoff: m[0] });
      else if (i === 2) this.setp({ res: m[0] });
    }
  }

  // adsr~: trigger (number or signal), attack, decay, sustain, release.
  const ADSR_ATTRS = ["attack", "decay", "sustain", "release", "legato", "maxsustain", "retrigger", "triggermode"];
  class Adsr extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 5;
      this.outTypes = ["signal", "signal", "", ""];
      this.sigIn = new Set([0, 1, 2, 3, 4]);
      const v = (k, d) => (typeof a[k] === "number" ? a[k] : d);
      this.p = { attack: v(0, 10), decay: v(1, 10), sustain: v(2, 1), release: v(3, 10), legato: 0, maxsustain: -1, retrigger: 5, triggermode: 0 };
      for (const k of ADSR_ATTRS) if (this.attrs[k]) this.p[k] = num(this.attrs[k]);
      this.dsp("pe-adsr", 5, 2, Object.assign({}, this.p));
    }
    setv(o) { Object.assign(this.p, o); this.setp(o); }
    receive(i, m) {
      const s = sel(m);
      if (s) {
        if (ADSR_ATTRS.includes(s)) return this.setv({ [s]: num(m.slice(1)) });
        if (s.startsWith("get") && ADSR_ATTRS.includes(s.slice(3))) return this.out(3, [s.slice(3), this.p[s.slice(3)]]);
        if (s === "bang") return;
        return this.nope(m);
      }
      if (!isNum(m)) return;
      if (i > 0) return this.setv({ [ADSR_ATTRS[i - 1]]: m[0] });
      if (m.length >= 2) {
        const o = {};
        m.slice(0, 4).forEach((x, k) => { if (typeof x === "number") o[ADSR_ATTRS[k]] = x; });
        return this.setv(o);
      }
      this.post({ trig: m[0] });
    }
    fromDsp(d) { if (d.mute !== undefined) this.out(2, ["mute", d.mute]); }
  }

  // line~: ramps from target/time pairs; bang on the right when finished.
  class Line extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 2;
      this.outTypes = ["signal", "bang"];
      this.next = 0;
      this.dsp("pe-line", 0, 1, { init: num(a) });
    }
    receive(i, m) {
      if (i === 1) { if (isNum(m)) this.next = m[0]; return; }
      const s = sel(m);
      if (s === "stop" || s === "pause" || s === "resume") return this.post({ [s]: 1 });
      if (isBang(m)) return;
      if (!isNum(m)) return this.nope(m);
      let segs;
      if (m.length === 1) segs = [[m[0], this.next]];
      else {
        segs = [];
        for (let k = 0; k < m.length && segs.length < 128; k += 2) segs.push([Number(m[k]) || 0, Number(m[k + 1]) || 0]);
      }
      this.next = 0;
      this.post({ line: segs });
    }
    fromDsp(d) { if (d.done) this.out(1, BANG); }
  }

  // tapin~ [max ms]: writes its input into a delay memory (default 100 ms).
  // Its outlet is not audio: it links the memory to the left inlet of tapout~.
  let tapIds = 0;
  class TapIn extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      this.outTypes = ["tapconnect"];
      this.sigIn = new Set([0]);
      this.tapId = ++tapIds;
      this.dsp("pe-tapin", 1, 1, { id: this.tapId, ms: num(a) || 100 });
    }
    receive(i, m) {
      const s = sel(m);
      if (s === "clear") return this.post({ clear: 1 });
      if (s === "freeze") return this.post({ freeze: m.length > 1 ? num(m.slice(1)) : 1 });
      if (isNum(m)) return this.post({ resize: Math.max(1, m[0]) });
      if (!isBang(m)) this.nope(m);
    }
  }

  // tapout~ [ms ms ...]: one tap (inlet and outlet) per delay time.
  // A number sets a fixed delay; a signal gives a continuous delay.
  class TapOut extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      this.delays = a.filter((x) => typeof x === "number");
      if (!this.delays.length) this.delays = [0];
      const n = this.delays.length;
      this.nin = n;
      this.outTypes = new Array(n).fill("signal");
      this.sigIn = new Set([...Array(n).keys()]);
      this.acceptsTap = true;
      this.dsp("pe-tapout", n, n, { delays: this.delays.slice(), link: null });
    }
    linkTap(tapin) { this.setp({ link: tapin ? tapin.tapId : null }); }
    receive(i, m) {
      if (sel(m) === "tapconnect") {
        // remote link: the first tapin~ of the patch with no tapout~ attached
        for (const e of this.patch.entries.values()) {
          if (!(e.inst instanceof TapIn)) continue;
          if (this.patch.hasCord(e.box.id, 0)) continue;
          return this.linkTap(e.inst);
        }
        return this.patch.log("tapout~: nessun tapin~ libero a cui collegarsi");
      }
      if (isBang(m)) return;
      if (!isNum(m)) return this.nope(m);
      if (i === 0 && m.length > 1) {
        m.forEach((v, k) => { if (k < this.delays.length && typeof v === "number") this.delays[k] = v; });
      } else this.delays[i] = m[0];
      this.setp({ delays: this.delays.slice() });
    }
  }

  // pitchshift~ [channels]: shifts the pitch of its signal inlets. The
  // rightmost inlet sets the shift as a factor (or in cents, @usecents 1).
  // Delay-line algorithm (not Max's Ztx): "quality" sets the window length.
  const PS_WINDOW = { basic: 40, good: 60, better: 80, best: 100 };
  class PitchShift extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      this.ch = Math.max(1, Math.min(8, Math.trunc(num(a)) || 1));
      this.nin = this.ch + 1;
      this.outTypes = new Array(this.ch).fill("signal").concat([""]);
      this.sigIn = new Set([...Array(this.ch + 1).keys()]);
      const at = (k, d) => (this.attrs[k] ? this.attrs[k][0] : d);
      this.q = String(at("quality", "basic"));
      this.p = {
        ratio: Number(at("pitchshift", 1)) || 1, usecents: Number(at("usecents", 0)) ? 1 : 0,
        enabled: Number(at("enabled", 1)) ? 1 : 0, window: PS_WINDOW[this.q] || 40,
      };
      if (this.attrs.pitchshiftcent) this.p.ratio = Math.pow(2, num(this.attrs.pitchshiftcent) / 1200);
      this.report = Number(at("reportlatency", 0)) ? 1 : 0;
      this.dsp("pe-pitchshift", this.ch + 1, this.ch, Object.assign({ ch: this.ch }, this.p));
      if (this.report) setTimeout(() => this.latency(), 0);
    }
    setv(o) { Object.assign(this.p, o); this.setp(o); }
    latency() { this.out(this.ch, ["latency", Math.round(4 + this.p.window * AC.sampleRate / 2000)]); }
    receive(i, m) {
      const s = sel(m), x = num(m.slice(1));
      if (s === "pitchshift") return this.setv({ ratio: x });
      if (s === "pitchshiftcent") return this.setv({ ratio: Math.pow(2, x / 1200) });
      if (s === "usecents") return this.setv({ usecents: x ? 1 : 0 });
      if (s === "enabled") return this.setv({ enabled: x ? 1 : 0 });
      if (s === "quality") {
        const q = String(m[1] || "basic");
        if (!PS_WINDOW[q]) return this.nope(m);
        this.q = q;
        this.setv({ window: PS_WINDOW[q] });
        if (this.report) this.latency();
        return;
      }
      if (s === "getlatency" || s === "reportlatency") {
        this.report = m.length > 1 ? (x ? 1 : 0) : 1;
        if (this.report) this.latency();
        return;
      }
      if (isBang(m)) return;
      if (!isNum(m)) return this.nope(m);
      if (i === this.ch) {
        this.setv({ ratio: this.p.usecents ? Math.pow(2, m[0] / 1200) : m[0] });
      }
    }
  }

  // cverb~ [ms]: mono reverb; right inlet sets the reverb time in ms.
  class CVerb extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 2;
      this.outTypes = ["signal"];
      this.sigIn = new Set([0, 1]);
      this.dsp("pe-cverb", 2, 1, { time: num(a) || 1000 });
    }
    receive(i, m) {
      if (sel(m) === "clear") return this.post({ clear: 1 });
      if (isBang(m)) return;
      if (!isNum(m)) return this.nope(m);
      if (i === 1) this.setp({ time: m[0] });
    }
  }

  // Decodes a sound file (WAV, MP3...) at the sample rate of the audio.
  function decodeAudio(data) {
    return new Promise((ok, fail) => {
      const r = AC.decodeAudioData(data, ok, fail); // callbacks: older Safari
      if (r && r.then) r.then(ok, fail);
    });
  }
  function mmss(sec) {
    const s = Math.round(sec * 10) / 10, m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
  }

  // sfplay~ [name] [channels] [buffer size] [position outlet]: plays a sound
  // file. "open" asks which file: a web page cannot open files by name.
  // Left inlet: 1 plays, 0 stops, pause, resume, seek ms [end ms], loop,
  // speed, print. Right inlet: speed (negative plays backwards).
  // Outlets: one signal per channel (extra channels are silent), the
  // position in ms if the 4th argument is 1, then a bang when the file
  // ends or is stopped with 0.
  class Sfplay extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      const n = a.filter((x) => typeof x === "number");
      this.ch = Math.max(1, Math.min(8, Math.trunc(n[0] || 1)));
      const posOut = Math.trunc(n[2] || 0) >= 1;
      this.nin = 2;
      this.outTypes = new Array(this.ch).fill("signal").concat(posOut ? ["signal"] : [], ["bang"]);
      this.file = null;
      this.rate = Number(this.attr("speed", 1));
      if (!Number.isFinite(this.rate)) this.rate = 1;
      this.loop = Number(this.attr("loop", 0)) ? 1 : 0;
      this.dsp("pe-sfplay", 0, this.ch + (posOut ? 1 : 0), { rate: this.rate, loop: this.loop, pos: posOut ? 1 : 0 });
    }
    fromDsp(d) { if (d.done) this.out(this.outTypes.length - 1, BANG); }
    async load(file) {
      let buf;
      try {
        buf = await decodeAudio(await file.arrayBuffer());
      } catch (err) {
        this.patch.log(`${this.name}: ${file.name} non si può leggere in questo browser. Prova WAV o MP3.`);
        return;
      }
      if (this.dead) return;
      const chans = [];
      for (let c = 0; c < Math.min(this.ch, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c).slice());
      this.node.port.postMessage({ load: chans }, chans.map((x) => x.buffer));
      this.file = { name: file.name, frames: buf.length, channels: buf.numberOfChannels };
      const nch = buf.numberOfChannels === 1 ? "mono" : `${buf.numberOfChannels} canali`;
      this.patch.log(`${this.name}: aperto ${file.name} (${nch}, ${mmss(buf.duration)})`);
    }
    hasFile() {
      if (this.file) return true;
      this.patch.log(`${this.name}: nessun file aperto: manda prima open`);
      return false;
    }
    receive(i, m) {
      if (i === 1) {
        if (!isNum(m)) return this.nope(m);
        this.rate = m[0];
        return this.setp({ rate: this.rate });
      }
      const s = sel(m), sr = AC.sampleRate;
      if (s === "open") return this.patch.pickAudio(this, (f) => this.load(f));
      if (s === "pause") return this.post({ pause: 1 });
      if (s === "resume") return this.post({ resume: 1 });
      if (s === "loop") { this.loop = num(m.slice(1)) ? 1 : 0; return this.setp({ loop: this.loop }); }
      if (s === "speed") { this.rate = num(m.slice(1)); return this.setp({ rate: this.rate }); }
      if (s === "seek") {
        if (!this.hasFile()) return;
        const from = num(m.slice(1)), to = typeof m[2] === "number" && m[2] > from ? m[2] * sr / 1000 : this.file.frames;
        return this.post({ play: [from * sr / 1000, to] });
      }
      if (s === "print") {
        const f = this.file;
        return this.patch.log(`${this.name}: ` + (f ? `${f.name}, ${f.channels} ${f.channels === 1 ? "canale" : "canali"}, ${mmss(f.frames / sr)}` : "nessun file") + `, speed ${fmt(this.rate)}, loop ${this.loop}`);
      }
      if (isNum(m)) {
        const v = Math.trunc(m[0]);
        if (v === 0) return this.post({ stop: 1 });
        if (v === 1) { if (this.hasFile()) this.post({ play: [0, this.file.frames] }); return; }
        return this.patch.log(`${this.name}: i cue (numeri sopra 1) qui non ci sono`);
      }
      if (!isBang(m)) this.nope(m);
    }
    destroy() { this.dead = true; super.destroy(); }
  }

  // sfrecord~ [channels] [buffer size]: records its signal inlets (one
  // channel each) to a WAV file; in the browser the file goes to the
  // downloads when it is closed. open [format] [name] opens a file (here
  // always WAV; without a name it gets the date and time); 1 starts, 0 stops
  // and closes it (a new open is needed before recording again); open mp3
  // [name] makes an MP3 instead (an addition: Max has no MP3); record ms
  // stops by itself; loop ms keeps only the most recent ms; samptype sets
  // the sample format; print. Outlet: elapsed time in ms.
  const SFREC_TYPES = { int8: [8, 1], int16: [16, 1], int24: [24, 1], int32: [32, 1], float32: [32, 3], float64: [64, 3] };
  const SFREC_FORMATS = ["aiff", "aif", "wave", "wav", "ogg", "flac", "raw", "mp3"];
  function stampNow() {
    const d = new Date(), z = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
  }
  // WAV file from one Float32Array per channel; type is a key of SFREC_TYPES.
  function wavFile(chans, sampleRate, type) {
    const [bits, tag] = SFREC_TYPES[type], bytes = bits / 8, nch = chans.length, n = chans[0].length;
    const dataLen = n * nch * bytes, buf = new ArrayBuffer(44 + dataLen), v = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, tag, true); v.setUint16(22, nch, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nch * bytes, true);
    v.setUint16(32, nch * bytes, true); v.setUint16(34, bits, true);
    str(36, "data"); v.setUint32(40, dataLen, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < nch; c++) {
        const x = chans[c][i], y = x > 1 ? 1 : x < -1 ? -1 : x;
        if (tag === 3) { if (bits === 32) v.setFloat32(o, x, true); else v.setFloat64(o, x, true); }
        else if (bits === 8) v.setUint8(o, Math.round(y * 127) + 128);
        else if (bits === 16) v.setInt16(o, Math.round(y * 32767), true);
        else if (bits === 24) { const k = Math.round(y * 8388607); v.setUint8(o, k & 255); v.setUint8(o + 1, (k >> 8) & 255); v.setUint8(o + 2, (k >> 16) & 255); }
        else v.setInt32(o, Math.round(y * 2147483647), true);
        o += bytes;
      }
    }
    return new Blob([buf], { type: "audio/wav" });
  }
  class SfRecord extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      const n = a.filter((x) => typeof x === "number");
      this.ch = Math.max(1, Math.min(8, Math.trunc(n[0] || 1)));
      this.nin = this.ch;
      this.sigIn = new Set([...Array(this.ch).keys()]);
      this.outTypes = ["signal"];
      const bd = Number(this.attr("bitdepth", 16));
      this.samptype = [8, 16, 24, 32].includes(bd) ? "int" + bd : "int16";
      this.file = null;   // name of the open file
      this.format = "wav";
      this.recording = false;
      this.chunks = [];
      this.enc = null;    // MP3 encoder while recording an MP3
      this.dsp("pe-sfrec", this.ch, 1, { ch: this.ch });
    }
    // MP3 gets the first two channels (one channel is used for both sides).
    toMp3(k) { this.enc.push(k[0], k.length > 1 ? k[1] : k[0].slice()); }
    async fromDsp(d) {
      if (d.chunk) { if (this.enc) this.toMp3(d.chunk); else this.chunks.push(d.chunk); return; }
      if (!("done" in d)) return;
      if (this.enc) {
        const enc = this.enc, name = this.file, secs = (d.done / AC.sampleRate).toFixed(1);
        this.enc = null;
        this.recording = false;
        this.file = null;
        const blob = await enc.end().catch(() => null);
        if (!blob) return this.patch.log(`${this.name}: MP3 non riuscito`);
        return this.patch.saveFile(name, blob, `${this.name}: salvato ${name} (${secs} s).`);
      }
      const name = this.file, chunks = this.chunks, frames = d.done;
      this.chunks = [];
      this.recording = false;
      this.file = null; // closed: open again before the next recording
      const chans = [];
      for (let c = 0; c < this.ch; c++) {
        const o = new Float32Array(frames);
        let off = 0;
        for (const k of chunks) { const part = k[c].subarray(0, Math.min(k[c].length, frames - off)); o.set(part, off); off += part.length; }
        chans.push(o);
      }
      const secs = (frames / AC.sampleRate).toFixed(1);
      this.patch.saveFile(name, wavFile(chans, AC.sampleRate, this.samptype), `${this.name}: salvato ${name} (${secs} s).`);
    }
    async start(msg) {
      if (!this.file) return this.patch.log(`${this.name}: nessun file aperto: manda prima open`);
      if (this.recording) return;
      this.recording = true;
      this.chunks = [];
      if (this.format === "mp3") {
        // the encoder must be ready before the first chunk arrives
        this.starting = true;
        const enc = [32000, 44100, 48000].includes(AC.sampleRate) ? await this.patch.mp3Encoder(AC.sampleRate) : null;
        this.starting = false;
        if (this.dead || this.abort) {
          // stopped (0) while the encoder was getting ready: nothing recorded
          if (enc) enc.cancel();
          this.abort = false;
          this.recording = false;
          this.file = null;
          return;
        }
        if (enc) {
          this.enc = enc;
          if (this.ch > 2) this.patch.log(`${this.name}: l'MP3 ha al massimo 2 canali: registro i primi due`);
        } else {
          this.format = "wav";
          this.file = this.file.replace(/\.mp3$/i, ".wav");
          this.patch.log(`${this.name}: MP3 non disponibile qui: registro in WAV (${this.file})`);
        }
      }
      this.post(msg);
    }
    receive(i, m) {
      if (i > 0) return this.nope(m);
      const s = sel(m), args = m.slice(1), sr = AC.sampleRate;
      if (isNum(m)) {
        if (m[0] !== 0) return this.start({ rec: { frames: 0 } });
        if (this.starting) { this.abort = true; return; }
        if (this.recording) return this.post({ stop: 1 });
        this.file = null; // opened but not recorded: just close it
        return;
      }
      if (s === "open") {
        let rest = args.slice();
        this.format = "wav";
        if (typeof rest[0] === "string" && SFREC_FORMATS.includes(rest[0].toLowerCase())) {
          const f = rest.shift().toLowerCase();
          if (f === "mp3") this.format = "mp3";
          else if (f !== "wave" && f !== "wav") this.patch.log(`${this.name}: qui si registra solo in WAV o MP3: registro in WAV`);
        }
        let name = rest.length ? rest.map(String).join(" ") : `sfrecord_${stampNow()}`;
        name = name.replace(/\.(aiff?|wave?|ogg|flac|raw|mp3)$/i, "") + "." + this.format;
        if (this.recording) this.post({ stop: 1 });
        this.file = name;
        return;
      }
      if (s === "record") return this.start({ rec: { frames: num(args) * sr / 1000 } });
      if (s === "loop") return this.start({ loop: { frames: num(args) * sr / 1000 } });
      if (s === "samptype") {
        const t = String(args[0] || "").toLowerCase();
        if (SFREC_TYPES[t]) { this.samptype = t; return; }
        return this.patch.log(`${this.name}: samptype ${t}: qui non c'è (int8, int16, int24, int32, float32, float64)`);
      }
      if (s === "print") {
        const st = this.recording ? "sta registrando" : this.file ? "file aperto" : "nessun file aperto";
        return this.patch.log(`${this.name}: ${st}${this.file ? " (" + this.file + ")" : ""}, ${this.ch} ${this.ch === 1 ? "canale" : "canali"}, ${this.format === "mp3" ? "mp3" : this.samptype}`);
      }
      if (!isBang(m)) this.nope(m);
    }
    destroy() {
      this.dead = true;
      if (this.enc) { this.enc.cancel(); this.enc = null; }
      if (this.recording) this.post({ stop: 1 });
      super.destroy();
    }
  }

  // Objects that exist only with the full audio (worklet.js).
  class NeedsWorklet extends Bad {
    constructor(p, b, a) {
      super(p, b, a);
      p.log(`${this.name}: richiede l'audio completo, non disponibile in questo browser`);
    }
  }

  // clip [min] [max]: keeps numbers (or each number of a list) in a range.
  // Inlets: number or list, minimum, maximum. @mode 1: zero outside.
  class ClipCtl extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 3;
      const n = a.filter((x) => typeof x === "number");
      this.lo = n.length ? n[0] : 0;
      this.hi = n.length > 1 ? n[1] : this.lo; // one argument: both limits
      this.mode = this.attrs.mode && num(this.attrs.mode) ? 1 : 0;
      this.last = [0];
    }
    one(v) {
      if (typeof v !== "number") return v;
      const z = this.mode === 1;
      const r = v < this.lo ? (z ? 0 : this.lo) : v > this.hi ? (z ? 0 : this.hi) : v;
      return Number.isInteger(v) ? Math.trunc(r) : r; // int in, int out
    }
    receive(i, m) {
      if (i === 1) { if (isNum(m)) this.lo = m[0]; return; }
      if (i === 2) { if (isNum(m)) this.hi = m[0]; return; }
      const s = sel(m);
      if (s === "set") {
        const n = m.slice(1).filter((x) => typeof x === "number");
        if (n.length) { this.lo = n[0]; this.hi = n.length > 1 ? n[1] : n[0]; }
        return;
      }
      if (s === "mode") { this.mode = num(m.slice(1)) ? 1 : 0; return; }
      if (isBang(m)) return this.out(0, this.last);
      if (!isNum(m)) return this.nope(m);
      this.last = m.map((v) => this.one(v));
      this.out(0, this.last);
    }
  }

  // clip~ [min] [max]: limits a signal; min and max as numbers or signals.
  class ClipSig extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 3;
      this.outTypes = ["signal"];
      this.sigIn = new Set([0, 1, 2]);
      const n = a.filter((x) => typeof x === "number");
      this.dsp("pe-clip", 3, 1, {
        min: n.length ? n[0] : 0, max: n.length > 1 ? n[1] : 0,
        mode: this.attrs.mode && num(this.attrs.mode) ? 1 : 0,
      });
    }
    receive(i, m) {
      if (sel(m) === "mode") return this.setp({ mode: num(m.slice(1)) ? 1 : 0 });
      if (isBang(m)) return;
      if (!isNum(m)) return this.nope(m);
      if (i === 1) this.setp({ min: m[0] });
      else if (i === 2) this.setp({ max: m[0] });
    }
  }

  // limi~ [channels] [buffer size]: lookahead peak limiter. Attributes as
  // in Max: threshold (dB), release (ms), lookahead (samples), mode
  // (0 linear, 1 exponential), preamp, postamp (dB), dcblock, bypass.
  const LIMI_ATTRS = ["threshold", "release", "lookahead", "mode", "preamp", "postamp", "dcblock", "bypass"];
  class Limi extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      const n = a.filter((x) => typeof x === "number");
      this.ch = Math.max(1, Math.min(8, Math.trunc(n[0] || 1)));
      const size = Math.max(1, Math.trunc(n[1] || 512));
      this.nin = this.ch;
      this.outTypes = new Array(this.ch).fill("signal");
      this.sigIn = new Set([...Array(this.ch).keys()]);
      const params = { ch: this.ch, bufsize: size, threshold: 0, release: 1000, lookahead: 100, mode: 1, preamp: 0, postamp: 0, dcblock: 0, bypass: 0 };
      for (const k of LIMI_ATTRS) if (this.attrs[k]) params[k] = num(this.attrs[k]);
      params.lookahead = Math.min(size, Math.max(0, params.lookahead));
      this.size = size;
      this.dsp("pe-limi", this.ch, this.ch, params);
    }
    receive(i, m) {
      const s = sel(m);
      if (s === "clear") return this.post({ clear: 1 });
      if (LIMI_ATTRS.includes(s)) {
        let v = num(m.slice(1));
        if (s === "lookahead") v = Math.min(this.size, Math.max(0, Math.trunc(v)));
        return this.setp({ [s]: v });
      }
      if (!isBang(m)) this.nope(m);
    }
  }

  // Quick record (like Max's Quickrecord): taps the main output, the sound
  // that dac~ plays, and collects it until stopped.
  const recorder = {
    node: null, chunks: [], frames: 0, finish: null, onChunk: null,
    get recording() { return !!this.node; },
    get seconds() { return this.frames / AC.sampleRate; },
    // onChunk(L, R), when given, receives each stereo chunk as it arrives
    // (the chunks are then not kept here).
    start(onChunk) {
      if (!WK || this.node) return false;
      this.chunks = [];
      this.frames = 0;
      this.onChunk = onChunk || null;
      const node = new AudioWorkletNode(AC, "pe-rec", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers",
        processorOptions: { params: {} },
      });
      node.port.onmessage = (e) => {
        const d = e.data;
        if (d.L) {
          this.frames += d.L.length;
          if (this.onChunk) this.onChunk(d.L, d.R);
          else this.chunks.push(d);
        }
        if (d.done && this.finish) this.finish();
      };
      master.connect(node);
      node.connect(sink);
      node.port.postMessage({ rec: 1 });
      this.node = node;
      return true;
    },
    stop() {
      return new Promise((resolve) => {
        const node = this.node;
        if (!node) { resolve(null); return; }
        this.finish = () => {
          this.finish = null;
          try { master.disconnect(node); } catch (err) { /* already gone */ }
          node.disconnect();
          node.port.onmessage = null;
          node.port.postMessage({ end: 1 });
          this.node = null;
          this.onChunk = null;
          resolve({ chunks: this.chunks, frames: this.frames, sampleRate: AC.sampleRate });
        };
        node.port.postMessage({ rec: 0 });
        // with the audio off the processor may not answer: finish anyway
        setTimeout(() => { if (this.finish) this.finish(); }, AC.state === "running" ? 1500 : 50);
      });
    },
  };

  // ------------------------------------------------------------ audio input (adc~, ezadc~)
  // As in Max, the input runs only while the audio is on: the microphone
  // opens when the audio is on and the patch has an adc~ or ezadc~, and
  // closes otherwise. A mono input is copied to both channels.
  const inBus = AC.createGain();
  inBus.channelCount = 2;
  inBus.channelCountMode = "explicit";
  inBus.channelInterpretation = "speakers";
  const inSplit = AC.createChannelSplitter(2);
  inBus.connect(inSplit);
  const input = { users: new Set(), stream: null, src: null, opening: false, failed: false, told: false };
  function inputLog(t) { const u = input.users.values().next().value; if (u) u.patch.log(t); }
  function closeInput() {
    if (input.src) input.src.disconnect();
    if (input.stream) input.stream.getTracks().forEach((t) => t.stop());
    input.src = null;
    input.stream = null;
  }
  function inputWanted() { return input.users.size > 0 && AC.state === "running"; }
  async function openInput() {
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) {
      input.failed = true;
      inputLog("Ingresso audio non disponibile in questo browser.");
      return;
    }
    input.opening = true;
    try {
      const stream = await md.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } },
      });
      input.opening = false;
      // things may have changed while the browser was asking
      if (!inputWanted() || input.stream) { stream.getTracks().forEach((t) => t.stop()); updateInput(); return; }
      input.stream = stream;
      input.src = AC.createMediaStreamSource(stream);
      input.src.connect(inBus);
      if (!input.told) { input.told = true; inputLog("Ingresso audio attivo. Usa le cuffie, altrimenti microfono e altoparlanti fischiano (effetto Larsen)."); }
    } catch (err) {
      input.opening = false;
      input.failed = true;
      closeInput();
      const name = err && err.name;
      if (window.claude) inputLog("Dentro Claude il microfono non è disponibile: usa la versione pubblicata su GitHub.");
      else if (name === "NotAllowedError" || name === "SecurityError") inputLog("Microfono non permesso: consentilo nelle impostazioni del sito (icona accanto all'indirizzo), poi spegni e riaccendi l'audio.");
      else if (name === "NotFoundError" || name === "OverconstrainedError") inputLog("Nessun microfono trovato.");
      else inputLog("Ingresso audio non riuscito: " + (name || err));
    }
  }
  function updateInput() {
    if (inputWanted()) { if (!input.stream && !input.opening && !input.failed) openInput(); }
    else closeInput();
  }
  AC.addEventListener("statechange", () => {
    if (AC.state !== "running") input.failed = false; // try again next time the audio goes on
    updateInput();
  });

  // ------------------------------------------------------------ signal objects (built-in nodes)
  // Used when the worklet cannot load: no phase input, plain waveforms.
  class Osc extends Obj {
    constructor(p, b, a, type) {
      super(p, b, a);
      this.nin = type === "sawtooth" || type === "sine" ? 2 : 3;
      this.outTypes = ["signal"];
      this.sigIn = new Set(this.nin === 2 ? [0, 1] : [0, 1, 2]);
      this.osc = AC.createOscillator();
      this.osc.type = type;
      this.freq = num(a);
      this.osc.frequency.value = this.freq;
      this.osc.start();
      this.osc.connect(sink);
    }
    receive(i, m) {
      if (i !== 0 || !isNum(m)) return;
      this.freq = m[0];
      if (!this.sigCount[0]) jumpParam(this.osc.frequency, this.freq);
    }
    sigOut() { return { node: this.osc }; }
    sigTarget(i) { return i === 0 ? { node: this.osc.frequency } : { node: nullIn }; }
    onSig(i, c) {
      if (i !== 0) return;
      this.osc.frequency.cancelScheduledValues(0);
      this.osc.frequency.value = c > 0 ? 0 : this.freq;
    }
    destroy() { try { this.osc.stop(); } catch (e) { /* already stopped */ } this.osc.disconnect(); }
  }

  class BiquadLores extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 3;
      this.outTypes = ["signal"];
      this.sigIn = new Set([0, 1, 2]);
      this.f = AC.createBiquadFilter();
      this.f.type = "lowpass";
      this.cut = a.length ? num(a) : 0;
      this.res = a.length > 1 && typeof a[1] === "number" ? a[1] : 0;
      this.f.frequency.value = Math.max(0, this.cut);
      this.f.Q.value = this.q(this.res);
      this.f.connect(sink);
    }
    q(res) { return -3 + Math.min(Math.max(res, 0), 0.99) * 30; }
    receive(i, m) {
      if (!isNum(m)) return;
      const v = m[0];
      if (i === 1) { this.cut = v; if (!this.sigCount[1]) setParam(this.f.frequency, Math.max(0, v)); }
      if (i === 2) { this.res = v; if (!this.sigCount[2]) setParam(this.f.Q, this.q(v)); }
    }
    sigOut() { return { node: this.f }; }
    sigTarget(i) { return [{ node: this.f }, { node: this.f.frequency }, { node: this.f.Q }][i]; }
    onSig(i, c) {
      if (i === 1) { this.f.frequency.cancelScheduledValues(0); this.f.frequency.value = c > 0 ? 0 : this.cut; }
      if (i === 2) { this.f.Q.cancelScheduledValues(0); this.f.Q.value = c > 0 ? 0 : this.q(this.res); }
    }
    destroy() { this.f.disconnect(); }
  }

  class ParamAdsr extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 5;
      this.outTypes = ["signal", "signal", "", ""];
      this.sigIn = new Set([0, 1, 2, 3, 4]);
      const v = (k, d) => (typeof a[k] === "number" ? a[k] : d);
      this.a = v(0, 10); this.d = v(1, 10); this.s = v(2, 1); this.r = v(3, 10);
      this.src = konst(0);
      this.src.connect(sink);
      this.zero = AC.createGain();
      this.zero.gain.value = 0;
      this.src.connect(this.zero);
      this.points = [[0, 0]];
    }
    valueAt(t) {
      const p = this.points;
      if (t <= p[0][0]) return p[0][1];
      for (let k = 1; k < p.length; k++) {
        if (t <= p[k][0]) {
          const [t0, v0] = p[k - 1], [t1, v1] = p[k];
          return t1 === t0 ? v1 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
        }
      }
      return p[p.length - 1][1];
    }
    ramp(segments) {
      const now = AC.currentTime;
      const param = this.src.offset;
      const v0 = this.valueAt(now);
      param.cancelScheduledValues(now);
      param.setValueAtTime(v0, now);
      this.points = [[now, v0]];
      let t = now;
      for (const [target, ms] of segments) {
        t += Math.max(ms, 0.5) / 1000;
        param.linearRampToValueAtTime(target, t);
        this.points.push([t, target]);
      }
    }
    receive(i, m) {
      if (!isNum(m)) return;
      const v = m[0];
      if (i === 1) this.a = v;
      else if (i === 2) this.d = v;
      else if (i === 3) this.s = v;
      else if (i === 4) this.r = v;
      else if (v !== 0) this.ramp([[v, this.a], [v * this.s, this.d]]);
      else this.ramp([[0, this.r]]);
    }
    sigOut(o) { return o === 0 ? { node: this.src } : o === 1 ? { node: this.zero } : null; }
    sigTarget() { return { node: nullIn }; }
    destroy() { this.src.stop(); this.src.disconnect(); this.zero.disconnect(); }
  }

  class ParamLine extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 2;
      this.outTypes = ["signal", "bang"];
      this.src = konst(num(a));
      this.src.connect(sink);
      this.next = 0;
      this.timer = null;
    }
    receive(i, m) {
      if (!isNum(m)) return;
      if (i === 1) { this.next = m[0]; return; }
      const now = AC.currentTime;
      const param = this.src.offset;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      const pairs = m.length >= 2 ? m : [m[0], this.next];
      let t = now;
      for (let k = 0; k < pairs.length; k += 2) {
        const ms = Number(pairs[k + 1]) || 0;
        t += ms / 1000;
        if (ms <= 0) param.setValueAtTime(Number(pairs[k]) || 0, t);
        else param.linearRampToValueAtTime(Number(pairs[k]) || 0, t);
      }
      this.next = 0;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.out(1, BANG), (t - now) * 1000);
    }
    sigOut(o) { return o === 0 ? { node: this.src } : null; }
    destroy() { this.src.stop(); this.src.disconnect(); if (this.timer) clearTimeout(this.timer); }
  }

  // ------------------------------------------------------------ signal objects (any mode)
  class Noise extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.outTypes = ["signal"];
      this.sigIn = new Set([0]);
      this.src = AC.createBufferSource();
      this.src.buffer = noiseBuffer();
      this.src.loop = true;
      this.src.start();
      this.src.connect(sink);
    }
    sigOut() { return { node: this.src }; }
    destroy() { try { this.src.stop(); } catch (e) { /* already stopped */ } this.src.disconnect(); }
  }

  // *~ : left x right. A number stands in for a missing signal on either side.
  class Mul extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 2;
      this.outTypes = ["signal"];
      this.sigIn = new Set([0, 1]);
      this.g = AC.createGain();
      this.k = a.length ? num(a) : 0;
      this.g.gain.value = this.k;
      this.g.connect(sink);
      this.lv = 0;
      this.lconst = null;
    }
    receive(i, m) {
      if (!isNum(m)) { if (!isBang(m)) this.nope(m); return; }
      const v = m[0];
      if (i === 1) {
        this.k = v;
        if (!this.sigCount[1]) jumpParam(this.g.gain, v);
      } else {
        this.lv = v;
        if (!this.lconst) { this.lconst = konst(0); this.lconst.connect(this.g); }
        if (!this.sigCount[0]) this.lconst.offset.value = v;
      }
    }
    sigOut() { return { node: this.g }; }
    sigTarget(i) { return i === 0 ? { node: this.g } : { node: this.g.gain }; }
    onSig(i, c) {
      if (i === 1) { this.g.gain.cancelScheduledValues(0); this.g.gain.value = c > 0 ? 0 : this.k; }
      if (i === 0 && this.lconst) this.lconst.offset.value = c > 0 ? 0 : this.lv;
    }
    destroy() { this.g.disconnect(); if (this.lconst) { this.lconst.stop(); this.lconst.disconnect(); } }
  }

  class AddSub extends Obj {
    constructor(p, b, a, sign) {
      super(p, b, a);
      this.nin = 2;
      this.outTypes = ["signal"];
      this.sigIn = new Set([0, 1]);
      this.sign = sign;
      this.sum = AC.createGain();
      this.sum.connect(sink);
      this.k = a.length ? num(a) : 0;
      this.rconst = konst(sign * this.k);
      this.rconst.connect(this.sum);
      this.inv = AC.createGain();
      this.inv.gain.value = sign;
      this.inv.connect(this.sum);
      this.lv = 0;
      this.lconst = null;
    }
    receive(i, m) {
      if (!isNum(m)) { if (!isBang(m)) this.nope(m); return; }
      const v = m[0];
      if (i === 1) {
        this.k = v;
        if (!this.sigCount[1]) this.rconst.offset.value = this.sign * v;
      } else {
        this.lv = v;
        if (!this.lconst) { this.lconst = konst(0); this.lconst.connect(this.sum); }
        if (!this.sigCount[0]) this.lconst.offset.value = v;
      }
    }
    sigOut() { return { node: this.sum }; }
    sigTarget(i) { return i === 0 ? { node: this.sum } : { node: this.inv }; }
    onSig(i, c) {
      if (i === 1) this.rconst.offset.value = c > 0 ? 0 : this.sign * this.k;
      if (i === 0 && this.lconst) this.lconst.offset.value = c > 0 ? 0 : this.lv;
    }
    destroy() {
      this.rconst.stop();
      [this.sum, this.rconst, this.inv].forEach((n) => n.disconnect());
      if (this.lconst) { this.lconst.stop(); this.lconst.disconnect(); }
    }
  }

  class Sig extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.outTypes = ["signal"];
      this.src = konst(num(a));
      this.src.connect(sink);
    }
    receive(i, m) { if (isNum(m)) jumpParam(this.src.offset, m[0]); else if (!isBang(m)) this.nope(m); }
    sigOut() { return { node: this.src }; }
    destroy() { this.src.stop(); this.src.disconnect(); }
  }

  class Dac extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.chans = a.filter((x) => typeof x === "number");
      if (!this.chans.length) this.chans = [1, 2];
      this.nin = this.chans.length;
      this.outTypes = [];
      this.sigIn = new Set(this.chans.map((c, i) => i));
      this.ins = this.chans.map((c) => {
        const g = AC.createGain();
        if (c >= 1 && c <= 2) g.connect(merger, 0, c - 1); else g.connect(sink);
        return g;
      });
    }
    receive(i, m) {
      const s = sel(m);
      if (s === "start" || s === "startwindow" || s === "open") this.patch.setAudio(true);
      else if (s === "stop") this.patch.setAudio(false);
      else if (isNum(m)) this.patch.setAudio(m[0] !== 0);
      else if (!isBang(m)) this.nope(m);
    }
    sigTarget(i) { return { node: this.ins[i] || nullIn }; }
    destroy() { this.ins.forEach((g) => g.disconnect()); }
  }

  // adc~ 1 2: one signal outlet per input channel (only 1 and 2 exist here).
  class Adc extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.chans = a.filter((x) => typeof x === "number");
      if (!this.chans.length) this.chans = [1, 2];
      this.outTypes = this.chans.map(() => "signal");
      this.outs = this.chans.map((c) => {
        const g = AC.createGain();
        if (c >= 1 && c <= 2) inSplit.connect(g, c - 1);
        g.connect(sink);
        return g;
      });
      input.users.add(this);
      updateInput();
    }
    // the inlet takes the same messages as dac~ (start, stop, 1, 0)
    receive(i, m) { Dac.prototype.receive.call(this, i, m); }
    sigOut(o) { return this.outs[o] ? { node: this.outs[o] } : null; }
    destroy() {
      this.outs.forEach((g) => { try { inSplit.disconnect(g); } catch (err) { /* not connected */ } g.disconnect(); });
      input.users.delete(this);
      updateInput();
    }
  }

  // ------------------------------------------------------------ GUI helpers
  function svgEl(tag, attrs) {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // Vertical drag; calls onDelta with the new value. up(moved) when released.
  function dragValue(e, start, onDelta, pxPerUnit, onTap) {
    const y0 = e.clientY, x0 = e.clientX;
    let moved = false;
    return {
      move(ev) {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        moved = true;
        const fine = ev.shiftKey ? 0.1 : 1;
        onDelta(start + (y0 - ev.clientY) / pxPerUnit * fine);
      },
      up() { if (!moved && onTap) onTap(); },
    };
  }

  function arcPath(cx, cy, r, a0, a1) {
    const p = (a) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    const large = Math.abs(a0 - a1) > Math.PI ? 1 : 0;
    return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`;
  }


  // ------------------------------------------------------------ GUI objects
  // dial and slider: position 0..size-1, output = position * mult + min.
  class Ranged extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.size = Math.max(2, this.battr("size", 128));
      this.min = this.battr("min", 0);
      this.mult = this.battr("mult", 1);
      this.floatout = !!this.battr("floatoutput", 0);
      this.v = 0;
    }
    value() { const v = this.min + this.v * this.mult; return this.floatout ? v : Math.round(v); }
    set(v, send, force) {
      v = Math.min(Math.max(v, 0), this.size - 1);
      if (!this.floatout) v = Math.round(v);
      const changed = v !== this.v;
      this.v = v;
      this.render();
      if (send && (changed || force)) this.out(0, [this.value()]);
    }
    receive(i, m) {
      const s = sel(m), x = num(m.slice(1));
      if (isBang(m)) return this.out(0, [this.value()]);
      if (s === "set") return this.set(this.floatout ? x : Math.trunc(x), false);
      if (s === "min") { this.min = x; this.box.min = x; return; }
      if (s === "mult") { this.mult = x; this.box.mult = x; return; }
      if (s === "size") { this.size = Math.max(2, x); this.box.size = this.size; return this.set(this.v, false); }
      if (s === "floatoutput") { this.floatout = !!x; this.box.floatoutput = x ? 1 : 0; return; }
      if (s === "setminmax") {
        const lo = num(m.slice(1)), hi = num(m.slice(2));
        if (!Number.isInteger(lo) || !Number.isInteger(hi)) { this.floatout = true; this.box.floatoutput = 1; }
        this.min = lo; this.mult = (hi - lo) / (this.size - 1);
        this.box.min = this.min; this.box.mult = this.mult;
        return this.render();
      }
      if (!isNum(m)) return this.nope(m);
      this.set(this.floatout ? m[0] : Math.trunc(m[0]), true, true);
    }
    render() {}
  }

  class Dial extends Ranged {
    constructor(p, b, a) { super(p, b, a); this.outTypes = ["float"]; }
    build(el) {
      this.svg = svgEl("svg", { class: "gui-svg", viewBox: "0 0 40 40", preserveAspectRatio: "none" });
      this.ring = svgEl("path", { class: "dial-ring" });
      this.val = svgEl("path", { class: "dial-val" });
      this.needle = svgEl("line", { class: "dial-needle" });
      this.svg.append(this.ring, this.val, this.needle);
      el.append(this.svg);
      this.render();
    }
    render() {
      if (!this.svg) return;
      const deg = this.battr("degrees", 270);
      const a0 = (90 + deg / 2) * Math.PI / 180, span = deg * Math.PI / 180;
      const frac = this.v / Math.max(1, this.size - 1);
      const a = a0 - span * frac;
      this.ring.setAttribute("d", arcPath(20, 20, 13, a0, a0 - span));
      this.val.setAttribute("d", frac > 0.001 ? arcPath(20, 20, 13, a0, a) : "");
      this.needle.setAttribute("x1", 20 + 6 * Math.cos(a)); this.needle.setAttribute("y1", 20 - 6 * Math.sin(a));
      this.needle.setAttribute("x2", 20 + 13 * Math.cos(a)); this.needle.setAttribute("y2", 20 - 13 * Math.sin(a));
    }
    press(e) { return dragValue(e, this.v, (v) => this.set(v, true), Math.max(0.3, 256 / this.size)); }
  }

  class Slider extends Ranged {
    constructor(p, b, a) { super(p, b, a); this.outTypes = [""]; }
    build(el) { this.el = el; el.innerHTML = '<span class="sl-knob"></span>'; this.knob = el.firstChild; this.render(); }
    vertical() {
      const o = this.battr("orientation", 0);
      if (o === 1) return false;
      if (o === 2) return true;
      const r = this.rect(); return r[3] >= r[2];
    }
    render() {
      if (!this.knob) return;
      const f = this.v / Math.max(1, this.size - 1);
      if (this.vertical()) { this.knob.style.bottom = (f * 100) + "%"; this.knob.style.left = "0"; this.knob.className = "sl-knob v"; }
      else { this.knob.style.left = (f * 100) + "%"; this.knob.style.bottom = "0"; this.knob.className = "sl-knob h"; }
    }
    press(e, pt) {
      const r = this.rect();
      const pos = (q) => this.vertical() ? (1 - (q.y - r[1]) / r[3]) * (this.size - 1) : ((q.x - r[0]) / r[2]) * (this.size - 1);
      this.set(pos(pt), true);
      return { move: (ev, q) => this.set(pos(q), true) };
    }
  }

  class NumBox extends Obj {
    constructor(p, b, a, isFloat) {
      super(p, b, a);
      this.isFloat = isFloat;
      this.outTypes = ["", "bang"];
      this.lo = typeof b.minimum === "number" ? b.minimum : null;
      this.hi = typeof b.maximum === "number" ? b.maximum : null;
      this.v = 0;
    }
    build(el) {
      el.innerHTML = '<span class="num-tri">&#9656;</span><span class="num-val"></span>';
      this.label = el.querySelector(".num-val");
      this.render();
    }
    text() {
      if (!this.isFloat) return String(this.v);
      const nd = this.battr("numdecimalplaces", 0);
      if (nd > 0) return this.v.toFixed(nd);
      const s = String(Math.round(this.v * 1000) / 1000);
      return s.includes(".") || s.includes("e") ? s : s + ".";
    }
    render() { if (this.label) this.label.textContent = this.text(); }
    clamp(v) {
      if (this.lo !== null && v < this.lo) v = this.lo;
      if (this.hi !== null && v > this.hi) v = this.hi;
      return v;
    }
    set(v, send) {
      v = this.isFloat ? v : Math.trunc(v);
      this.v = this.clamp(v);
      this.render();
      if (send) this.out(0, [this.v]);
    }
    receive(i, m) {
      const s = sel(m), x = num(m.slice(1));
      if (isBang(m)) return this.out(0, [this.v]);
      if (s === "set") return this.set(x, false);
      if (s === "min") { this.lo = m.length > 1 ? x : null; this.box.minimum = this.lo === null ? undefined : this.lo; return this.set(this.v, false); }
      if (s === "max") { this.hi = m.length > 1 ? x : null; this.box.maximum = this.hi === null ? undefined : this.hi; return this.set(this.v, false); }
      if (s === "clear") { this.v = 0; return this.render(); }
      if (s === "select") return this.ask();
      if (!isNum(m)) return this.nope(m);
      this.set(m[0], true);
    }
    ask() { this.patch.askNumber(this, (v) => this.set(v, true)); }
    // Dragging: the digit under the finger decides the step (flonum).
    step(e) {
      if (!this.isFloat || !this.label) return 1;
      const t = this.label.textContent, dot = t.indexOf(".");
      if (dot < 0) return 1;
      const r = this.label.getBoundingClientRect();
      const k = Math.floor((e.clientX - r.left) / Math.max(1, r.width) * t.length);
      return k <= dot ? 1 : Math.pow(10, -(k - dot));
    }
    press(e) {
      const st = this.step(e), v0 = this.v;
      const digits = Math.round(-Math.log10(st));
      return dragValue(e, 0, (d) => {
        const v = st < 1 ? Number((v0 + Math.round(d) * st).toFixed(digits)) : v0 + Math.round(d);
        if (v !== this.v) this.set(v, true);
      }, 2, () => this.ask());
    }
  }

  class Toggle extends Obj {
    constructor(p, b, a) { super(p, b, a); this.outTypes = ["int"]; this.v = 0; }
    build(el) { this.el = el; el.innerHTML = '<svg class="gui-svg" viewBox="0 0 24 24"><path class="tgl-x" d="M6 6 L18 18 M18 6 L6 18"/></svg>'; this.render(); }
    render() { if (this.el) this.el.classList.toggle("on", this.v !== 0); }
    set(v, send) { this.v = Math.trunc(v); this.render(); if (send) this.out(0, [this.v]); }
    receive(i, m) {
      if (isBang(m)) return this.set(this.v ? 0 : 1, true);
      if (sel(m) === "set") return this.set(num(m.slice(1)), false);
      if (!isNum(m)) return this.nope(m);
      this.set(m[0], true);
    }
    press() { this.set(this.v ? 0 : 1, true); return null; }
  }

  class Button extends Obj {
    constructor(p, b, a) { super(p, b, a); this.outTypes = ["bang"]; }
    build(el) { this.el = el; el.innerHTML = '<span class="btn-dot"></span>'; }
    flash() { if (!this.el) return; this.el.classList.add("on"); clearTimeout(this.ft); this.ft = setTimeout(() => this.el.classList.remove("on"), 150); }
    receive() { this.flash(); this.out(0, BANG); }
    press() { this.receive(); return null; }
  }

  class Message extends Obj {
    constructor(p, b, a) { super(p, b, a); this.nin = 2; this.outTypes = [""]; this.text = String(b.text || ""); }
    build(el) { this.el = el; }
    flash() { if (!this.el) return; this.el.classList.add("on"); clearTimeout(this.ft); this.ft = setTimeout(() => this.el.classList.remove("on"), 120); }
    fire(input) {
      this.flash();
      const sub = (t) => parseAtoms(t.replace(/\$([1-9])/g, (s, d) => {
        const v = input[Number(d) - 1];
        return v === undefined ? "0" : fmt(v);
      }));
      // "a, b ; name c, d": a and b leave the outlet, c and d go to [receive name].
      const segs = this.text.split(";");
      for (const part of segs[0].split(",")) { const at = sub(part); if (at.length) this.out(0, at); }
      for (const seg of segs.slice(1)) {
        const parts = seg.split(",");
        const first = sub(parts[0]);
        if (!first.length) continue;
        const dest = String(first[0]);
        if (first.length > 1) this.patch.sendTo(dest, first.slice(1));
        for (const p of parts.slice(1)) { const at = sub(p); if (at.length) this.patch.sendTo(dest, at); }
      }
    }
    receive(i, m) {
      if (i === 1) { this.setText(fmtMsg(m)); return; }
      const s = sel(m);
      if (s === "set") { this.setText(fmtMsg(m.slice(1))); return; }
      if (s === "append") { this.setText([this.text, fmtMsg(m.slice(1))].filter(Boolean).join(" ")); return; }
      if (s === "prepend") { this.setText([fmtMsg(m.slice(1)), this.text].filter(Boolean).join(" ")); return; }
      this.fire(isBang(m) ? [] : m);
    }
    setText(t) { this.text = t; this.box.text = t; this.patch.onChange("retext", this.box.id); }
    press() { this.fire([]); return null; }
  }

  class Comment extends Obj { constructor(p, b, a) { super(p, b, a); this.outTypes = []; } }
  class Panel extends Obj { constructor(p, b, a) { super(p, b, a); this.outTypes = []; } }

  class Ezdac extends Dac {
    constructor(p, b, a) { super(p, b, []); }
    build(el) { this.el = el; el.innerHTML = '<svg class="gui-svg" viewBox="0 0 45 45"><path class="ez-spk" d="M12 18 h6 l8 -7 v23 l-8 -7 h-6 z"/><path class="ez-wave" d="M29 16 q5 6 0 13 M32 12 q9 10 0 21"/></svg>'; this.draw(); }
    draw() { if (this.el) this.el.classList.toggle("on", AC.state === "running"); }
    press() { this.patch.setAudio(AC.state !== "running"); return null; }
  }

  // ezadc~: microphone button that switches the audio; outlets as adc~ 1 2.
  class Ezadc extends Adc {
    constructor(p, b, a) { super(p, b, []); }
    build(el) { this.el = el; el.innerHTML = '<svg class="gui-svg" viewBox="0 0 45 45"><rect class="ez-spk" x="18" y="8" width="9" height="17" rx="4.5"/><path class="ez-wave" d="M13.5 21 q0 10 9 10 q9 0 9 -10 M22.5 31 v5 M17 36.5 h11"/></svg>'; this.draw(); }
    draw() { if (this.el) this.el.classList.toggle("on", AC.state === "running"); }
    press() { this.patch.setAudio(AC.state !== "running"); return null; }
  }

  function canvasSize(c, r) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r[2] * dpr), H = Math.round(r[3] * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return [W, H, dpr];
  }

  // scope~: waveform locked on the rising zero crossing. Also the base of live.scope~.
  class AnScope extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 2;
      this.outTypes = [];
      this.sigIn = new Set([0, 1]);
      this.an = AC.createAnalyser();
      this.an.fftSize = 2048;
      this.an.connect(sink);
      this.buf = new Float32Array(this.an.fftSize);
      const rg = this.box.range;
      this.range = Array.isArray(rg) && rg.length >= 2 ? [Number(rg[0]), Number(rg[1])] : [-1, 1];
    }
    build(el) { this.canvas = document.createElement("canvas"); this.canvas.className = "gui-canvas"; el.append(this.canvas); }
    receive(i, m) { if (sel(m) === "range" && m.length >= 3) this.range = [num(m.slice(1)), num(m.slice(2))]; }
    sigTarget(i) { return i === 0 ? { node: this.an } : { node: nullIn }; }
    yOf(v, H, pad) { const [lo, hi] = this.range; return H - pad - (v - lo) / ((hi - lo) || 1) * (H - 2 * pad); }
    draw() {
      const c = this.canvas;
      if (!c) return;
      const [W, H, dpr] = canvasSize(c, this.rect());
      const g = c.getContext("2d");
      g.fillStyle = "#333333"; g.fillRect(0, 0, W, H);
      this.an.getFloatTimeDomainData(this.buf);
      const b = this.buf;
      let start = 0;
      for (let k = 1; k < b.length / 2; k++) if (b[k - 1] <= 0 && b[k] > 0) { start = k; break; }
      const n = Math.min(b.length - start, 1024);
      g.strokeStyle = "#c8e6e9"; g.lineWidth = 1.2 * dpr; g.beginPath();
      for (let k = 0; k < n; k++) {
        const x = k / (n - 1) * W, y = this.yOf(b[start + k], H, 2 * dpr);
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
      g.fillStyle = "#c8e6e9"; g.font = `${10 * dpr}px Arimo, Arial, sans-serif`;
      g.fillText(this.range[1].toFixed(3), 3 * dpr, 11 * dpr); g.fillText(this.range[0].toFixed(3), 3 * dpr, H - 4 * dpr);
    }
    destroy() { this.an.disconnect(); }
  }

  class LiveScope extends AnScope {
    constructor(p, b, a) {
      super(p, b, a);
      this.outTypes = ["bang"];
      this.an.fftSize = 512;
      this.buf = new Float32Array(this.an.fftSize);
      this.hist = [];
    }
    receive(i, m) {
      super.receive(i, m);
      if (isBang(m)) this.hist = [];
    }
    draw() {
      const c = this.canvas;
      if (!c) return;
      const r = this.rect();
      const [W, H, dpr] = canvasSize(c, r);
      const keep = Math.max(60, Math.round(r[2]));
      if (AC.state === "running") {
        this.an.getFloatTimeDomainData(this.buf);
        let lo = Infinity, hi = -Infinity;
        for (const v of this.buf) { if (v < lo) lo = v; if (v > hi) hi = v; }
        this.hist.push([lo, hi]);
        if (this.hist.length > keep) this.hist.splice(0, this.hist.length - keep);
      }
      const g = c.getContext("2d");
      g.fillStyle = "#282828"; g.fillRect(0, 0, W, H);
      g.strokeStyle = "#d59200"; g.lineWidth = 1.4 * dpr; g.beginPath();
      const y = (v) => Math.min(H, Math.max(0, this.yOf(v, H, 3 * dpr)));
      if (!this.hist.length) { g.moveTo(0, y(0)); g.lineTo(W, y(0)); }
      this.hist.forEach(([lo, hi], k) => {
        const x = W - (this.hist.length - 1 - k) / (keep - 1) * W;
        if (k) g.lineTo(x, y(hi)); else g.moveTo(x, y(hi));
        if (hi - lo > 0.01) g.lineTo(x, y(lo));
      });
      g.stroke();
    }
  }

  // live.gain~: one gain per channel; outlets after the signals:
  // value in dB, value 0..1, meter levels in dB.
  class LiveGain extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.ch = Math.max(1, Math.min(8, Math.trunc(this.battr("channels", 2)) || 2));
      this.nin = this.ch;
      this.outTypes = new Array(this.ch).fill("signal").concat(["", "float", "list"]);
      this.sigIn = new Set([...Array(this.ch).keys()]);
      const vo = ((b.saved_attribute_attributes || {}).valueof) || {};
      this.min = typeof vo.parameter_mmin === "number" ? vo.parameter_mmin : -70;
      this.max = typeof vo.parameter_mmax === "number" ? vo.parameter_mmax : 6;
      this.label = vo.parameter_shortname || "live.gain~";
      this.init = typeof vo.parameter_initial?.[0] === "number" ? vo.parameter_initial[0] : 0;
      this.db = this.clamp(this.init);
      this.interp = this.battr("interp", 10);
      this.gs = [];
      this.ans = [];
      this.bufs = [];
      this.peaks = [];
      for (let k = 0; k < this.ch; k++) {
        const g = AC.createGain();
        g.gain.value = this.gain();
        g.connect(sink);
        const an = AC.createAnalyser();
        an.fftSize = 512;
        g.connect(an);
        an.connect(sink);
        this.gs.push(g); this.ans.push(an); this.bufs.push(new Float32Array(512)); this.peaks.push(0);
      }
    }
    clamp(db) { return Math.max(this.min, Math.min(this.max, db)); }
    gain() { return this.db <= this.min ? 0 : Math.pow(10, this.db / 20); }
    frac() { return (this.db - this.min) / (this.max - this.min); }
    build(el) {
      el.innerHTML = `<div class="lg-label"></div><div class="lg-track"><div class="lg-thumb"></div></div><div class="lg-db"></div>`;
      el.querySelector(".lg-label").textContent = this.label;
      this.track = el.querySelector(".lg-track");
      this.thumb = el.querySelector(".lg-thumb");
      this.dbel = el.querySelector(".lg-db");
      // one meter bar per channel, 1 px apart
      const bw = this.ch > 1 ? 4 : 6, tw = this.ch * bw + this.ch - 1;
      this.track.style.width = tw + "px";
      this.thumb.style.left = (tw + 2) + "px";
      this.meters = [];
      for (let k = 0; k < this.ch; k++) {
        const m = document.createElement("div");
        m.className = "lg-meter";
        m.style.left = k * (bw + 1) + "px";
        m.style.width = bw + "px";
        this.track.insertBefore(m, this.thumb);
        this.meters.push(m);
      }
      this.render();
    }
    render() {
      if (!this.thumb) return;
      this.thumb.style.bottom = `calc(${this.frac() * 100}% - 5px)`;
      this.dbel.textContent = this.db <= this.min ? "-inf dB" : `${this.db.toFixed(1)} dB`;
    }
    output() { this.out(this.ch + 1, [this.frac()]); this.out(this.ch, [this.db]); }
    set(db, send) {
      this.db = this.clamp(db);
      for (const g of this.gs) setParam(g.gain, this.gain(), Math.max(0.001, this.interp / 3000));
      this.render();
      if (send) this.output();
    }
    receive(i, m) {
      const s = sel(m), x = num(m.slice(1));
      if (isBang(m) || s === "outputvalue") return this.output();
      if (s === "set") return this.set(x, false);
      if (s === "init") return this.set(this.init, true);
      if (s === "rawfloat") return this.set(this.min + Math.min(1, Math.max(0, x)) * (this.max - this.min), true);
      if (s === "assign") return this.set(x, true);
      if (s === "interp") { this.interp = x; return; }
      if (!isNum(m)) return this.nope(m);
      this.set(m[0], true);
    }
    press(e) {
      const h = this.track ? this.track.getBoundingClientRect().height : 100;
      return dragValue(e, this.db, (v) => this.set(v, true), Math.max(0.5, h / (this.max - this.min)));
    }
    sigOut(o) { return o < this.ch ? { node: this.gs[o] } : null; }
    sigTarget(i) { return { node: this.gs[i] || nullIn }; }
    draw() {
      if (!this.meters) return;
      const running = AC.state === "running";
      const dbs = [];
      for (let k = 0; k < this.ch; k++) {
        let pk = 0;
        if (running) {
          this.ans[k].getFloatTimeDomainData(this.bufs[k]);
          for (const v of this.bufs[k]) pk = Math.max(pk, Math.abs(v));
        }
        this.peaks[k] = Math.max(pk, this.peaks[k] * 0.9);
        const db = this.peaks[k] > 0 ? 20 * Math.log10(this.peaks[k]) : -100;
        dbs.push(Math.max(-100, db));
        const f = Math.max(0, Math.min(1, (db - this.min) / (this.max - this.min)));
        this.meters[k].style.height = (f * 100) + "%";
        this.meters[k].classList.toggle("hot", db > -6);
      }
      if (running && this.patch.hasCord(this.box.id, this.ch + 2)) this.out(this.ch + 2, dbs);
    }
    destroy() { this.gs.forEach((g) => g.disconnect()); this.ans.forEach((a) => a.disconnect()); }
  }

  // ------------------------------------------------------------ kslider
  // On-screen keyboard. Outlets: pitch, velocity (the velocity goes out
  // first). Box attributes: mode (0 monophonic, 1 polyphonic, 2 touchscreen:
  // a note lasts while pressed), offset (lowest note), range (number of
  // keys), inputmode (0 off, 1 clipped to 0-127, 2 clipped to the keys).
  // The velocity of a click depends on its height on the key: higher, louder.
  const IS_BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const isBlack = (p) => IS_BLACK[((p % 12) + 12) % 12] === 1;
  function rgbaCss(c, def) {
    if (!Array.isArray(c) || c.length < 3) return def;
    const [r, g, b] = c.map((x) => Math.round(Number(x) * 255));
    return `rgba(${r},${g},${b},${c.length > 3 ? Number(c[3]) : 1})`;
  }
  class Kslider extends Obj {
    constructor(p, b, a) {
      super(p, b, a);
      this.nin = 2;
      this.outTypes = ["int", "int"];
      this.vel = 64;          // velocity used for pitches arriving at the inlet
      this.pitch = null;      // monophonic: the key shown
      this.held = new Map();  // polyphonic: pitch -> velocity
      this.last = null;       // last [pitch, velocity] sent, for bang
    }
    get mode() { return Math.trunc(Number(this.battr("mode", 0))) || 0; }
    get lo() { return Math.trunc(Number(this.battr("offset", 36))) || 0; }
    get count() { return Math.max(1, Math.trunc(Number(this.battr("range", 48))) || 48); }
    // White keys share the width; a black key sits on the line between two.
    keys(w, h) {
      const lo = this.lo, hi = lo + this.count - 1;
      let nw = 0;
      for (let p = lo; p <= hi; p++) if (!isBlack(p)) nw++;
      const ww = w / Math.max(1, nw), bw = ww * 0.6, bh = h * 0.6, white = [], black = [];
      let k = 0;
      for (let p = lo; p <= hi; p++) {
        if (isBlack(p)) black.push({ p, x: k * ww - bw / 2, w: bw, h: bh });
        else { white.push({ p, x: k * ww, w: ww, h }); k++; }
      }
      return { white, black };
    }
    velAt(y, h) { return Math.max(1, Math.min(127, Math.round(127 * (1 - y / h)))); }
    keyAt(x, y, w, h) {
      if (x < 0 || x > w || y < 0 || y > h) return null;
      if (x >= w - 2) { // far right edge: the C just after the keys
        let p = this.lo + this.count;
        while (((p % 12) + 12) % 12 !== 0) p++;
        return { p, vel: this.velAt(y, h) };
      }
      const { white, black } = this.keys(w, h);
      for (const k of black) if (x >= k.x && x < k.x + k.w && y < k.h) return { p: k.p, vel: this.velAt(y, k.h) };
      for (const k of white) if (x >= k.x && x < k.x + k.w) return { p: k.p, vel: this.velAt(y, k.h) };
      return null;
    }
    send(p, v) { this.last = [p, v]; this.out(1, [v]); this.out(0, [p]); }
    note(p, v) {
      if (this.mode === 0) this.pitch = p;
      else if (v > 0) this.held.set(p, v);
      else this.held.delete(p);
      this.render();
      this.send(p, v);
    }
    input(p) {
      p = Math.trunc(p);
      const im = Math.trunc(Number(this.battr("inputmode", 0))) || 0;
      if (im === 1) p = Math.max(0, Math.min(127, p));
      if (im === 2) p = Math.max(this.lo, Math.min(this.lo + this.count - 1, p));
      this.note(p, this.vel);
    }
    noteOffs() { for (const p of [...this.held.keys()]) { this.held.delete(p); this.send(p, 0); } this.render(); }
    receive(i, m) {
      if (i === 1) { if (isNum(m)) this.vel = Math.trunc(m[0]); else this.nope(m); return; }
      if (isBang(m)) { if (this.last) this.send(this.last[0], this.last[1]); return; }
      if (isNum(m)) {
        if (typeof m[1] === "number") this.vel = Math.trunc(m[1]); // pitch velocity
        return this.input(m[0]);
      }
      const s = sel(m), args = m.slice(1).filter((x) => typeof x === "number");
      if (s === "set") { // display only, no output
        const p = Math.trunc(args[0] || 0), v = args.length > 1 ? Math.trunc(args[1]) : this.vel;
        if (this.mode === 0) this.pitch = p;
        else if (v > 0) this.held.set(p, v);
        else this.held.delete(p);
        return this.render();
      }
      if (s === "clear") { this.pitch = null; this.held.clear(); return this.render(); }
      if (s === "flush") return this.noteOffs();
      if (s === "chord") {
        this.noteOffs();
        for (let k = 0; k + 1 < args.length; k += 2) this.note(Math.trunc(args[k]), Math.trunc(args[k + 1]));
        return;
      }
      if (s === "mode" || s === "offset" || s === "range" || s === "inputmode") {
        this.box[s] = Math.trunc(args[0] || 0);
        this.pitch = null;
        this.held.clear();
        return this.render();
      }
      if (s === "size") return; // old display size switch: here the box size counts
      this.nope(m);
    }
    press(ev, pt) {
      const r = this.rect(), at = (q) => this.keyAt(q.x - r[0], q.y - r[1], r[2], r[3]);
      const k = at(pt), mode = this.mode;
      if (!k) return null;
      if (mode === 1) { // polyphonic: a click turns the key on, the next one off
        if (this.held.has(k.p)) this.note(k.p, 0);
        else { this.vel = k.vel; this.note(k.p, k.vel); }
        return null;
      }
      this.vel = k.vel;
      this.note(k.p, k.vel);
      let cur = k.p;
      const release = () => { if (mode === 2 && cur !== null) this.note(cur, 0); cur = null; };
      return {
        move: (e2, p2) => {
          const k2 = at(p2);
          if (!k2 || k2.p === cur || cur === null) return;
          if (mode === 2) this.note(cur, 0);
          cur = k2.p;
          this.vel = k2.vel;
          this.note(cur, k2.vel);
        },
        up: release,
        cancel: release,
      };
    }
    build(el) {
      this.canvas = document.createElement("canvas");
      this.canvas.className = "gui-canvas";
      el.append(this.canvas);
      this.render();
    }
    render() {
      const c = this.canvas;
      if (!c) return;
      const r = this.rect(), [W, H] = canvasSize(c, r), g = c.getContext("2d"), w = r[2], h = r[3];
      g.setTransform(W / w, 0, 0, H / h, 0, 0);
      const on = (p) => (this.mode === 0 ? this.pitch === p : this.held.has(p));
      const wc = rgbaCss(this.box.whitekeycolor, "#ffffff");
      const bc = rgbaCss(this.box.blackkeycolor, "#1e1e1e");
      const hc = rgbaCss(this.box.hkeycolor, "#4da3ff");
      const { white, black } = this.keys(w, h);
      g.fillStyle = "#5a5a5a";
      g.fillRect(0, 0, w, h);
      for (const k of white) { g.fillStyle = on(k.p) ? hc : wc; g.fillRect(k.x + 0.5, 0.5, k.w - 1, h - 1); }
      for (const k of black) { g.fillStyle = on(k.p) ? hc : bc; g.fillRect(k.x, 0, k.w, k.h); }
    }
  }

  // ------------------------------------------------------------ playlist~
  // Sound files are kept in this browser (IndexedDB) under their name, so
  // a saved patch finds its clips again, as Max finds them on disk.
  const fileCache = (() => {
    let dbp = null;
    function open() {
      if (!dbp) {
        dbp = new Promise((ok, fail) => {
          try {
            const r = indexedDB.open("patcher-audio", 1);
            r.onupgradeneeded = () => r.result.createObjectStore("files");
            r.onsuccess = () => ok(r.result);
            r.onerror = () => fail(r.error);
          } catch (err) { fail(err); }
        });
      }
      return dbp;
    }
    async function run(mode, fn) {
      const db = await open();
      return new Promise((ok, fail) => {
        const t = db.transaction("files", mode), req = fn(t.objectStore("files"));
        t.oncomplete = () => ok(req.result);
        t.onerror = () => fail(t.error);
        t.onabort = () => fail(t.error);
      });
    }
    return {
      put: (name, blob) => run("readwrite", (s) => s.put(blob, name)).catch(() => null),
      get: (name) => run("readonly", (s) => s.get(name)).catch(() => null),
    };
  })();

  // Lowest and highest sample of each of n stretches of the file (all channels).
  function peaksOf(buf, n) {
    const mins = new Float32Array(n), maxs = new Float32Array(n), len = buf.length;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let k = 0; k < n; k++) {
        const a = Math.floor(k * len / n), b = Math.min(len, Math.max(a + 1, Math.floor((k + 1) * len / n)));
        let lo = mins[k], hi = maxs[k];
        for (let i = a; i < b; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        mins[k] = lo;
        maxs[k] = hi;
      }
    }
    return { mins, maxs };
  }

  // playlist~: a list of sound files (clips), each shown with its waveform.
  // Left column of each clip: handle (drag to reorder), play/stop, loop.
  // On the waveform: drag to select the part to play; a click clears the
  // selection and, on the clip that is playing, moves the playhead there.
  // Files: append, a drop on the object, or a tap on an empty playlist~.
  // Outlets: one signal per channel, the position (clip number + fraction),
  // messages (start N name, done N name, loopnotify N name), dictionary.
  // Inlet: messages, or a signal whose integer part starts that clip.
  const PL_CW = 30; // width of the left column
  class Playlist extends WObj {
    constructor(p, b, a) {
      super(p, b, a);
      this.ch = Math.max(1, Math.min(8, Math.trunc(Number(this.battr("channelcount", 2))) || 2));
      this.nin = 1;
      this.sigIn = new Set([0]);
      this.outTypes = new Array(this.ch).fill("signal").concat(["signal", "", "dictionary"]);
      this.speed = Number(this.battr("speed", 1));
      if (!Number.isFinite(this.speed)) this.speed = 1;
      this.clips = [];
      this.head = null;    // [clip id, fraction, state] from the processor
      this.playing = null; // id of the clip playing or paused
      this.dropAt = null;  // where dropped files would go
      this.dropMark = null; // where a dragged clip would go
      this.queue = Promise.resolve();
      this.dsp("pe-playlist", 1, this.ch + 1, { rate: this.speed });
      // clips saved in the patch: their sound comes from this browser's store
      const saved = ((b.data || {}).clips) || [];
      for (const s of saved) {
        const clip = this.newClip(String(s.filename || s.absolutepath || "?"), s.id);
        clip.loop = s.loop ? 1 : 0;
        if (Array.isArray(s.pe_selection)) clip.sel = s.pe_selection.slice(0, 2);
        this.clips.push(clip);
        this.queue = this.queue.then(() => this.restore(clip));
      }
      this.sendOrder();
    }
    newClip(name, id) {
      return {
        id: id || "u" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"),
        name, frames: 0, sel: null, loop: Number(this.battr("loop", 0)) ? 1 : 0,
        speed: null, missing: true, loading: false, peaks: null,
      };
    }
    async restore(clip) {
      if (this.dead || !this.clips.includes(clip)) return;
      clip.loading = true;
      this.dirty = true;
      const f = await fileCache.get(clip.name);
      if (f && !this.dead && this.clips.includes(clip)) await this.loadInto(clip, f, true);
      clip.loading = false;
      this.dirty = true;
    }
    async loadInto(clip, file, fromStore) {
      let buf;
      try {
        buf = await decodeAudio(await file.arrayBuffer());
      } catch (err) {
        this.patch.log(`${this.name}: ${clip.name} non si può leggere in questo browser. Prova WAV o MP3.`);
        return false;
      }
      if (this.dead || !this.clips.includes(clip)) return false;
      const chans = [];
      for (let c = 0; c < Math.min(this.ch, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c).slice());
      clip.peaks = peaksOf(buf, 2048);
      clip.frames = buf.length;
      clip.missing = false;
      this.node.port.postMessage({ clip: { id: clip.id, data: chans } }, chans.map((x) => x.buffer));
      this.sendClip(clip);
      this.sendOrder();
      if (!fromStore) fileCache.put(clip.name, file);
      this.dirty = true;
      return true;
    }
    async add(file, at, name) {
      const clip = this.newClip(name || file.name || "file");
      const k = at === undefined || at === null ? this.clips.length : Math.max(0, Math.min(this.clips.length, at));
      this.clips.splice(k, 0, clip);
      clip.loading = true;
      this.sendOrder();
      this.dirty = true;
      const ok = await this.loadInto(clip, file);
      clip.loading = false;
      if (ok) this.save();
      else this.removeClip(clip);
    }
    async replace(clip, file) {
      if (this.playing === clip.id) this.post({ stop: 1 });
      clip.name = file.name || clip.name;
      clip.sel = null;
      clip.loading = true;
      this.dirty = true;
      await this.loadInto(clip, file);
      clip.loading = false;
      this.save();
    }
    removeClip(clip) {
      const k = this.clips.indexOf(clip);
      if (k < 0) return;
      this.clips.splice(k, 1);
      this.post({ drop: clip.id });
      if (this.playing === clip.id) { this.playing = null; this.head = null; }
      this.sendOrder();
      this.save();
      this.dirty = true;
    }
    sendClip(clip) {
      if (clip.missing) return;
      const s = clip.sel ? clip.sel[0] : 0, e = clip.sel ? clip.sel[1] : 1;
      this.post({ clipset: { id: clip.id, s: s * clip.frames, e: e * clip.frames, loop: clip.loop, speed: clip.speed } });
    }
    sendOrder() { this.post({ order: this.clips.map((c) => c.id) }); }
    // the clips go into the patch as in Max (.maxpat), plus the selection
    save() {
      this.box.data = {
        clips: this.clips.map((c) => {
          const o = { absolutepath: c.name, filename: c.name, filekind: "audiofile", id: c.id, loop: c.loop, content_state: {} };
          if (c.sel) o.pe_selection = c.sel.slice();
          return o;
        }),
      };
      this.patch.onChange("data", this.box.id);
    }
    playClip(clip) {
      if (clip.missing) {
        this.patch.log(`${this.name}: manca il file ${clip.name}: toccalo nella playlist~ o trascinalo sopra per sceglierlo di nuovo`);
        return;
      }
      this.post({ play: { id: clip.id } });
    }
    fromDsp(d) {
      if ("pos" in d) {
        this.head = d.pos;
        this.playing = d.pos ? d.pos[0] : null;
        this.dirty = true;
        return;
      }
      const id = "start" in d ? d.start : "done" in d ? d.done : d.looped;
      const k = this.clips.findIndex((c) => c.id === id), name = k >= 0 ? this.clips[k].name : "";
      const o = this.ch + 1;
      if ("start" in d) this.out(o, ["start", k + 1, name]);
      else if ("done" in d) this.out(o, ["done", k + 1, name]);
      else if (Number(this.battr("loopreport", 0))) this.out(o, ["loopnotify", k + 1, name]);
    }
    async appendNamed(name, at) {
      const f = await fileCache.get(name);
      if (!f) {
        this.patch.log(`${this.name}: ${name} non è tra i file già usati in questo browser: manda append senza nome per sceglierlo`);
        return;
      }
      this.add(f, at, name);
    }
    // selection [clip] start end: 0..1 (or ms); two numbers: every clip;
    // only the clip number: no selection for that clip.
    setSelection(ms, args) {
      const n = args.filter((x) => typeof x === "number");
      const frac = (c, v) => (ms ? (c.frames ? v * AC.sampleRate / 1000 / c.frames : 0) : v);
      const clamp = (v) => Math.max(0, Math.min(1, v));
      const apply = (c, a, b) => {
        if (!c) return;
        if (a === undefined) c.sel = null;
        else {
          let s = clamp(frac(c, a)), e = clamp(frac(c, b));
          if (e < s) [s, e] = [e, s];
          c.sel = e > s ? [s, e] : null;
        }
        this.sendClip(c);
      };
      if (n.length >= 3) apply(this.clips[Math.trunc(n[0]) - 1], n[1], n[2]);
      else if (n.length === 2) this.clips.forEach((c) => apply(c, n[0], n[1]));
      else if (n.length === 1) apply(this.clips[Math.trunc(n[0]) - 1]);
      this.save();
      this.dirty = true;
    }
    receive(i, m) {
      if (isNum(m)) {
        const k = Math.trunc(m[0]);
        if (k === 0) this.post({ stop: 1 });
        else if (k > 0 && k <= this.clips.length) this.playClip(this.clips[k - 1]);
        return;
      }
      const s = sel(m), args = m.slice(1);
      if (s === "append") {
        const name = typeof args[0] === "string" ? args[0] : null;
        const pos = args[name ? 1 : 0], at = typeof pos === "number" ? Math.trunc(pos) - 1 : undefined;
        if (name) return this.appendNamed(name, at);
        return this.patch.pickAudio(this, (f) => this.add(f, at));
      }
      if (s === "clear") { this.post({ stop: 1 }); this.clips.slice().forEach((c) => this.removeClip(c)); return; }
      if (s === "remove") { const c = this.clips[Math.trunc(num(args)) - 1]; if (c) this.removeClip(c); return; }
      if (s === "next") {
        const c = this.clips[this.clips.findIndex((x) => x.id === this.playing) + 1];
        if (c) this.playClip(c);
        return;
      }
      if (s === "pause") return this.post({ pause: 1 });
      if (s === "resume") return this.post({ resume: 1 });
      if (s === "selection" || s === "selectionms") return this.setSelection(s === "selectionms", args);
      if (s === "setclip") {
        const c = this.clips[Math.trunc(Number(args[0])) - 1], what = args[1], v = Number(args[2]);
        if (!c) return;
        if (what === "loop") { c.loop = v ? 1 : 0; this.save(); }
        else if (what === "speed") c.speed = Number.isFinite(v) ? v : null;
        else return this.patch.log(`${this.name}: setclip ${what}: qui non c'è`);
        this.sendClip(c);
        this.dirty = true;
        return;
      }
      if (s === "loop") {
        const v = num(args) ? 1 : 0;
        this.box.loop = v;
        this.clips.forEach((c) => { c.loop = v; this.sendClip(c); });
        this.save();
        this.dirty = true;
        return;
      }
      if (s === "speed") { this.speed = num(args); this.box.speed = this.speed; return this.setp({ rate: this.speed }); }
      if (s === "loopreport" || s === "showname" || s === "waveformdisplay" || s === "allowreorder") {
        this.box[s] = num(args) ? 1 : 0;
        this.dirty = true;
        return;
      }
      if (s === "getcontent") return this.patch.log(`${this.name}: getcontent manda un dizionario, e qui i dizionari non ci sono`);
      if (!isBang(m)) this.nope(m);
    }
    clipAt(y, h) {
      const n = this.clips.length;
      return Math.min(n - 1, Math.max(0, Math.floor(y / (h / n))));
    }
    press(ev, pt) {
      this.hideMenu();
      const r = this.rect(), x = pt.x - r[0], y = pt.y - r[1];
      if (!this.clips.length) { this.patch.pickAudio(this, (f) => this.add(f)); return null; }
      const clip = this.clips[this.clipAt(y, r[3])];
      if (x < 9) return Number(this.battr("allowreorder", 1)) ? this.reorder(clip, r) : null;
      if (x < 20) {
        if (this.playing === clip.id) this.post({ stop: 1 });
        else this.playClip(clip);
        return null;
      }
      if (x < PL_CW) { clip.loop = clip.loop ? 0 : 1; this.sendClip(clip); this.save(); this.dirty = true; return null; }
      if (clip.missing) { if (!clip.loading) this.patch.pickAudio(this, (f) => this.replace(clip, f)); return null; }
      const ww = Math.max(1, r[2] - PL_CW - 2), fx = (q) => Math.max(0, Math.min(1, (q.x - r[0] - PL_CW) / ww));
      const f0 = fx(pt);
      let moved = false;
      return {
        move: (e2, p2) => {
          const f1 = fx(p2);
          if (!moved && Math.abs(f1 - f0) * ww < 3) return;
          moved = true;
          clip.sel = [Math.min(f0, f1), Math.max(f0, f1)];
          this.sendClip(clip);
          this.dirty = true;
        },
        up: () => {
          if (!moved) {
            clip.sel = null;
            this.sendClip(clip);
            if (this.playing === clip.id) this.post({ seek: { id: clip.id, at: f0 * clip.frames } });
            this.dirty = true;
          }
          this.save();
        },
      };
    }
    reorder(clip, r) {
      let target = this.clips.indexOf(clip);
      const done = () => { this.dropMark = null; this.dirty = true; };
      return {
        move: (e2, p2) => { target = this.clipAt(p2.y - r[1], r[3]); this.dropMark = target; this.dirty = true; },
        up: () => {
          const from = this.clips.indexOf(clip);
          if (from >= 0 && target !== from) {
            this.clips.splice(from, 1);
            this.clips.splice(target, 0, clip);
            this.sendOrder();
            this.save();
          }
          done();
        },
        cancel: done,
      };
    }
    // ---- dropping files on the object
    hasFiles(ev) { return !!ev.dataTransfer && [...ev.dataTransfer.types].includes("Files"); }
    dropTarget(ev) {
      const b = this.el.getBoundingClientRect(), n = this.clips.length;
      if (!n) return { at: 0 };
      const fy = (ev.clientY - b.top) / b.height * n, k = Math.min(n - 1, Math.max(0, Math.floor(fy))), part = fy - k;
      if (part < 0.25) return { at: k };
      if (part > 0.75) return { at: k + 1 };
      return { replace: k };
    }
    dragOver(ev) {
      if (!this.hasFiles(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.dataTransfer.dropEffect = "copy";
      this.dropAt = this.dropTarget(ev);
      this.dirty = true;
    }
    dropFiles(ev) {
      if (!this.hasFiles(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const t = this.dropTarget(ev), files = [...ev.dataTransfer.files];
      this.dropAt = null;
      this.dirty = true;
      if (!files.length) return;
      let at = t.at;
      if (t.replace !== undefined) { this.replace(this.clips[t.replace], files.shift()); at = t.replace + 1; }
      for (const f of files) this.add(f, at++);
    }
    // ---- right click: remove a clip
    menuAt(ev) {
      ev.preventDefault();
      this.hideMenu();
      const n = this.clips.length;
      if (!n) return;
      const r = this.rect(), b = this.el.getBoundingClientRect();
      const clip = this.clips[Math.min(n - 1, Math.max(0, Math.floor((ev.clientY - b.top) / b.height * n)))];
      const menu = document.createElement("div"), item = document.createElement("button");
      menu.className = "pl-menu";
      item.type = "button";
      item.textContent = "Rimuovi";
      menu.append(item);
      menu.style.left = ((ev.clientX - b.left) / b.width * r[2]) + "px";
      menu.style.top = ((ev.clientY - b.top) / b.height * r[3]) + "px";
      menu.addEventListener("pointerdown", (e) => e.stopPropagation());
      item.addEventListener("click", () => { this.hideMenu(); this.removeClip(clip); });
      this.el.append(menu);
      this.menu = menu;
      setTimeout(() => document.addEventListener("pointerdown", () => this.hideMenu(), { once: true }), 0);
    }
    hideMenu() { if (this.menu) { this.menu.remove(); this.menu = null; } }
    build(el) {
      this.el = el;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "gui-canvas";
      el.append(this.canvas);
      el.addEventListener("contextmenu", (ev) => this.menuAt(ev));
      el.addEventListener("dragover", (ev) => this.dragOver(ev));
      el.addEventListener("dragleave", () => { this.dropAt = null; this.dirty = true; });
      el.addEventListener("drop", (ev) => this.dropFiles(ev));
      this.paint();
    }
    draw() { if (this.dirty) this.paint(); }
    paint() {
      const c = this.canvas;
      if (!c) return;
      this.dirty = false;
      const r = this.rect(), [W, H] = canvasSize(c, r), g = c.getContext("2d"), w = r[2], h = r[3];
      g.setTransform(W / w, 0, 0, H / h, 0, 0);
      g.fillStyle = "#333333";
      g.fillRect(0, 0, w, h);
      g.font = "10px Arimo, Arial, sans-serif";
      const n = this.clips.length, accent = "#4da3ff";
      if (!n) {
        g.fillStyle = "#a0a0a0";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("Tocca qui o trascina un file audio", w / 2, h / 2, w - 8);
        if (this.dropAt) { g.fillStyle = "rgba(77,163,255,0.25)"; g.fillRect(0, 0, w, h); }
        return;
      }
      const rh = h / n, x0 = PL_CW, ww = Math.max(1, w - PL_CW - 2);
      const bipolar = Number(this.battr("waveformdisplay", 1)) === 0, showname = Number(this.battr("showname", 1)) !== 0;
      this.clips.forEach((clip, k) => {
        const y0 = k * rh, mid = y0 + rh / 2, sz = Math.max(2.5, Math.min(5, rh * 0.22));
        if (k > 0) { g.fillStyle = "#555555"; g.fillRect(0, y0, w, 1); }
        if ((this.dropAt && this.dropAt.replace === k) || this.dropMark === k) { g.fillStyle = "rgba(77,163,255,0.25)"; g.fillRect(0, y0, w, rh); }
        // handle
        g.fillStyle = "#8a8a8a";
        g.beginPath(); g.arc(4.5, mid, 2.2, 0, 2 * Math.PI); g.fill();
        // play / stop
        const on = this.playing === clip.id, running = on && this.head && this.head[2] === 1;
        g.fillStyle = on ? accent : clip.missing ? "#6a6a6a" : "#d0d0d0";
        if (running) g.fillRect(14.5 - sz * 0.8, mid - sz * 0.8, sz * 1.6, sz * 1.6);
        else { g.beginPath(); g.moveTo(14.5 - sz * 0.7, mid - sz); g.lineTo(14.5 + sz, mid); g.lineTo(14.5 - sz * 0.7, mid + sz); g.closePath(); g.fill(); }
        // loop: a circle with an arrow
        g.strokeStyle = g.fillStyle = clip.loop ? accent : "#7a7a7a";
        g.lineWidth = 1.3;
        g.beginPath(); g.arc(24.5, mid, sz * 0.8, 0.4, 1.9 * Math.PI); g.stroke();
        g.beginPath(); g.moveTo(24.5 + sz * 0.8 - 2, mid - 1); g.lineTo(24.5 + sz * 0.8 + 2, mid - 1); g.lineTo(24.5 + sz * 0.8, mid + 2); g.closePath(); g.fill();
        // waveform
        const wy = y0 + 1, wh = Math.max(1, rh - 2);
        g.fillStyle = "#222222";
        g.fillRect(x0, wy, ww, wh);
        if (clip.peaks) {
          const { mins, maxs } = clip.peaks, B = mins.length;
          g.fillStyle = "#bdbdbd";
          for (let px = 0; px < ww; px++) {
            const a = Math.floor(px * B / ww), b = Math.max(a + 1, Math.floor((px + 1) * B / ww));
            let lo = 0, hi = 0;
            for (let i = a; i < b && i < B; i++) { if (mins[i] < lo) lo = mins[i]; if (maxs[i] > hi) hi = maxs[i]; }
            if (bipolar) {
              const yt = wy + wh / 2 - Math.min(1, hi) * wh / 2, yb = wy + wh / 2 - Math.max(-1, lo) * wh / 2;
              g.fillRect(x0 + px, yt, 1, Math.max(1, yb - yt));
            } else {
              const v = Math.min(1, Math.max(hi, -lo));
              g.fillRect(x0 + px, wy + wh - v * wh, 1, Math.max(1, v * wh));
            }
          }
        }
        if (clip.sel) { g.fillStyle = "rgba(77,163,255,0.32)"; g.fillRect(x0 + clip.sel[0] * ww, wy, (clip.sel[1] - clip.sel[0]) * ww, wh); }
        if (this.head && this.head[0] === clip.id) { g.fillStyle = "#ffffff"; g.fillRect(x0 + this.head[1] * ww - 0.5, wy, 1.5, wh); }
        if (showname && rh >= 13) {
          const label = clip.loading ? `${clip.name} …` : clip.missing ? `${clip.name} (manca il file: tocca per sceglierlo)` : clip.name;
          g.textAlign = "left";
          g.textBaseline = "top";
          g.fillStyle = clip.missing && !clip.loading ? "#e1a298" : "#f0f0f0";
          g.fillText(label, x0 + 3, wy + 2, ww - 6);
        }
      });
      if (this.dropAt && this.dropAt.at !== undefined) {
        g.fillStyle = accent;
        g.fillRect(0, Math.min(h - 2, Math.max(0, this.dropAt.at * rh - 1)), w, 2);
      }
    }
    destroy() { this.dead = true; this.hideMenu(); super.destroy(); }
  }

  // ------------------------------------------------------------ class table
  const NEWOBJ = {
    "mtof": (p, b, a) => new Mtof(p, b, a),
    "ftom": (p, b, a) => new Ftom(p, b, a),
    "+": (p, b, a) => new Arith(p, b, a, "+"),
    "-": (p, b, a) => new Arith(p, b, a, "-"),
    "*": (p, b, a) => new Arith(p, b, a, "*"),
    "/": (p, b, a) => new Arith(p, b, a, "/"),
    "sel": (p, b, a) => new Select(p, b, a),
    "select": (p, b, a) => new Select(p, b, a),
    "t": (p, b, a) => new Trigger(p, b, a),
    "trigger": (p, b, a) => new Trigger(p, b, a),
    "i": (p, b, a) => new Store(p, b, a, true),
    "int": (p, b, a) => new Store(p, b, a, true),
    "f": (p, b, a) => new Store(p, b, a, false),
    "float": (p, b, a) => new Store(p, b, a, false),
    "metro": (p, b, a) => new Metro(p, b, a),
    "delay": (p, b, a) => new Delay(p, b, a),
    "del": (p, b, a) => new Delay(p, b, a),
    "random": (p, b, a) => new Random(p, b, a),
    "pack": (p, b, a) => new Pack(p, b, a),
    "unpack": (p, b, a) => new Unpack(p, b, a),
    "poly": (p, b, a) => new PolyAlloc(p, b, a),
    "s": (p, b, a) => new Send(p, b, a),
    "send": (p, b, a) => new Send(p, b, a),
    "r": (p, b, a) => new Receive(p, b, a),
    "receive": (p, b, a) => new Receive(p, b, a),
    "print": (p, b, a) => new Print(p, b, a),
    "loadbang": (p, b, a) => new Loadbang(p, b, a),
    "loadmess": (p, b, a) => new Loadmess(p, b, a),
    "counter": (p, b, a) => new Counter(p, b, a),
    "line": (p, b, a) => new LineCtl(p, b, a),
    "clip": (p, b, a) => new ClipCtl(p, b, a),
    "saw~": (p, b, a) => (WK ? new Shape(p, b, a, "saw") : new Osc(p, b, a, "sawtooth")),
    "cycle~": (p, b, a) => (WK ? new Cycle(p, b, a) : new Osc(p, b, a, "sine")),
    "rect~": (p, b, a) => (WK ? new Shape(p, b, a, "rect") : new Osc(p, b, a, "square")),
    "tri~": (p, b, a) => (WK ? new Shape(p, b, a, "tri") : new Osc(p, b, a, "triangle")),
    "noise~": (p, b, a) => new Noise(p, b, a),
    "*~": (p, b, a) => new Mul(p, b, a),
    "+~": (p, b, a) => new AddSub(p, b, a, 1),
    "-~": (p, b, a) => new AddSub(p, b, a, -1),
    "lores~": (p, b, a) => (WK ? new Lores(p, b, a) : new BiquadLores(p, b, a)),
    "adsr~": (p, b, a) => (WK ? new Adsr(p, b, a) : new ParamAdsr(p, b, a)),
    "line~": (p, b, a) => (WK ? new Line(p, b, a) : new ParamLine(p, b, a)),
    "sig~": (p, b, a) => new Sig(p, b, a),
    "dac~": (p, b, a) => new Dac(p, b, a),
    "adc~": (p, b, a) => new Adc(p, b, a),
    "tapin~": (p, b, a) => (WK ? new TapIn(p, b, a) : new NeedsWorklet(p, b, a)),
    "tapout~": (p, b, a) => (WK ? new TapOut(p, b, a) : new NeedsWorklet(p, b, a)),
    "pitchshift~": (p, b, a) => (WK ? new PitchShift(p, b, a) : new NeedsWorklet(p, b, a)),
    "cverb~": (p, b, a) => (WK ? new CVerb(p, b, a) : new NeedsWorklet(p, b, a)),
    "clip~": (p, b, a) => (WK ? new ClipSig(p, b, a) : new NeedsWorklet(p, b, a)),
    "limi~": (p, b, a) => (WK ? new Limi(p, b, a) : new NeedsWorklet(p, b, a)),
    "sfplay~": (p, b, a) => (WK ? new Sfplay(p, b, a) : new NeedsWorklet(p, b, a)),
    "sfrecord~": (p, b, a) => (WK ? new SfRecord(p, b, a) : new NeedsWorklet(p, b, a)),
  };

  // GUI classes: factory, default size, Max box fields used when the object is created here.
  const GUI = {
    "dial": { make: (p, b, a) => new Dial(p, b, a), size: [40, 40], io: [1, ["float"]], extra: { parameter_enable: 0 } },
    "number": { make: (p, b, a) => new NumBox(p, b, a, false), size: [50, 22], io: [1, ["", "bang"]], extra: { parameter_enable: 0 } },
    "flonum": { make: (p, b, a) => new NumBox(p, b, a, true), size: [50, 22], io: [1, ["", "bang"]], extra: { parameter_enable: 0, format: 6 } },
    "toggle": { make: (p, b, a) => new Toggle(p, b, a), size: [24, 24], io: [1, ["int"]], extra: { parameter_enable: 0 } },
    "button": { make: (p, b, a) => new Button(p, b, a), size: [24, 24], io: [1, ["bang"]], extra: { parameter_enable: 0 } },
    "slider": { make: (p, b, a) => new Slider(p, b, a), size: [20, 140], io: [1, [""]], extra: { parameter_enable: 0 } },
    "ezdac~": { make: (p, b, a) => new Ezdac(p, b, a), size: [45, 45], io: [2, []], extra: {} },
    "ezadc~": { make: (p, b, a) => new Ezadc(p, b, a), size: [45, 45], io: [1, ["signal", "signal"]], extra: {} },
    "kslider": { make: (p, b, a) => new Kslider(p, b, a), size: [336, 53], io: [2, ["int", "int"]], extra: { parameter_enable: 0 } },
    "playlist~": {
      make: (p, b, a) => (WK ? new Playlist(p, b, a) : new NeedsWorklet(p, b, a)), size: [300, 90],
      io: [1, ["signal", "signal", "signal", "", "dictionary"]],
      extra: {
        basictuning: 440, data: { clips: [] }, followglobaltempo: 0, formantcorrection: 0, mode: "basic",
        originallength: [0.0, "ticks"], originaltempo: 120.0, parameter_enable: 0, pitchcorrection: 0,
        quality: "basic", timestretch: [0],
      },
    },
    "panel": {
      make: (p, b, a) => new Panel(p, b, a), size: [128, 128], io: [1, []],
      extra: { angle: 270.0, background: 1, bgcolor: [0.5, 0.55, 0.75, 0.35], mode: 0, proportion: 0.5 },
    },
    "scope~": { make: (p, b, a) => new AnScope(p, b, a), size: [130, 130], io: [2, []], extra: {} },
    "live.scope~": { make: (p, b, a) => new LiveScope(p, b, a), size: [140, 70], io: [2, ["bang"]], extra: {} },
    "live.gain~": {
      make: (p, b, a) => new LiveGain(p, b, a), size: [48, 136], io: [2, ["signal", "signal", "", "float", "list"]],
      extra: {
        channels: 2, lastchannelcount: 0, parameter_enable: 1,
        saved_attribute_attributes: { valueof: { parameter_initial: [-70], parameter_initial_enable: 1,
          parameter_longname: "live.gain~", parameter_mmax: 6.0, parameter_mmin: -70.0,
          parameter_shortname: "live.gain~", parameter_type: 0, parameter_unitstyle: 4 } },
      },
    },
  };
  const OTHER = {
    "message": (p, b, a) => new Message(p, b, a),
    "comment": (p, b, a) => new Comment(p, b, a),
  };

  function instantiate(patch, box) {
    const mc = box.maxclass;
    let inst;
    ATTRS = {};
    try {
      if (mc === "newobj") {
        const atoms = parseAtoms(box.text || "");
        const name = atoms.length ? String(atoms[0]) : "";
        const { args, attrs } = splitAttrs(atoms.slice(1));
        ATTRS = attrs;
        const f = NEWOBJ[name];
        inst = f ? f(patch, box, args) : new Bad(patch, box, args);
      } else if (GUI[mc]) {
        inst = GUI[mc].make(patch, box, []);
      } else if (OTHER[mc]) {
        inst = OTHER[mc](patch, box, []);
      } else {
        inst = new Bad(patch, box, []);
      }
    } catch (err) {
      patch.log(`${box.text || mc}: ${err.message}`);
      ATTRS = {};
      inst = new Bad(patch, box, []);
    }
    ATTRS = {};
    return inst;
  }

  // ------------------------------------------------------------ patch model
  const PATCHER_TEMPLATE = {
    fileversion: 1,
    appversion: { major: 8, minor: 6, revision: 5, architecture: "x64", modernui: 1 },
    classnamespace: "box", rect: [34, 87, 1100, 800], bglocked: 0, openinpresentation: 0,
    default_fontsize: 12.0, default_fontface: 0, default_fontname: "Arial", gridonopen: 1,
    gridsize: [15.0, 15.0], gridsnaponopen: 1, objectsnaponopen: 1, statusbarvisible: 2,
    toolbarvisible: 1, lefttoolbarpinned: 0, toptoolbarpinned: 0, righttoolbarpinned: 0,
    bottomtoolbarpinned: 0, toolbars_unpinned_last_save: 0, tallnewobj: 0, boxanimatetime: 200,
    enablehscroll: 1, enablevscroll: 1, devicewidth: 0.0, description: "", digest: "", tags: "",
    style: "", subpatcher_template: "", assistshowspatchername: 0, boxes: [], lines: [],
    dependency_cache: [], autosave: 0,
  };

  class Patch {
    constructor(hooks) {
      this.hooks = hooks || {};
      this.entries = new Map(); // id -> { box, inst }
      this.lines = [];          // { src: [id, o], dst: [id, i], extra }
      this.header = {};
      this.depth = 0;
      this.presenting = false; // set by the editor
    }
    log(t) { if (this.hooks.log) this.hooks.log(t); }
    onChange(kind, id) { if (this.hooks.change) this.hooks.change(kind, id); }
    setAudio(on) { if (this.hooks.audio) this.hooks.audio(on); }
    askNumber(inst, cb) { if (this.hooks.askNumber) this.hooks.askNumber(inst, cb); }
    // Lets the user choose a sound file, then calls cb(file).
    pickAudio(inst, cb) { if (this.hooks.pickAudio) this.hooks.pickAudio(inst, cb); }
    // Gives a file to the user (download), then logs msg.
    saveFile(name, blob, msg) { if (this.hooks.saveFile) this.hooks.saveFile(name, blob, msg); }
    // Resolves an MP3 encoder { push(L, R), end(), cancel() }, or null.
    mp3Encoder(sampleRate) { return this.hooks.mp3Encoder ? this.hooks.mp3Encoder(sampleRate).catch(() => null) : Promise.resolve(null); }
    hasCord(id, outlet) { return this.lines.some((l) => l.src[0] === id && l.src[1] === outlet); }

    // Message to every [receive name]; "dsp start/stop" switches audio, as in Max.
    sendTo(name, msg) {
      if (name === "dsp") {
        const s = sel(msg);
        if (s === "start" || (isNum(msg) && msg[0] !== 0)) this.setAudio(true);
        else if (s === "stop" || (isNum(msg) && msg[0] === 0)) this.setAudio(false);
        return;
      }
      const rs = bus.get(name);
      if (!rs || !rs.size) return;
      this.depth++;
      try { [...rs].forEach((r) => r.out(0, msg)); } finally { this.depth--; }
    }

    clear() {
      for (const e of this.entries.values()) this.destroyInst(e);
      this.entries.clear();
      this.lines = [];
    }
    destroyInst(e) {
      for (const ln of this.lines) if (ln.src[0] === e.box.id || ln.dst[0] === e.box.id) this.unwire(ln);
      try { e.inst.destroy(); } catch (err) { /* ignore */ }
    }

    load(json) {
      this.clear();
      const p = (json && json.patcher) || {};
      this.header = Object.assign({}, PATCHER_TEMPLATE, p);
      delete this.header.boxes;
      delete this.header.lines;
      for (const b of p.boxes || []) this.addBox(JSON.parse(JSON.stringify(b.box)), true);
      for (const l of p.lines || []) {
        const pl = l.patchline || {};
        if (!pl.source || !pl.destination) continue;
        const extra = Object.assign({}, pl);
        delete extra.source; delete extra.destination;
        this.connect(pl.source[0], pl.source[1], pl.destination[0], pl.destination[1], extra, true);
      }
      this.bang();
    }
    bang() {
      setTimeout(() => { for (const e of this.entries.values()) { try { e.inst.loadbang(); } catch (err) { this.log(String(err)); } } }, 30);
    }

    toJSON() {
      const boxes = [];
      for (const e of this.entries.values()) {
        const b = e.box, inst = e.inst;
        if (!inst.bad) {
          b.numinlets = inst.nin;
          b.numoutlets = inst.outTypes.length;
          if (b.maxclass !== "comment" && b.maxclass !== "panel") b.outlettype = inst.outTypes.slice();
        }
        boxes.push({ box: b });
      }
      const lines = this.lines.map((l) => ({ patchline: Object.assign({ destination: l.dst.slice(), source: l.src.slice() }, l.extra || {}) }));
      return { patcher: Object.assign({}, this.header, { boxes, lines }) };
    }

    newId() {
      let n = 1;
      for (const id of this.entries.keys()) {
        const m = /^obj-(\d+)$/.exec(id);
        if (m) n = Math.max(n, Number(m[1]) + 1);
      }
      return "obj-" + n;
    }

    addBox(box, quiet) {
      if (!box.id || this.entries.has(box.id)) box.id = this.newId();
      const inst = instantiate(this, box);
      const e = { box, inst };
      this.entries.set(box.id, e);
      if (!quiet) this.onChange("add", box.id);
      return e;
    }

    removeBox(id) {
      const e = this.entries.get(id);
      if (!e) return;
      for (const ln of this.lines.filter((l) => l.src[0] === id || l.dst[0] === id)) this.disconnect(ln);
      try { e.inst.destroy(); } catch (err) { /* ignore */ }
      this.entries.delete(id);
    }

    // Rebuild one box (after its text changed), keeping the cords that still fit.
    rebuild(id) {
      const e = this.entries.get(id);
      if (!e) return;
      const mine = this.lines.filter((l) => l.src[0] === id || l.dst[0] === id);
      mine.forEach((l) => this.unwire(l));
      try { e.inst.destroy(); } catch (err) { /* ignore */ }
      e.inst = instantiate(this, e.box);
      this.lines = this.lines.filter((l) => !mine.includes(l));
      for (const l of mine) this.connect(l.src[0], l.src[1], l.dst[0], l.dst[1], l.extra, true);
      if (e.inst.loadbang) setTimeout(() => e.inst.loadbang(), 0);
    }

    canConnect(sid, o, did, i) {
      const s = this.entries.get(sid), d = this.entries.get(did);
      if (!s || !d || sid === did) return false;
      if (o >= s.inst.outTypes.length || i >= d.inst.nin) return false;
      if (this.lines.some((l) => l.src[0] === sid && l.src[1] === o && l.dst[0] === did && l.dst[1] === i)) return false;
      if (s.inst.outTypes[o] === "signal" && !d.inst.sigIn.has(i)) return false;
      // the tapin~ outlet goes only into the left inlet of tapout~
      if (s.inst.outTypes[o] === "tapconnect") {
        if (!(d.inst.acceptsTap && i === 0)) return false;
        // a tapout~ reads from one tapin~ only
        const taken = this.lines.some((l) => l.dst[0] === did && l.dst[1] === 0 &&
          this.entries.get(l.src[0]).inst.outTypes[l.src[1]] === "tapconnect");
        if (taken) return false;
      }
      return true;
    }

    connect(sid, o, did, i, extra, quiet) {
      if (!this.canConnect(sid, o, did, i)) return null;
      const ln = { src: [sid, o], dst: [did, i], extra: extra || {} };
      this.lines.push(ln);
      this.wire(ln);
      if (!quiet) this.onChange("connect");
      return ln;
    }

    wire(ln) {
      const s = this.entries.get(ln.src[0]).inst, d = this.entries.get(ln.dst[0]).inst;
      if (s.outTypes[ln.src[1]] === "tapconnect") {
        if (d.linkTap) { d.linkTap(s); ln.tap = true; }
        return;
      }
      if (s.outTypes[ln.src[1]] !== "signal") return;
      const out = s.sigOut(ln.src[1]), tgt = d.sigTarget(ln.dst[1]);
      if (!out || !tgt) return;
      try {
        if (tgt.node instanceof AudioParam) out.node.connect(tgt.node, out.index || 0);
        else out.node.connect(tgt.node, out.index || 0, tgt.input || 0);
        ln.audio = [out, tgt];
        d.sigConnected(ln.dst[1], 1);
      } catch (err) { this.log("connessione audio non riuscita: " + err.message); }
    }

    unwire(ln) {
      if (ln.tap) {
        ln.tap = false;
        const d = this.entries.get(ln.dst[0]);
        if (d && d.inst.linkTap) d.inst.linkTap(null);
        return;
      }
      if (!ln.audio) return;
      const [out, tgt] = ln.audio;
      try {
        if (tgt.node instanceof AudioParam) out.node.disconnect(tgt.node, out.index || 0);
        else out.node.disconnect(tgt.node, out.index || 0, tgt.input || 0);
      } catch (err) { /* already gone */ }
      ln.audio = null;
      const d = this.entries.get(ln.dst[0]);
      if (d) d.inst.sigConnected(ln.dst[1], -1);
    }

    disconnect(ln) {
      this.unwire(ln);
      this.lines = this.lines.filter((l) => l !== ln);
    }

    // Control messages: depth first, right-to-left like Max.
    send(id, outlet, msg) {
      if (this.depth > 500) { this.log("stack overflow: troppi messaggi in cerchio"); return; }
      const targets = this.lines.filter((l) => l.src[0] === id && l.src[1] === outlet)
        .map((l) => ({ l, x: this.entries.get(l.dst[0]).box.patching_rect[0] }))
        .sort((a, b) => b.x - a.x);
      this.depth++;
      try {
        for (const { l } of targets) {
          const d = this.entries.get(l.dst[0]);
          if (d) d.inst.receive(l.dst[1], msg);
        }
      } finally { this.depth--; }
    }
  }

  window.PE = { AC, Patch, GUI, NEWOBJ, parseAtoms, fmt, ready, recorder, get worklet() { return WK; } };
})();

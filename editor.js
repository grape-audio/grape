/* Patcher editor: draws the patch like a Max window and handles use and editing
   with mouse, touch and keyboard. */
(function () {
  "use strict";
  const { AC, Patch, GUI, NEWOBJ, parseAtoms } = window.PE;

  const $ = (s) => document.querySelector(s);
  const stage = $("#stage"), sizer = $("#sizer"), canvas = $("#canvas"), cordsSvg = $("#cords");
  const marker = $("#marker"), rubber = $("#rubber"), logEl = $("#log");
  const SVGNS = "http://www.w3.org/2000/svg";
  const KEY_CURRENT = "patcher-classe:current";
  const KEY_FILES = "patcher-classe:files";
  const IOW = 9;

  // ------------------------------------------------------------ storage (may be unavailable)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };

  // ------------------------------------------------------------ log
  const logLines = [];
  function log(t) {
    logLines.push(t);
    if (logLines.length > 200) logLines.shift();
    logEl.textContent = logEl.classList.contains("open") ? logLines.join("\n") : t;
    if (logEl.classList.contains("open")) logEl.scrollTop = logEl.scrollHeight;
  }
  logEl.addEventListener("click", () => {
    logEl.classList.toggle("open");
    logEl.textContent = logEl.classList.contains("open") ? logLines.join("\n") : (logLines[logLines.length - 1] || "Pronto.");
  });

  // ------------------------------------------------------------ state
  let locked = true;
  let zoom = 1;
  let selection = new Set();
  let selCord = null;
  let insertion = null;
  let presenting = false; // presentation view, as in Max
  let patchName = "simple_monoSynth";
  const undoStack = [], redoStack = [];
  const els = new Map(); // box id -> element

  const patch = new Patch({
    log,
    change(kind, id) {
      if (kind === "retext" && id) { const e = patch.entries.get(id); if (e) { fitWidth(e); renderBox(e); renderCords(); } }
      scheduleAutosave();
    },
    audio: (on) => setAudio(on),
    askNumber: (inst, cb) => askNumber(inst, cb),
    pickAudio: (inst, cb) => pickAudio(inst, cb),
    saveFile: (name, blob, msg) => saveFile(name, blob, msg),
    mp3Encoder: (sampleRate) => mp3Encoder(sampleRate),
  });

  // ------------------------------------------------------------ audio on/off
  // Chrome restarts a suspended context by itself when a source starts
  // after a tap or key (creating sig~, +~, noise~...): audio stays off
  // until the Audio button (or dac~ start) turns it on, as in Max.
  let audioWanted = false;
  function setAudio(on) {
    audioWanted = on;
    if (on) AC.resume(); else AC.suspend();
  }
  AC.addEventListener("statechange", () => { if (AC.state === "running" && !audioWanted) AC.suspend(); });
  function showAudio() {
    const on = AC.state === "running";
    $("#audio").classList.toggle("on", on);
    $("#audio-label").textContent = on ? "Audio acceso" : "Audio spento";
  }
  AC.addEventListener("statechange", showAudio);
  $("#audio").addEventListener("click", () => setAudio(AC.state !== "running"));

  // ------------------------------------------------------------ sound files (sfplay~ open)
  // The browser opens its file dialog only right after a click or a key.
  // If that moment has passed (a tap on a touch screen, a message from
  // metro or loadbang), a small dialog asks first.
  const audioFile = $("#audio-file");
  let audioCb = null;
  function pickAudio(inst, cb) {
    audioCb = cb;
    audioFile.value = "";
    const ua = navigator.userActivation;
    if (ua && ua.isActive) { audioFile.click(); return; }
    $("#audio-for").textContent = `Il file va in ${inst.name}.`;
    $("#audiodlg").hidden = false;
  }
  audioFile.addEventListener("change", () => {
    const f = audioFile.files && audioFile.files[0];
    $("#audiodlg").hidden = true;
    if (f && audioCb) audioCb(f);
    audioCb = null;
  });

  // ------------------------------------------------------------ dropping sound files (as in Max)
  // A playlist~ takes the files dropped on it. Elsewhere in an unlocked
  // patch a new playlist~ is made for them. The browser must never open a
  // dropped file itself (the patch would be lost).
  const SOUND_FILE = /\.(wav|wave|aif|aiff|mp3|m4a|aac|ogg|oga|opus|flac|caf)$/i;
  const hasFiles = (ev) => !!ev.dataTransfer && [...ev.dataTransfer.types].includes("Files");
  window.addEventListener("dragover", (ev) => { if (hasFiles(ev)) ev.preventDefault(); });
  window.addEventListener("drop", (ev) => { if (hasFiles(ev)) ev.preventDefault(); });
  stage.addEventListener("drop", (ev) => {
    if (!hasFiles(ev) || locked) return;
    const files = [...ev.dataTransfer.files].filter((f) => /^audio\//.test(f.type) || SOUND_FILE.test(f.name));
    if (!files.length) return;
    const e = newBox("playlist~", toPatch(ev));
    if (e && e.inst.add) for (const f of files) e.inst.add(f);
  });

  // ------------------------------------------------------------ quick record (like Max's Quickrecord)
  // Records the sound that reaches dac~ and saves it as an MP3 or WAV file
  // named with the date and time, like Max does.
  const MAX_REC_SECONDS = 600;
  let recTimer = null, recEnc = null, recBusy = false;
  function stamp() {
    const d = new Date(), z = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
  }
  function showRec() {
    const R = window.PE.recorder, s = Math.floor(R.seconds);
    $("#rec").classList.toggle("on", R.recording);
    $("#rec-label").textContent = R.recording ? `Stop ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "Registra";
  }
  async function toggleRecord() {
    const R = window.PE.recorder, fmtSel = $("#rec-format");
    if (recBusy) return; // still preparing or saving
    if (!R.recording) {
      if (!window.PE.worklet) { log("La registrazione richiede l'audio completo, non disponibile in questo browser."); return; }
      recEnc = null;
      if (fmtSel.value === "mp3") {
        if (!MP3_RATES.includes(AC.sampleRate)) {
          log(`MP3 non disponibile a ${AC.sampleRate} Hz: registro in WAV.`);
        } else {
          recBusy = true;
          $("#rec-label").textContent = "Preparo…";
          recEnc = await mp3Encoder(AC.sampleRate).catch(() => null);
          recBusy = false;
          if (!recEnc) log("MP3 non disponibile qui: registro in WAV.");
        }
      }
      const enc = recEnc;
      if (!R.start(enc ? (l, r) => enc.push(l, r) : null)) {
        if (enc) enc.cancel();
        recEnc = null;
        showRec();
        log("La registrazione non è partita.");
        return;
      }
      fmtSel.disabled = true;
      log(AC.state === "running" ? "Registrazione in corso…" : "Registrazione pronta: parte quando accendi l'audio.");
      recTimer = setInterval(() => {
        showRec();
        if (R.seconds >= MAX_REC_SECONDS) { log("Registrazione fermata: massimo 10 minuti."); toggleRecord(); }
      }, 250);
      showRec();
      return;
    }
    clearInterval(recTimer);
    recBusy = true;
    const res = await R.stop();
    const enc = recEnc;
    recEnc = null;
    showRec();
    let name = "", blob = null;
    if (res && res.frames) {
      if (enc) {
        $("#rec-label").textContent = "Salvo…";
        blob = await enc.end().catch(() => null);
        name = `registrazione_${stamp()}.mp3`;
      } else {
        blob = encodeWav(res);
        name = `registrazione_${stamp()}.wav`;
      }
    } else if (enc) {
      enc.cancel();
    }
    recBusy = false;
    fmtSel.disabled = false;
    showRec();
    if (!res || !res.frames) { log("Registrazione vuota: l'audio era spento."); return; }
    if (!blob) { log("Registrazione MP3 non riuscita."); return; }
    await saveFile(name, blob, `Registrazione salvata: ${name} (${Math.round(res.frames / res.sampleRate)} s).`);
  }
  $("#rec").addEventListener("click", toggleRecord);

  // MP3 at 192 kbps with lamejs (LGPL, see LICENSE-lamejs.txt). The
  // encoding runs in a worker (mp3.js) when the page allows it, otherwise
  // here on the page.
  const MP3_KBPS = 192;
  const MP3_RATES = [32000, 44100, 48000]; // sample rates MP3 accepts
  let mp3Scripts = null;
  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = fail;
      document.head.append(s);
    });
  }
  // Resolves a worker that has loaded lamejs, or null.
  function mp3Worker(sampleRate) {
    return new Promise((resolve) => {
      let w = null, t = 0;
      const fail = () => { clearTimeout(t); if (w) w.terminate(); resolve(null); };
      try { w = new Worker("mp3.js"); } catch (err) { resolve(null); return; }
      t = setTimeout(fail, 5000);
      w.onerror = fail;
      w.onmessage = (e) => {
        if (!e.data.ready) return;
        clearTimeout(t);
        w.onerror = null;
        resolve(w);
      };
      w.postMessage({ init: { sampleRate, kbps: MP3_KBPS } });
    });
  }
  // Resolves { push(L, R), end() -> Promise<Blob>, cancel() };
  // rejects when lamejs cannot load at all.
  async function mp3Encoder(sampleRate) {
    const w = await mp3Worker(sampleRate);
    if (w) {
      return {
        push: (l, r) => w.postMessage({ L: l, R: r }, [l.buffer, r.buffer]),
        end: () => new Promise((resolve, reject) => {
          w.onmessage = (e) => { if (e.data.blob) { w.terminate(); resolve(e.data.blob); } };
          w.onerror = () => { w.terminate(); reject(new Error("mp3 worker failed")); };
          w.postMessage({ end: 1 });
        }),
        cancel: () => w.terminate(),
      };
    }
    if (!mp3Scripts) mp3Scripts = loadScript("lame.min.js").then(() => loadScript("mp3.js"));
    try { await mp3Scripts; } catch (err) { mp3Scripts = null; throw err; }
    const s = new window.Mp3Stream(sampleRate, MP3_KBPS);
    return { push: (l, r) => s.push(l, r), end: async () => s.end(), cancel: () => {} };
  }

  // Stereo WAV, 24-bit PCM.
  function encodeWav({ chunks, frames, sampleRate }) {
    const bytes = 3, chs = 2, dataLen = frames * chs * bytes;
    const buf = new ArrayBuffer(44 + dataLen), v = new DataView(buf), u8 = new Uint8Array(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, chs, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * chs * bytes, true);
    v.setUint16(32, chs * bytes, true); v.setUint16(34, 8 * bytes, true);
    str(36, "data"); v.setUint32(40, dataLen, true);
    let o = 44;
    const put = (x) => {
      let s = Math.round((x > 1 ? 1 : x < -1 ? -1 : x) * 8388607);
      if (s < 0) s += 16777216;
      u8[o] = s & 255; u8[o + 1] = (s >> 8) & 255; u8[o + 2] = (s >> 16) & 255;
      o += 3;
    };
    for (const c of chunks) for (let i = 0; i < c.L.length; i++) { put(c.L[i]); put(c.R[i]); }
    return new Blob([buf], { type: "audio/wav" });
  }

  // One file inside a .zip (no compression), for the Claude page, which
  // accepts .zip downloads but not .wav.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function zipOne(name, blob) {
    const data = new Uint8Array(await blob.arrayBuffer()), nm = new TextEncoder().encode(name);
    const crc = crc32(data), d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nm.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(12, time, true); cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, nm.length, true);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
    end.setUint32(12, 46 + nm.length, true); end.setUint32(16, 30 + nm.length + data.length, true);
    return new Blob([lh, nm, data, cd, nm, end], { type: "application/zip" });
  }

  // Save a file: normal download, or through the Claude page (as .zip).
  // Inside Claude, files are offered through the "downloads" capability
  // (asked once at startup, so a click does not wait for it).
  const NO_DOWNLOADS = "Qui non si possono scaricare file: usa la versione pubblicata su GitHub.";
  const downloadsReady = window.claude
    ? Promise.resolve().then(() => window.claude.use("downloads")).catch(() => null)
    : Promise.resolve(null);
  async function saveFile(name, blob, okMsg) {
    if (window.claude) {
      const dl = await downloadsReady;
      if (!dl) { log(NO_DOWNLOADS); return; }
      try {
        await dl.save({ filename: name.replace(/\.\w+$/, "") + ".zip", data: await zipOne(name, blob) });
        log(okMsg + " Dentro Claude il file arriva in un .zip.");
      } catch (err) {
        const code = err && err.code;
        if (code === "declined") log("Salvataggio annullato.");
        else if (code === "rate_limited") log("Salvataggio non riuscito: c'è già una richiesta aperta.");
        else if (code === "bad_request" || code === "too_large") log("Salvataggio non riuscito.");
        else log(NO_DOWNLOADS);
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    log(okMsg);
  }

  // ------------------------------------------------------------ geometry
  // Position and size of a box in the current view.
  const rectOf = (e) => (presenting && e.box.presentation && e.box.presentation_rect
    ? e.box.presentation_rect : e.box.patching_rect);
  // In presentation only the boxes added to it are shown.
  const visible = (e) => !presenting || !!e.box.presentation;
  function ioX(rect, k, n) { return rect[0] + (n > 1 ? k * (rect[2] - IOW) / (n - 1) : 0) + IOW / 2; }
  function contentSize() {
    let w = 400, h = 300;
    for (const e of patch.entries.values()) {
      if (!visible(e)) continue;
      const r = rectOf(e);
      w = Math.max(w, r[0] + r[2] + 60);
      h = Math.max(h, r[1] + r[3] + 60);
    }
    return [w, h];
  }
  function applyZoom() {
    const [w, h] = contentSize();
    const vw = stage.clientWidth / zoom, vh = stage.clientHeight / zoom;
    const W = Math.max(w, vw), H = Math.max(h, vh);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    canvas.style.transform = `scale(${zoom})`;
    sizer.style.width = W * zoom + "px";
    sizer.style.height = H * zoom + "px";
    cordsSvg.setAttribute("width", W);
    cordsSvg.setAttribute("height", H);
  }
  function setZoom(z, keepCenter) {
    const cx = (stage.scrollLeft + stage.clientWidth / 2) / zoom;
    const cy = (stage.scrollTop + stage.clientHeight / 2) / zoom;
    zoom = Math.min(3, Math.max(0.25, z));
    applyZoom();
    if (keepCenter) {
      stage.scrollLeft = cx * zoom - stage.clientWidth / 2;
      stage.scrollTop = cy * zoom - stage.clientHeight / 2;
    }
  }
  function fitZoom() {
    let x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0;
    for (const e of patch.entries.values()) {
      if (!visible(e)) continue;
      const r = rectOf(e);
      x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]);
      x1 = Math.max(x1, r[0] + r[2]); y1 = Math.max(y1, r[1] + r[3]);
    }
    if (!isFinite(x0)) { setZoom(1); return; }
    const z = Math.min(stage.clientWidth / (x1 + 20), stage.clientHeight / (y1 + 20), 1.5);
    setZoom(z);
    stage.scrollLeft = 0; stage.scrollTop = 0;
  }
  function toPatch(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / zoom, y: (ev.clientY - r.top) / zoom };
  }

  // ------------------------------------------------------------ text measuring
  const meas = document.createElement("canvas").getContext("2d");
  function textW(t, size) { meas.font = `${size || 12}px Arimo, Arial, "Liberation Sans", sans-serif`; return meas.measureText(t).width; }
  function fitWidth(e) {
    const b = e.box, r = b.patching_rect;
    if (b.maxclass === "newobj") r[2] = Math.max(32, Math.ceil(textW(b.text || "") + 14));
    else if (b.maxclass === "message") r[2] = Math.max(30, Math.ceil(textW(b.text || "") + 18));
    else if (b.maxclass === "comment") {
      const size = b.fontsize || 12;
      const lines = String(b.text || "").split("\n");
      const w = Math.max(...lines.map((l) => textW(l, size))) + 10;
      if (!b.linecount || b.linecount <= 1) r[2] = Math.max(r[2] || 0, Math.ceil(w));
    }
  }

  // ------------------------------------------------------------ rendering
  function rgba(c) {
    if (!Array.isArray(c)) return "rgba(200,200,200,0.5)";
    const [r, g, b, a] = c;
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a === undefined ? 1 : a})`;
  }

  function kindOf(b) {
    if (b.maxclass === "newobj") return "k-obj";
    if (b.maxclass === "message") return "k-msg";
    if (b.maxclass === "comment") return "k-comment";
    if (b.maxclass === "panel") return "k-panel";
    return "k-gui";
  }

  function renderBox(e) {
    const b = e.box, inst = e.inst, r = rectOf(e);
    let el = els.get(b.id);
    if (el) el.remove();
    if (!visible(e)) { els.delete(b.id); return; }
    el = document.createElement("div");
    el.dataset.id = b.id;
    el.className = `box ${kindOf(b)} mc-${b.maxclass}` + (inst.bad ? " bad" : "") + (selection.has(b.id) ? " sel" : "");
    if (b.maxclass === "newobj" && !String(b.text || "").trim()) el.classList.add("empty");
    if (b.maxclass === "newobj" || b.maxclass === "message") {
      const need = Math.ceil(textW(b.text || "") + (b.maxclass === "message" ? 18 : 14));
      if (r[2] < need) r[2] = need;
    }
    Object.assign(el.style, { left: r[0] + "px", top: r[1] + "px", width: r[2] + "px", height: r[3] + "px" });
    if (b.maxclass === "newobj" || b.maxclass === "message") {
      const s = document.createElement("span");
      s.textContent = b.text || "";
      el.append(s);
    } else if (b.maxclass === "comment") {
      el.textContent = String(b.text || "").replace(/^\s+|\s+$/g, "");
      el.style.fontSize = (b.fontsize || 12) + "px";
      el.style.textAlign = ["left", "center", "right"][b.textjustification || 0] || "left";
      el.style.height = "auto";
      el.style.minHeight = r[3] + "px";
    } else if (b.maxclass === "panel") {
      el.style.background = rgba(b.bgcolor);
      const h = document.createElement("div");
      h.className = "rsz";
      el.append(h);
    } else {
      inst.build(el);
    }
    const n = inst.nin, outs = inst.outTypes;
    for (let k = 0; k < n; k++) {
      const d = document.createElement("div");
      d.className = "inlet" + (k === 0 ? " hot" : "");
      d.style.left = (n > 1 ? k * (r[2] - IOW) / (n - 1) : 0) + "px";
      el.append(d);
    }
    outs.forEach((t, k) => {
      const d = document.createElement("div");
      d.className = "outlet" + (t === "signal" ? " sig" : "");
      d.dataset.o = k;
      d.style.left = (outs.length > 1 ? k * (r[2] - IOW) / (outs.length - 1) : 0) + "px";
      el.append(d);
    });
    canvas.append(el);
    els.set(b.id, el);
  }

  function cordPath(x1, y1, x2, y2) {
    const dy = y2 - y1;
    const k = dy > 0 ? Math.min(80, Math.max(12, dy * 0.45)) : Math.min(120, 30 + Math.abs(dy) * 0.3);
    return `M${x1},${y1} C${x1},${y1 + k} ${x2},${y2 - k} ${x2},${y2}`;
  }

  function cordEnds(l) {
    const s = patch.entries.get(l.src[0]), d = patch.entries.get(l.dst[0]);
    if (!s || !d) return null;
    const rs = rectOf(s), rd = rectOf(d);
    const so = s.inst.outTypes.length, di = d.inst.nin;
    const x1 = ioX(rs, l.src[1], so), x2 = ioX(rd, l.dst[1], di);
    const el = els.get(s.box.id);
    const h = s.box.maxclass === "comment" && el ? el.offsetHeight : rs[3];
    return [x1, rs[1] + h, x2, rd[1]];
  }

  function renderCords() {
    while (cordsSvg.firstChild) cordsSvg.firstChild.remove();
    if (presenting) return;
    for (const l of patch.lines) {
      const ends = cordEnds(l);
      if (!ends) continue;
      const d = cordPath(...ends);
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", "cord" + (l === selCord ? " sel" : ""));
      const s = patch.entries.get(l.src[0]);
      const sig = s.inst.outTypes[l.src[1]] === "signal";
      if (sig) {
        g.append(mkPath(d, "cord-sig-base"), mkPath(d, "cord-sig-dash"));
      } else {
        g.append(mkPath(d, "cord-ctl"));
      }
      const hit = mkPath(d, "cord-hit");
      hit.__line = l;
      g.append(hit);
      cordsSvg.append(g);
    }
  }
  function mkPath(d, cls) { const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", d); p.setAttribute("class", cls); return p; }

  function renderAll() {
    for (const el of els.values()) el.remove();
    els.clear();
    const order = [...patch.entries.values()].sort((a, b) => (a.box.maxclass === "panel" ? 0 : 1) - (b.box.maxclass === "panel" ? 0 : 1));
    for (const e of order) renderBox(e);
    applyZoom();
    renderCords();
  }

  // ------------------------------------------------------------ undo / autosave
  function snapshot() { return JSON.stringify(patch.toJSON()); }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(json) {
    selection.clear(); selCord = null;
    patch.load(JSON.parse(json));
    renderAll();
    scheduleAutosave();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); log("Annullato."); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }
  let autosaveTimer = null;
  // edited: the open patch was changed since it was opened (a patch opened
  // from a link must not erase changes the student has not saved)
  let edited = false;
  function scheduleAutosave(opened) {
    if (!opened) edited = true;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => store.set(KEY_CURRENT, { name: patchName, json: patch.toJSON(), edited }), 400);
  }

  // ------------------------------------------------------------ open patches
  // what to do with the example patch, shown when it opens
  const EXAMPLE_HINT = "Pronto. Premi Audio, poi clicca il messaggio 1. Per l'aiuto premi ?";
  function openPatch(json, name) {
    if (!json || !json.patcher) { log("Questo non sembra il testo di una patch .maxpat."); return false; }
    selection.clear(); selCord = null;
    undoStack.length = 0; redoStack.length = 0;
    patch.load(json);
    patchName = name || "senza titolo";
    log(`Aperta la patch \u201c${patchName}\u201d.`);
    for (const e of patch.entries.values()) if (e.inst.bad) log(`${String(e.box.text || e.box.maxclass).split(" ")[0]}: oggetto non disponibile qui`);
    $("#name").textContent = patchName;
    setPresenting(!!(json.patcher.openinpresentation), true);
    renderAll();
    fitZoom();
    edited = false;
    scheduleAutosave(true);
    return true;
  }

  // ------------------------------------------------------------ selection
  function setSelection(ids) {
    selection = new Set(ids);
    for (const [id, el] of els) el.classList.toggle("sel", selection.has(id));
    showPresentButton();
    if (selection.size) { selCord = null; renderCords(); }
  }
  function selectCord(l) { selCord = l; setSelection([]); renderCords(); }

  // ------------------------------------------------------------ lock
  function setLocked(v) {
    locked = v;
    document.body.classList.toggle("editing", !locked);
    $("#lock").classList.toggle("on", !locked);
    $("#lock-label").textContent = locked ? "Bloccata" : "Modifica";
    $("#lock-shackle").setAttribute("d", locked ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.5-2");
    if (locked) { commitEdit(); setSelection([]); selCord = null; renderCords(); marker.classList.remove("show"); }
  }
  $("#lock").addEventListener("click", () => setLocked(!locked));

  // ------------------------------------------------------------ text editing
  let editing = null; // { entry, input, isNew }
  function hasText(e) { return ["newobj", "message", "comment"].includes(e.box.maxclass); }
  function editText(e, isNew) {
    commitEdit();
    const r = rectOf(e);
    const input = document.createElement("input");
    input.id = "editor";
    input.type = "text";
    input.autocomplete = "off";
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.spellcheck = false;
    if (e.box.maxclass === "newobj") input.setAttribute("list", "objnames");
    input.value = e.box.text || "";
    // Readable at any zoom: the field sits over the box but keeps a 16px font
    // (smaller fonts make phones zoom the page when the field gets focus).
    Object.assign(input.style, {
      left: r[0] * zoom + "px", top: r[1] * zoom + "px",
      width: Math.max(r[2] * zoom, 180) + "px", height: "32px",
    });
    stage.append(input);
    editing = { entry: e, input, isNew };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); commitEdit(); }
      else if (ev.key === "Escape") { ev.preventDefault(); cancelEdit(); }
      ev.stopPropagation();
    });
    input.focus();
    input.select();
  }
  function cancelEdit() {
    if (!editing) return;
    const { entry, input, isNew } = editing;
    editing = null;
    input.remove();
    if (isNew) { patch.removeBox(entry.box.id); els.get(entry.box.id)?.remove(); els.delete(entry.box.id); undoStack.pop(); renderCords(); }
  }
  function commitEdit() {
    if (!editing) return;
    const { entry, input, isNew } = editing;
    editing = null;
    const text = input.value.trim();
    input.remove();
    const b = entry.box;
    if (!text) {
      if (isNew || b.maxclass !== "comment") {
        patch.removeBox(b.id); els.get(b.id)?.remove(); els.delete(b.id);
        renderCords(); applyZoom(); scheduleAutosave();
        return;
      }
    }
    if (!isNew) pushUndo();
    const word = String(parseAtoms(text)[0] || "");
    if (b.maxclass === "newobj" && GUI[word]) {
      const g = GUI[word];
      delete b.text;
      b.maxclass = word;
      b.patching_rect = [b.patching_rect[0], b.patching_rect[1], g.size[0], g.size[1]];
      if (b.presentation_rect) b.presentation_rect = [b.presentation_rect[0], b.presentation_rect[1], g.size[0], g.size[1]];
      b.numinlets = g.io[0]; b.numoutlets = g.io[1].length; b.outlettype = g.io[1].slice();
      Object.assign(b, JSON.parse(JSON.stringify(g.extra)));
      // attributes typed after the name, as in Max: live.gain~ @channels 1
      const atoms = parseAtoms(text).slice(1);
      const isAt = (x) => typeof x === "string" && x[0] === "@" && x.length > 1;
      for (let k = 0; k < atoms.length; k++) {
        if (!isAt(atoms[k])) continue;
        const key = atoms[k].slice(1), vals = [];
        while (k + 1 < atoms.length && !isAt(atoms[k + 1])) vals.push(atoms[++k]);
        if (vals.length && key !== "id" && key !== "maxclass") b[key] = vals.length === 1 ? vals[0] : vals;
      }
    } else {
      b.text = text;
      fitWidth(entry);
    }
    patch.rebuild(b.id);
    if (patch.entries.get(b.id).inst.bad && b.maxclass === "newobj") log(`${word}: oggetto non disponibile qui (vedi ? per l'elenco)`);
    renderBox(patch.entries.get(b.id));
    renderCords();
    applyZoom();
    scheduleAutosave();
  }

  // ------------------------------------------------------------ creating boxes
  function visibleCenter() {
    return { x: (stage.scrollLeft + stage.clientWidth / 2) / zoom - 30, y: (stage.scrollTop + stage.clientHeight / 2) / zoom - 11 };
  }
  function newBox(kind, pt) {
    if (locked) setLocked(false);
    pt = pt || insertion || visibleCenter();
    const x = Math.round(pt.x), y = Math.round(pt.y);
    pushUndo();
    let box;
    if (kind === "newobj") box = { maxclass: "newobj", text: "", numinlets: 1, numoutlets: 0, outlettype: [], patching_rect: [x, y, 60, 22] };
    else if (kind === "message") box = { maxclass: "message", text: "", numinlets: 2, numoutlets: 1, outlettype: [""], patching_rect: [x, y, 50, 22] };
    else if (kind === "comment") box = { maxclass: "comment", text: "", numinlets: 1, numoutlets: 0, patching_rect: [x, y, 150, 20] };
    else {
      const g = GUI[kind];
      box = Object.assign({ maxclass: kind, numinlets: g.io[0], numoutlets: g.io[1].length, outlettype: g.io[1].slice(), patching_rect: [x, y, g.size[0], g.size[1]] }, JSON.parse(JSON.stringify(g.extra)));
    }
    if (presenting) { box.presentation = 1; box.presentation_rect = box.patching_rect.slice(); }
    const e = patch.addBox(box, true);
    e.fresh = true;
    renderBox(e);
    applyZoom();
    setSelection([box.id]);
    if (hasText(e)) editText(e, true);
    else scheduleAutosave();
    insertion = { x: x, y: y + 40 };
    placeMarker();
    return e;
  }
  document.querySelectorAll("[data-new]").forEach((b) => b.addEventListener("click", () => newBox(b.dataset.new)));
  function placeMarker() {
    if (!insertion) { marker.classList.remove("show"); return; }
    marker.style.left = insertion.x + "px";
    marker.style.top = insertion.y + "px";
    marker.classList.add("show");
  }

  // ------------------------------------------------------------ delete / duplicate / clipboard
  function deleteSelection() {
    if (!selection.size && !selCord) return;
    pushUndo();
    if (selCord) { patch.disconnect(selCord); selCord = null; }
    for (const id of selection) { patch.removeBox(id); els.get(id)?.remove(); els.delete(id); }
    selection.clear();
    renderCords(); applyZoom(); scheduleAutosave();
  }
  let clip = null;
  function copySelection() {
    if (!selection.size) return;
    const boxes = [...selection].map((id) => JSON.parse(JSON.stringify(patch.entries.get(id).box)));
    const lines = patch.lines.filter((l) => selection.has(l.src[0]) && selection.has(l.dst[0])).map((l) => ({ src: l.src.slice(), dst: l.dst.slice() }));
    clip = { boxes, lines };
  }
  function paste(offset) {
    if (!clip) return;
    pushUndo();
    const map = {};
    const ids = [];
    for (const b0 of clip.boxes) {
      const b = JSON.parse(JSON.stringify(b0));
      const old = b.id;
      delete b.id;
      b.patching_rect[0] += offset; b.patching_rect[1] += offset;
      if (b.presentation_rect) { b.presentation_rect[0] += offset; b.presentation_rect[1] += offset; }
      const e = patch.addBox(b, true);
      map[old] = e.box.id;
      ids.push(e.box.id);
      renderBox(e);
    }
    for (const l of clip.lines) patch.connect(map[l.src[0]], l.src[1], map[l.dst[0]], l.dst[1], {}, true);
    clip.boxes.forEach((b) => {
      b.patching_rect[0] += offset; b.patching_rect[1] += offset;
      if (b.presentation_rect) { b.presentation_rect[0] += offset; b.presentation_rect[1] += offset; }
    });
    setSelection(ids);
    renderCords(); applyZoom(); scheduleAutosave();
  }
  $("#del").addEventListener("click", deleteSelection);
  $("#dup").addEventListener("click", () => { copySelection(); paste(20); });
  $("#undo").addEventListener("click", undo);

  // ------------------------------------------------------------ pointer handling
  let lastTap = { t: 0, id: null, x: 0, y: 0 };
  function isDoubleTap(ev, id) {
    const now = performance.now();
    const dbl = now - lastTap.t < 380 && lastTap.id === id && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 14;
    lastTap = dbl ? { t: 0, id: null, x: 0, y: 0 } : { t: now, id, x: ev.clientX, y: ev.clientY };
    return dbl;
  }

  let drag = null; // { move(ev, pt), up(ev, pt) }
  function startDrag(ev, handler) {
    drag = handler;
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
  }
  canvas.addEventListener("pointermove", (ev) => { if (drag && drag.move) { ev.preventDefault(); drag.move(ev, toPatch(ev)); } });
  function endDrag(ev) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.up) d.up(ev, toPatch(ev));
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", (ev) => { if (drag && drag.cancel) drag.cancel(); drag = null; });

  function nearestInlet(pt, fromId) {
    let best = null, bestD = 22 / Math.min(1, zoom);
    for (const e of patch.entries.values()) {
      if (e.box.id === fromId) continue;
      const r = rectOf(e), n = e.inst.nin;
      const inside = pt.x >= r[0] - 4 && pt.x <= r[0] + r[2] + 4 && pt.y >= r[1] - 14 && pt.y <= r[1] + r[3] + 4;
      for (let k = 0; k < n; k++) {
        const x = ioX(r, k, n);
        const d = inside ? Math.abs(pt.x - x) : Math.hypot(pt.x - x, pt.y - r[1]);
        if (d < bestD) { bestD = d; best = [e.box.id, k]; }
      }
    }
    return best;
  }

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button > 0) return;
    if (editing && ev.target === editing.input) return;
    if (editing) commitEdit();
    if (numEdit) closeNumber(true);
    const pt = toPatch(ev);
    const boxEl = ev.target.closest(".box");
    const outEl = ev.target.closest(".outlet");
    const hit = ev.target.closest(".cord-hit");
    const operate = locked || ev.metaKey || ev.ctrlKey;

    if (boxEl) {
      const id = boxEl.dataset.id;
      const e = patch.entries.get(id);
      if (!e) return;
      if (operate && !outEl) {
        ev.preventDefault();
        const h = e.inst.press(ev, pt);
        if (h) startDrag(ev, h);
        return;
      }
      if (locked) return;
      ev.preventDefault();
      if (outEl) { startCord(ev, id, Number(outEl.dataset.o)); return; }
      if (ev.target.closest(".rsz")) { startResize(ev, id, pt); return; }
      const dbl = isDoubleTap(ev, id);
      // a panel is background: a tap inside it also sets where new objects go
      if (e.box.maxclass === "panel") {
        insertion = { x: Math.round(pt.x), y: Math.round(pt.y) };
        placeMarker();
        if (dbl) { newBox("newobj", insertion); return; }
      }
      if (dbl && hasText(e)) { editText(e, false); return; }
      if (ev.shiftKey) {
        const s = new Set(selection);
        if (s.has(id)) s.delete(id); else s.add(id);
        setSelection([...s]);
      } else if (!selection.has(id)) setSelection([id]);
      startMove(ev, pt);
      return;
    }
    if (hit && !locked) { ev.preventDefault(); selectCord(hit.__line); return; }
    if (locked) { if (ev.pointerType !== "mouse") startPan(ev); return; }
    setSelection([]);
    if (selCord) { selCord = null; renderCords(); }
    insertion = { x: Math.round(pt.x), y: Math.round(pt.y) };
    placeMarker();
    if (isDoubleTap(ev, "__bg")) { ev.preventDefault(); newBox("newobj", insertion); return; }
    if (ev.pointerType === "mouse") startRubber(ev, pt);
    else startPan(ev);
  });

  // ------------------------------------------------------------ touch: pan with one finger, pinch with two
  function startPan(ev) {
    const sx = stage.scrollLeft, sy = stage.scrollTop, x0 = ev.clientX, y0 = ev.clientY;
    startDrag(ev, {
      move(e2) {
        stage.scrollLeft = sx - (e2.clientX - x0);
        stage.scrollTop = sy - (e2.clientY - y0);
      },
    });
  }
  const touches = new Map();
  let pinch = null;
  function pinchState() {
    const [a, b] = [...touches.values()];
    return { mid: { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  stage.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "touch") return;
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touches.size !== 2) return;
    // second finger: stop whatever the first finger was doing and start pinching
    ev.stopPropagation();
    ev.preventDefault();
    if (drag && drag.cancel) drag.cancel();
    drag = null;
    if (editing) commitEdit();
    const st = pinchState();
    pinch = { d0: Math.max(10, st.dist), z0: zoom, p: toPatch(st.mid) };
  }, true);
  stage.addEventListener("pointermove", (ev) => {
    if (!touches.has(ev.pointerId)) return;
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (!pinch || touches.size < 2) return;
    ev.stopPropagation();
    ev.preventDefault();
    const st = pinchState();
    zoom = Math.min(3, Math.max(0.25, pinch.z0 * st.dist / pinch.d0));
    applyZoom();
    const sr = stage.getBoundingClientRect();
    stage.scrollLeft = pinch.p.x * zoom - (st.mid.clientX - sr.left);
    stage.scrollTop = pinch.p.y * zoom - (st.mid.clientY - sr.top);
  }, true);
  const lift = (ev) => { touches.delete(ev.pointerId); if (touches.size < 2) pinch = null; };
  stage.addEventListener("pointerup", lift, true);
  stage.addEventListener("pointercancel", lift, true);

  function startMove(ev, pt0) {
    let moved = false;
    const start = [...selection].map((id) => [id, rectOf(patch.entries.get(id)).slice(0, 2)]);
    startDrag(ev, {
      move(e2, pt) {
        const dx = Math.round(pt.x - pt0.x), dy = Math.round(pt.y - pt0.y);
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        if (!moved) { pushUndo(); moved = true; }
        for (const [id, [x, y]] of start) {
          const r = rectOf(patch.entries.get(id));
          r[0] = Math.max(0, x + dx); r[1] = Math.max(0, y + dy);
          const el = els.get(id);
          el.style.left = r[0] + "px"; el.style.top = r[1] + "px";
        }
        renderCords();
      },
      up() { if (moved) { applyZoom(); scheduleAutosave(); } },
    });
  }

  // Drag the corner handle of a selected panel to change its size.
  function startResize(ev, id, pt0) {
    const e = patch.entries.get(id), r = rectOf(e), el = els.get(id);
    const w0 = r[2], h0 = r[3];
    let moved = false;
    startDrag(ev, {
      move(e2, pt) {
        const dw = Math.round(pt.x - pt0.x), dh = Math.round(pt.y - pt0.y);
        if (!moved && Math.abs(dw) + Math.abs(dh) < 2) return;
        if (!moved) { pushUndo(); moved = true; }
        r[2] = Math.max(16, w0 + dw); r[3] = Math.max(16, h0 + dh);
        el.style.width = r[2] + "px"; el.style.height = r[3] + "px";
        renderCords();
      },
      up() { if (moved) { applyZoom(); scheduleAutosave(); } },
    });
  }

  function startCord(ev, id, o) {
    const s = patch.entries.get(id);
    const r = rectOf(s);
    const x1 = ioX(r, o, s.inst.outTypes.length);
    const y1 = r[1] + r[3];
    const temp = mkPath("", "cord-temp");
    cordsSvg.append(temp);
    startDrag(ev, {
      move(e2, pt) { temp.setAttribute("d", cordPath(x1, y1, pt.x, pt.y)); },
      up(e2, pt) {
        temp.remove();
        const t = nearestInlet(pt, id);
        if (!t) return;
        if (!patch.canConnect(id, o, t[0], t[1])) {
          const sig = s.inst.outTypes[o] === "signal";
          if (sig) log("Un cavo audio va solo in un ingresso che accetta segnale audio.");
          else if (s.inst.outTypes[o] === "tapconnect") log("L'uscita di tapin~ va solo nell'ingresso sinistro di tapout~.");
          return;
        }
        pushUndo();
        patch.connect(id, o, t[0], t[1], {}, true);
        renderCords();
        scheduleAutosave();
      },
      cancel() { temp.remove(); },
    });
  }

  function startRubber(ev, p0) {
    rubber.style.display = "block";
    const set = (p) => {
      const x = Math.min(p0.x, p.x), y = Math.min(p0.y, p.y), w = Math.abs(p.x - p0.x), h = Math.abs(p.y - p0.y);
      Object.assign(rubber.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
      return [x, y, w, h];
    };
    set(p0);
    startDrag(ev, {
      move(e2, p) {
        const [x, y, w, h] = set(p);
        if (w + h < 4) return;
        const ids = [];
        for (const e of patch.entries.values()) {
          if (!visible(e)) continue;
          const r = rectOf(e);
          if (r[0] < x + w && r[0] + r[2] > x && r[1] < y + h && r[1] + r[3] > y) ids.push(e.box.id);
        }
        setSelection(ids);
      },
      up() { rubber.style.display = "none"; },
      cancel() { rubber.style.display = "none"; },
    });
  }

  // ------------------------------------------------------------ typing a value into a number box
  // (locked patch: tap the box, type, Enter; tapping elsewhere also sends it)
  let numEdit = null;
  function askNumber(inst, cb) {
    closeNumber(false);
    const e = patch.entries.get(inst.box.id);
    if (!e) return;
    const r = rectOf(e);
    const input = document.createElement("input");
    input.className = "numedit";
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = inst.text ? inst.text() : "";
    Object.assign(input.style, {
      left: r[0] * zoom + "px", top: r[1] * zoom + "px",
      width: Math.max(r[2] * zoom, 90) + "px", height: "32px",
    });
    stage.append(input);
    numEdit = { input, cb };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); closeNumber(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); closeNumber(false); }
      ev.stopPropagation();
    });
    input.addEventListener("blur", () => closeNumber(true));
    input.focus();
  }
  function closeNumber(apply) {
    if (!numEdit) return;
    const { input, cb } = numEdit;
    numEdit = null;
    const text = input.value.trim().replace(",", ".");
    input.remove();
    const v = Number(text);
    if (apply && text !== "" && Number.isFinite(v)) cb(v);
  }

  // ------------------------------------------------------------ presentation
  function setPresenting(v, quiet) {
    presenting = !!v;
    patch.presenting = presenting;
    document.body.classList.toggle("presenting", presenting);
    $("#present").classList.toggle("on", presenting);
    if (quiet) return; // openPatch redraws by itself
    commitEdit();
    selCord = null;
    insertion = null;
    marker.classList.remove("show");
    setSelection([]);
    renderAll();
    fitZoom();
    if (presenting && ![...patch.entries.values()].some(visible)) {
      log("Nessun oggetto in presentazione: sblocca, seleziona gli oggetti e premi \u201c+ Presentazione\u201d.");
    }
  }
  $("#present").addEventListener("click", () => setPresenting(!presenting));

  // Selected boxes in or out of the presentation (Max: Cmd+Shift+P).
  function selectedBoxes() { return [...selection].map((id) => patch.entries.get(id).box); }
  function showPresentButton() {
    const bs = selectedBoxes();
    const out = bs.length && bs.every((b) => b.presentation);
    $("#to-present").textContent = out ? "\u2212 Presentazione" : "+ Presentazione";
  }
  function togglePresentation() {
    const bs = selectedBoxes();
    if (!bs.length) { log("Seleziona prima gli oggetti da mettere o togliere dalla presentazione."); return; }
    pushUndo();
    const add = bs.some((b) => !b.presentation);
    for (const b of bs) {
      if (add) {
        b.presentation = 1;
        if (!b.presentation_rect) b.presentation_rect = b.patching_rect.slice();
      } else b.presentation = 0;
    }
    if (!add && presenting) selection.clear();
    renderAll();
    showPresentButton();
    scheduleAutosave();
    log(add ? "Aggiunti alla presentazione." : "Tolti dalla presentazione.");
  }
  $("#to-present").addEventListener("click", togglePresentation);

  // ------------------------------------------------------------ keyboard
  document.addEventListener("keydown", (ev) => {
    const tag = (ev.target && ev.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const mod = ev.metaKey || ev.ctrlKey;
    const k = ev.key.toLowerCase();
    if (mod && ev.altKey && ev.code === "KeyE") { ev.preventDefault(); setPresenting(!presenting); return; }
    if (mod && k === "e") { ev.preventDefault(); setLocked(!locked); return; }
    if (mod && ev.shiftKey && ev.code === "KeyP" && !locked) { ev.preventDefault(); togglePresentation(); return; }
    if (mod && k === "z") { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
    if (!$("#filedlg").hidden || !$("#helpdlg").hidden || !$("#audiodlg").hidden) { if (k === "escape") closeDialogs(); return; }
    if (locked) return;
    if (mod && k === "d") { ev.preventDefault(); copySelection(); paste(20); return; }
    if (mod && k === "c") { copySelection(); return; }
    if (mod && k === "v") { ev.preventDefault(); paste(20); return; }
    if (mod && k === "a") { ev.preventDefault(); setSelection([...patch.entries.keys()]); return; }
    if (k === "backspace" || k === "delete") { ev.preventDefault(); deleteSelection(); return; }
    if (mod || ev.altKey) return;
    const shortcuts = { n: "newobj", m: "message", c: "comment", i: "number", f: "flonum", b: "button", t: "toggle" };
    if (shortcuts[k]) { ev.preventDefault(); newBox(shortcuts[k]); return; }
    const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
    if (arrows[k] && selection.size) {
      ev.preventDefault();
      pushUndo();
      const step = ev.shiftKey ? 10 : 1;
      for (const id of selection) {
        const r = rectOf(patch.entries.get(id));
        r[0] = Math.max(0, r[0] + arrows[k][0] * step); r[1] = Math.max(0, r[1] + arrows[k][1] * step);
        const el = els.get(id); el.style.left = r[0] + "px"; el.style.top = r[1] + "px";
      }
      renderCords(); scheduleAutosave();
    }
  });

  // ------------------------------------------------------------ zoom controls
  $("#zoom-in").addEventListener("click", () => setZoom(zoom * 1.25, true));
  $("#zoom-out").addEventListener("click", () => setZoom(zoom / 1.25, true));
  $("#zoom-fit").addEventListener("click", fitZoom);
  stage.addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    setZoom(zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1), true);
  }, { passive: false });
  window.addEventListener("resize", applyZoom);

  // ------------------------------------------------------------ dialogs
  function closeDialogs() { $("#filedlg").hidden = true; $("#helpdlg").hidden = true; $("#audiodlg").hidden = true; }
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeDialogs));
  document.querySelectorAll(".dlg").forEach((d) => d.addEventListener("click", (ev) => { if (ev.target === d) closeDialogs(); }));
  $("#help").addEventListener("click", () => { $("#helpdlg").hidden = false; });

  function fileMsg(t) { $("#f-msg").textContent = t; }
  function refreshFiles() {
    const files = store.get(KEY_FILES, {});
    const list = $("#f-list");
    list.innerHTML = "";
    const names = Object.keys(files).sort((a, b) => a.localeCompare(b));
    if (!names.length) {
      const li = document.createElement("li");
      li.innerHTML = '<span class="note">Nessuna patch salvata in questo browser.</span>';
      list.append(li);
    }
    for (const n of names) {
      const li = document.createElement("li");
      const s = document.createElement("span"); s.textContent = n;
      const row = document.createElement("div"); row.className = "row";
      const open = document.createElement("button"); open.className = "btn"; open.textContent = "Apri";
      open.addEventListener("click", () => { openPatch(files[n], n); closeDialogs(); });
      const del = document.createElement("button"); del.className = "btn danger"; del.textContent = "Elimina";
      let armed = false;
      del.addEventListener("click", () => {
        if (!armed) { armed = true; del.textContent = "Conferma"; setTimeout(() => { armed = false; del.textContent = "Elimina"; }, 3000); return; }
        const f = store.get(KEY_FILES, {}); delete f[n]; store.set(KEY_FILES, f); refreshFiles();
      });
      row.append(open, del);
      li.append(s, row);
      list.append(li);
    }
  }
  $("#f-openpres").addEventListener("change", (ev) => {
    patch.header.openinpresentation = ev.target.checked ? 1 : 0;
    scheduleAutosave();
  });
  $("#file").addEventListener("click", () => { $("#f-openpres").checked = !!patch.header.openinpresentation; $("#f-name").value = patchName; fileMsg(""); refreshFiles(); $("#filedlg").hidden = false; });
  $("#f-new").addEventListener("click", () => { openPatch({ patcher: { boxes: [], lines: [] } }, "nuova patch"); setLocked(false); closeDialogs(); });
  $("#f-example").addEventListener("click", () => { openPatch(window.EXAMPLE_PATCH, "simple_monoSynth"); setLocked(true); closeDialogs(); log(EXAMPLE_HINT); });
  $("#f-save").addEventListener("click", () => {
    const n = $("#f-name").value.trim();
    if (!n) { fileMsg("Scrivi un nome per la patch."); return; }
    const f = store.get(KEY_FILES, {});
    f[n] = patch.toJSON();
    if (store.set(KEY_FILES, f)) { patchName = n; $("#name").textContent = n; scheduleAutosave(); fileMsg(`Salvata come “${n}”.`); refreshFiles(); }
    else fileMsg("Questo browser non permette di salvare (navigazione privata?). Usa “Copia il testo della patch”.");
  });
  $("#f-copy").addEventListener("click", () => {
    const text = JSON.stringify(patch.toJSON(), null, 1);
    const fallback = () => {
      const ta = $("#f-text");
      ta.value = text; ta.focus(); ta.select();
      fileMsg("Copia automatica non riuscita: il testo è selezionato qui sotto, copialo a mano.");
    };
    try {
      navigator.clipboard.writeText(text).then(() => fileMsg("Testo della patch copiato."), fallback);
    } catch (e) { fallback(); }
  });
  // Download as a .maxpat file. Inside the Claude viewer page-started
  // downloads are blocked, so there the button stays hidden.
  const dlBtn = $("#f-download");
  if (window.claude) dlBtn.hidden = true;
  dlBtn.addEventListener("click", () => {
    const base = String(patchName || "patch").replace(/[\\/:*?"<>|]+/g, "_").trim() || "patch";
    const text = JSON.stringify(patch.toJSON(), null, "\t");
    const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = base + ".maxpat";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    fileMsg(`Scaricata come “${base}.maxpat”.`);
  });
  $("#f-open-text").addEventListener("click", () => {
    try {
      const json = JSON.parse($("#f-text").value);
      if (openPatch(json, "patch incollata")) closeDialogs();
      else fileMsg("Il testo non è una patch .maxpat.");
    } catch (e) { fileMsg("Il testo non è una patch valida: controlla di averlo copiato tutto."); }
  });
  $("#f-upload").addEventListener("change", (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        if (openPatch(JSON.parse(rd.result), file.name.replace(/\.(maxpat|json)$/i, ""))) closeDialogs();
        else fileMsg("Il file non è una patch .maxpat.");
      } catch (e) { fileMsg("Il file non è una patch .maxpat leggibile."); }
      ev.target.value = "";
    };
    rd.readAsText(file);
  });

  // object names: autocomplete list and help list
  const names = [...Object.keys(NEWOBJ), ...Object.keys(GUI)].sort();
  const dl = $("#objnames");
  names.forEach((n) => { const o = document.createElement("option"); o.value = n; dl.append(o); });
  const ol = $("#objlist");
  names.forEach((n) => { const li = document.createElement("li"); li.textContent = n; ol.append(li); });

  // ------------------------------------------------------------ animation (scopes, meters)
  let frame = 0;
  function tick() {
    frame++;
    if (frame % 2 === 0) for (const e of patch.entries.values()) { try { e.inst.draw(); } catch (err) { /* keep drawing others */ } }
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------ start
  // Like Max, audio starts off: the Audio button turns it on.
  if (AC.state === "running") AC.suspend().then(showAudio);
  showAudio();
  log("Caricamento dell'audio...");
  // The patch opens once the audio processors are loaded.
  // A link like ...?patch=live_fx opens patches/live_fx.maxpat of this site.
  const linked = new URLSearchParams(location.search).get("patch");
  const linkName = linked && /^[\w-]{1,64}$/.test(linked) ? linked : null;
  // Before a linked patch replaces the open one, unsaved changes go to the
  // saved patches. Autosaves older than the "edited" flag count as edited,
  // except the example.
  function keepUnsaved(saved) {
    if (!saved || !saved.json || !saved.json.patcher) return "";
    const name = saved.name || "patch";
    if (!(saved.edited ?? name !== "simple_monoSynth")) return "";
    const files = store.get(KEY_FILES, {});
    if (files[name] && JSON.stringify(files[name]) === JSON.stringify(saved.json)) return "";
    let n = `${name} (copia)`;
    for (let k = 2; files[n]; k++) n = `${name} (copia ${k})`;
    files[n] = saved.json;
    return store.set(KEY_FILES, files) ? `La patch che avevi aperta è salvata in File come \u201c${n}\u201d.` : "";
  }
  window.PE.ready.then(async (full) => {
    const saved = store.get(KEY_CURRENT, null);
    let json = null, note = "";
    if (linkName) {
      try {
        const r = await fetch(`patches/${linkName}.maxpat`, { cache: "no-cache" });
        if (r.ok) json = await r.json();
      } catch (e) { json = null; }
    }
    if (linked) history.replaceState(null, "", location.pathname);
    const reopen = !!(saved && saved.json && saved.json.patcher);
    if (json && json.patcher) { note = keepUnsaved(saved); openPatch(json, linkName); }
    else {
      if (linked) note = `Non trovo la patch \u201c${linked}\u201d di questo link.`;
      if (reopen) { openPatch(saved.json, saved.name || "patch"); edited = saved.edited ?? saved.name !== "simple_monoSynth"; }
      else openPatch(window.EXAMPLE_PATCH, "simple_monoSynth");
    }
    setLocked(true);
    requestAnimationFrame(tick);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { renderAll(); });
    if (!full) log("Attenzione: questo browser non carica l'audio completo (niente modulazione di fase).");
    log(note || (json || reopen ? "Premi ? per l'aiuto." : EXAMPLE_HINT));
  });
  window.__patcher = { patch, setLocked, openPatch, newBox, get zoom() { return zoom; } };
})();

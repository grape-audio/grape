// What every inlet and outlet of an object is for, as shown to the students
// (the texts are in Italian, like the rest of the interface).
// For each object: d = what the object does, i = its inlets, o = its
// outlets. i and o are lists of texts, or functions of the object (x) for
// objects whose inlets and outlets depend on the arguments: x.nin is the
// number of inlets, x.outTypes.length the number of outlets, x.args the
// arguments typed after the name.
(() => {
  const nOut = (x) => x.outTypes.length;
  const count = (n, f) => Array.from({ length: n }, (v, k) => f(k));
  const LR = ["sinistro", "destro"];
  // "segnale" for one channel, "segnale 1", "segnale 2"... for more
  const each = (n, word) => count(n, (k) => (n > 1 ? `${word} ${k + 1}` : word));
  const FREQ = "frequenza in Hz (numero o segnale)";
  const SIG = "segnale";
  const NOTHING = "(nessuna funzione qui)";

  function compare(what) {
    return {
      d: `confronta due numeri: 1 se il primo è ${what} il secondo, altrimenti 0`,
      i: ["numero da confrontare (fa uscire il risultato)", "numero con cui confrontare"],
      o: ["1 se vero, 0 se falso"],
    };
  }
  function arith(d, right) {
    return {
      d,
      i: ["numero: calcola e fa uscire il risultato · bang: ripete il calcolo", `${right}: lo memorizza, senza uscita`],
      o: ["risultato"],
    };
  }
  function store(kind) {
    return {
      d: `memorizza un numero ${kind}`,
      i: ["numero: lo memorizza e lo fa uscire · bang: fa uscire quello memorizzato", "numero: lo memorizza, senza uscita"],
      o: [`numero ${kind}`],
    };
  }
  function triggerOut(t) {
    if (typeof t === "number") return `sempre ${t}`;
    if (t === "b") return "bang";
    if (t === "i") return "numero intero";
    if (t === "f") return "numero decimale";
    if (t === "l" || t === "a") return "il messaggio intero";
    if (t === "s") return "la prima parola";
    return `sempre “${t}”`;
  }
  const RANGED = (d) => ({ d, i: ["numero: sposta il controllo e fa uscire il valore"], o: ["valore"] });
  const NUMBOX = (kind) => ({
    d: `casella con un numero ${kind}`,
    i: ["numero: lo mostra e lo fa uscire · bang: lo fa uscire · set: lo mostra soltanto"],
    o: ["numero", NOTHING],
  });

  const A = {
    // ---------------------------------------------------------------- messages
    "mtof": { d: "da numero di nota MIDI a frequenza in Hz", i: ["numero di nota MIDI (69 = La 440 Hz)"], o: ["frequenza in Hz"] },
    "ftom": { d: "da frequenza in Hz a numero di nota MIDI", i: ["frequenza in Hz"], o: ["numero di nota MIDI (anche con decimali)"] },
    "+": arith("somma due numeri", "numero da sommare"),
    "-": arith("sottrae il numero di destra da quello di sinistra", "numero da sottrarre"),
    "*": arith("moltiplica due numeri", "moltiplicatore"),
    "/": arith("divide il numero di sinistra per quello di destra", "divisore"),
    "select": {
      d: "riconosce numeri o parole e manda un bang quando arrivano",
      i: (x) => ["numero o parola da riconoscere", "nuovo valore da riconoscere"].slice(0, x.nin),
      o: (x) => count(nOut(x), (k) => (k < nOut(x) - 1
        ? `bang quando arriva ${x.match && x.match[k] !== undefined ? x.match[k] : "il valore"}`
        : "tutto il resto, così com'è")),
    },
    "trigger": {
      d: "manda un messaggio a più uscite, una alla volta da destra a sinistra",
      i: ["messaggio da distribuire"],
      o: (x) => count(nOut(x), (k) => {
        const t = x.types ? triggerOut(x.types[k]) : "messaggio";
        if (nOut(x) > 1 && k === nOut(x) - 1) return `${t} (esce per primo)`;
        if (nOut(x) > 1 && k === 0) return `${t} (esce per ultimo)`;
        return t;
      }),
    },
    "int": store("intero"),
    "float": store("decimale"),
    "metro": { d: "manda un bang a intervalli regolari", i: ["1 o bang: parte · 0 o stop: si ferma", "intervallo in ms"], o: ["bang a ogni intervallo"] },
    "delay": { d: "manda un bang dopo un certo tempo", i: ["bang: fa partire l'attesa · numero: ritardo in ms, e parte · stop: annulla", "ritardo in ms"], o: ["bang alla fine dell'attesa"] },
    "random": { d: "numero casuale", i: ["bang: fa uscire un numero casuale", "quanti numeri possibili (da 0 a questo meno 1)"], o: ["numero casuale"] },
    "pack": {
      d: "unisce più valori in una lista",
      i: (x) => count(x.nin, (k) => (k === 0 ? "valore: lo memorizza e fa uscire la lista" : "valore: lo memorizza, senza uscita")),
      o: ["lista"],
    },
    "unpack": { d: "divide una lista nei suoi valori", i: ["lista da dividere"], o: (x) => count(nOut(x), (k) => `valore ${k + 1} della lista`) },
    "poly": {
      d: "assegna le note alle voci di un sintetizzatore",
      i: ["altezza della nota (numero MIDI)", "velocity (0 = nota spenta)"],
      o: (x) => ["numero della voce", "altezza", "velocity", "note che non trovano una voce libera"].slice(0, nOut(x)),
    },
    "send": { d: "manda messaggi a tutti i receive con lo stesso nome", i: ["messaggio da mandare"], o: [] },
    "receive": {
      d: "riceve i messaggi dei send con lo stesso nome",
      i: (x) => ["set nome: sceglie da quale send ricevere"].slice(0, x.nin), // an inlet only without a name
      o: ["messaggi ricevuti"],
    },
    "gate": {
      d: "fa passare i messaggi verso un'uscita scelta",
      i: ["numero dell'uscita aperta (0 = chiuso)", "messaggi da far passare"],
      o: (x) => count(nOut(x), (k) => `uscita ${k + 1}`),
    },
    "route": {
      d: "smista i messaggi in base alla prima parola",
      i: ["messaggio da smistare", "nuova parola per la prima uscita"],
      o: (x) => count(nOut(x), (k) => (k < nOut(x) - 1
        ? `messaggi che iniziano con “${x.keys && x.keys[k] !== undefined ? x.keys[k] : "…"}” (senza la parola)`
        : "tutto il resto, così com'è")),
    },
    "switch": {
      d: "fa passare i messaggi di un solo ingresso, quello scelto",
      i: (x) => count(x.nin, (k) => (k === 0 ? "numero dell'ingresso aperto (0 = chiuso)" : `ingresso ${k}`)),
      o: ["messaggi dell'ingresso aperto"],
    },
    "change": {
      d: "fa passare un numero solo se è diverso dal precedente",
      i: ["numero"],
      o: ["il numero, se è cambiato", "1 quando passa da 0 a un altro valore", "1 quando torna a 0"],
    },
    "scale": {
      d: "riporta i numeri da un intervallo a un altro",
      i: ["numero o lista da convertire", "minimo in entrata", "massimo in entrata", "minimo in uscita", "massimo in uscita", "curva (1 = lineare)"],
      o: ["numero convertito"],
    },
    ">": compare("maggiore del"),
    "<": compare("minore del"),
    ">=": compare("maggiore o uguale al"),
    "<=": compare("minore o uguale al"),
    "==": compare("uguale al"),
    "!=": compare("diverso dal"),
    "makenote": {
      d: "suona una nota e la spegne dopo una durata",
      i: (x) => ["altezza: fa partire la nota", "velocity", "durata in ms", "canale"].slice(0, x.nin),
      o: (x) => ["altezza", "velocity (0 quando la nota finisce)", "canale"].slice(0, nOut(x)),
    },
    "key": {
      d: "i tasti premuti sulla tastiera del computer",
      i: [],
      o: ["codice del carattere", "codice del tasto", "tasti speciali premuti insieme (Shift, Ctrl…)", "codice del tasto, uguale su ogni computer"],
    },
    "print": { d: "scrive i messaggi nella barra in fondo", i: ["messaggio da scrivere"], o: [] },
    "loadbang": { d: "manda un bang quando si apre la patch", i: ["bang: lo manda di nuovo"], o: ["bang all'apertura"] },
    "loadmess": { d: "manda un messaggio quando si apre la patch", i: ["bang: lo manda di nuovo · set: cambia il messaggio"], o: ["il messaggio scritto dopo il nome"] },
    "counter": {
      d: "conta i bang",
      i: ["bang: conta il passo successivo", "direzione: 0 su, 1 giù, 2 su e giù", "prossimo valore, senza uscita", "valore da cui ripartire, con uscita", "massimo"],
      o: ["conteggio", "1 quando arriva al minimo", "1 quando arriva al massimo", "quante volte ha raggiunto il massimo"],
    },
    "line": {
      d: "va da un numero a un altro in un certo tempo",
      i: ["valore di arrivo, oppure lista arrivo e tempo", "tempo in ms", "ogni quanti ms esce un valore"],
      o: ["valori lungo il percorso", "bang all'arrivo"],
    },
    "clip": { d: "tiene i numeri fra un minimo e un massimo", i: ["numero o lista", "minimo", "massimo"], o: ["numero limitato"] },

    // ---------------------------------------------------------------- audio
    "saw~": { d: "oscillatore a dente di sega", i: [FREQ, "sincronizzazione (segnale)"], o: ["segnale audio"] },
    "rect~": { d: "oscillatore a onda quadra", i: [FREQ, "larghezza dell'impulso 0–1", "sincronizzazione (segnale)"], o: ["segnale audio"] },
    "tri~": { d: "oscillatore a onda triangolare", i: [FREQ, "posizione del vertice 0–1 (0,5 = simmetrica)", "sincronizzazione (segnale)"], o: ["segnale audio"] },
    "cycle~": { d: "oscillatore sinusoidale", i: [FREQ, "fase 0–1 (numero o segnale)"], o: ["segnale audio"] },
    "noise~": { d: "rumore bianco", i: [NOTHING], o: ["segnale audio"] },
    "*~": { d: "moltiplica due segnali, per esempio per cambiare il volume", i: [SIG, "moltiplicatore (numero o segnale)"], o: ["segnale moltiplicato"] },
    "+~": { d: "somma due segnali", i: [SIG, "da sommare (numero o segnale)"], o: ["somma"] },
    "-~": { d: "sottrae il segnale di destra da quello di sinistra", i: [SIG, "da sottrarre (numero o segnale)"], o: ["differenza"] },
    "lores~": { d: "filtro passa-basso con risonanza", i: ["segnale da filtrare", "frequenza di taglio in Hz", "risonanza 0–1"], o: ["segnale filtrato"] },
    "adsr~": {
      d: "inviluppo: attacco, decadimento, sostegno, rilascio",
      i: ["numero sopra 0: fa partire la nota (è il volume) · 0: rilascio", "attacco in ms", "decadimento in ms", "sostegno 0–1", "rilascio in ms"],
      o: ["inviluppo (segnale)", "1 mentre la nota è attiva, poi 0", "messaggi mute", "valori dei parametri (con get…)"],
    },
    "line~": { d: "rampa di segnale da un valore a un altro", i: ["valore di arrivo, oppure coppie arrivo tempo", "tempo della rampa in ms"], o: [SIG, "bang alla fine della rampa"] },
    "sig~": { d: "trasforma un numero in un segnale", i: ["numero"], o: ["segnale costante"] },
    "phasor~": { d: "rampa da 0 a 1 che si ripete", i: [FREQ, "fase 0–1: riporta la rampa a quel punto"], o: ["rampa 0–1"] },
    "snapshot~": { d: "legge il valore di un segnale come numero", i: ["segnale · bang: fa uscire il valore", "ogni quanti ms (0 = solo con bang)"], o: ["valore del segnale"] },
    "peakamp~": { d: "il picco di un segnale", i: ["segnale · bang: fa uscire il picco", "ogni quanti ms (0 = solo con bang)"], o: ["picco dall'ultima uscita"] },
    "degrade~": { d: "abbassa la qualità: meno campioni al secondo e meno bit", i: [SIG, "campionamento relativo 0–1", "numero di bit"], o: ["segnale degradato"] },
    "overdrive~": { d: "distorsione morbida", i: [SIG, "quantità di distorsione (1 = nessuna)"], o: ["segnale distorto"] },
    "comb~": {
      d: "filtro a pettine",
      i: [SIG, "ritardo in ms", "volume del segnale diretto", "volume del segnale ritardato", "retroazione (feedback)"],
      o: ["segnale filtrato"],
    },
    "reson~": { d: "filtro passa-banda risonante", i: ["segnale da filtrare", "guadagno", "frequenza centrale in Hz", "Q (più alto = banda più stretta)"], o: ["segnale filtrato"] },
    "freqshift~": { d: "sposta tutte le frequenze dello stesso numero di Hz", i: [SIG, "spostamento in Hz (anche negativo)"], o: ["segnale spostato"] },
    "send~": { d: "manda un segnale a tutti i receive~ con lo stesso nome", i: ["segnale da mandare"], o: [] },
    "receive~": { d: "riceve il segnale dei send~ con lo stesso nome", i: ["set nome: sceglie da quale send~ ricevere"], o: ["segnale ricevuto"] },
    "selector~": {
      d: "sceglie quale segnale far passare",
      i: (x) => count(x.nin, (k) => (k === 0 ? "numero dell'ingresso scelto (0 = silenzio)" : `segnale ${k}`)),
      o: ["segnale scelto"],
    },
    "gate~": {
      d: "manda un segnale verso un'uscita scelta",
      i: ["numero dell'uscita aperta (0 = chiuso)", "segnale da far passare"],
      o: (x) => count(nOut(x), (k) => `uscita ${k + 1}`),
    },
    "dac~": {
      d: "uscita audio, verso altoparlanti o cuffie",
      i: (x) => count(x.nin, (k) => {
        const c = x.chans ? x.chans[k] : k + 1;
        const side = c === 1 || c === 2 ? ` (${LR[c - 1]})` : "";
        return `canale ${c}${side}` + (k === 0 ? " · start/stop: accende/spegne l'audio" : "");
      }),
      o: [],
    },
    "adc~": {
      d: "ingresso audio, dal microfono",
      i: ["start/stop: accende/spegne l'audio"],
      o: (x) => count(nOut(x), (k) => {
        const c = x.chans ? x.chans[k] : k + 1;
        return `canale ${c}` + (c === 1 || c === 2 ? ` (${LR[c - 1]})` : "");
      }),
    },
    "tapin~": { d: "memoria di un delay: va collegato a tapout~", i: ["segnale da ritardare · clear: svuota la memoria"], o: ["collegamento al tapout~ (non è audio)"] },
    "tapout~": {
      d: "legge la memoria di tapin~ con un ritardo",
      i: (x) => count(x.nin, (k) => (k === 0 ? "collegamento da tapin~ · ritardo in ms (numero o segnale)" : `ritardo ${k + 1} in ms (numero o segnale)`)),
      o: (x) => each(nOut(x), "segnale ritardato"),
    },
    "pitchshift~": {
      d: "cambia l'altezza del suono",
      i: (x) => each(x.nin - 1, SIG).concat(["trasposizione: fattore (2 = un'ottava sopra), o cents con @usecents 1"]),
      o: (x) => each(nOut(x) - 1, "segnale trasposto").concat(["informazioni (latenza)"]),
    },
    "cverb~": { d: "riverbero", i: [SIG, "durata del riverbero in ms"], o: ["solo il suono riverberato"] },
    "clip~": { d: "tiene un segnale fra un minimo e un massimo", i: [SIG, "minimo (numero o segnale)", "massimo (numero o segnale)"], o: ["segnale limitato"] },
    "limi~": { d: "limitatore: il segnale non supera la soglia", i: (x) => each(x.nin, SIG), o: (x) => each(nOut(x), "segnale limitato") },
    "buffer~": {
      d: "memoria per campioni audio",
      i: ["messaggi: read (carica un file), size, clear, normalize, write…"],
      o: [NOTHING, "bang quando un file è stato caricato o salvato"],
    },
    "record~": {
      d: "registra un segnale dentro un buffer~",
      i: (x) => {
        const ch = x.nin - 2;
        return count(ch, (k) => (k === 0 ? `${ch > 1 ? "canale 1" : "segnale"} da registrare · 1: registra · 0: si ferma` : `canale ${k + 1} da registrare`))
          .concat(["punto di inizio in ms", "punto di fine in ms"]);
      },
      o: ["avanzamento della registrazione 0–1"],
    },
    "groove~": {
      d: "suona un buffer~ a velocità variabile",
      i: ["velocità (segnale: 1 normale, -1 all'indietro) · numero: posizione in ms", "inizio del loop in ms", "fine del loop in ms (0 = fine del buffer~)"],
      o: (x) => each(nOut(x) - 1, "canale").concat(["posizione nel loop 0–1"]),
    },
    "sfplay~": {
      d: "suona un file audio",
      i: ["open: sceglie il file · 1: suona · 0: si ferma", "velocità (negativa = all'indietro)"],
      o: (x) => {
        const ch = x.ch || 1, rest = nOut(x) - ch;
        return each(ch, "canale").concat(rest > 1 ? ["posizione in ms"] : [], ["bang alla fine del file"]);
      },
    },
    "sfrecord~": {
      d: "registra un file audio (WAV o MP3)",
      i: (x) => count(x.nin, (k) => (k === 0 ? `${x.nin > 1 ? "canale 1" : "segnale"} da registrare · open: nuovo file · 1: registra · 0: si ferma e salva` : `canale ${k + 1} da registrare`)),
      o: ["tempo registrato in ms"],
    },

    // ---------------------------------------------------------------- interface
    "dial": RANGED("manopola"),
    "slider": RANGED("cursore"),
    "number": NUMBOX("intero"),
    "flonum": NUMBOX("decimale"),
    "toggle": { d: "interruttore: acceso 1, spento 0", i: ["numero: 0 spento, altro acceso (e lo fa uscire) · bang: cambia stato"], o: ["1 acceso, 0 spento"] },
    "button": { d: "pulsante", i: ["qualsiasi messaggio: fa uscire un bang"], o: ["bang"] },
    "ezdac~": { d: "accende e spegne l'audio · uscita verso altoparlanti o cuffie", i: ["canale sinistro (segnale)", "canale destro (segnale)"], o: [] },
    "ezadc~": { d: "accende e spegne l'audio · ingresso dal microfono", i: ["start/stop: accende/spegne l'audio"], o: ["canale 1 (sinistro)", "canale 2 (destro)"] },
    "kslider": { d: "tastiera", i: ["altezza: la mostra e la fa uscire", "velocity per le note che arrivano"], o: ["altezza", "velocity (0 = nota spenta)"] },
    "playlist~": {
      d: "elenco di file audio da suonare",
      i: ["numero della clip da suonare (0 = stop) · append: aggiunge un file"],
      o: (x) => each(nOut(x) - 3, "canale").concat(["posizione (clip e frazione)", "messaggi: start, done…", NOTHING]),
    },
    "panel": { d: "pannello colorato di sfondo", i: [NOTHING], o: [] },
    "scope~": { d: "oscilloscopio", i: ["segnale da mostrare", NOTHING], o: [] },
    "live.scope~": { d: "oscilloscopio", i: ["segnale da mostrare", NOTHING], o: [NOTHING] },
    "meter~": { d: "misuratore di livello", i: ["segnale da misurare"], o: ["picco, a ogni intervallo"] },
    "spectroscope~": { d: "analizzatore di spettro", i: ["segnale da analizzare", NOTHING], o: [NOTHING] },
    "live.gain~": {
      d: "fader del volume, con misuratore",
      i: (x) => each(x.nin, SIG).map((t, k) => (k === 0 ? `${t} · numero in dB: sposta il fader` : t)),
      o: (x) => each(nOut(x) - 3, "segnale col volume del fader").concat(["valore in dB", "valore 0–1", "livelli del misuratore in dB"]),
    },
    "message": {
      d: "messaggio: lo manda quando lo tocchi o riceve un bang",
      i: ["bang: manda il messaggio · numeri: prendono il posto di $1, $2…", "qualsiasi messaggio: diventa il nuovo testo, senza uscita"],
      o: ["il messaggio"],
    },
    "comment": { d: "commento: solo testo", i: [NOTHING], o: [] },
  };
  // other names of the same objects
  const SAME = { sel: "select", t: "trigger", i: "int", f: "float", del: "delay", s: "send", r: "receive", "s~": "send~", "r~": "receive~" };
  for (const [a, b] of Object.entries(SAME)) A[a] = A[b];

  // The texts for one object: { d, ins, outs }, one text per inlet and per
  // outlet (an empty text where there is none). null for unknown objects.
  function describe(name, x) {
    const e = A[name];
    if (!e) return null;
    const list = (v, n) => {
      const t = typeof v === "function" ? v(x) : v;
      return count(n, (k) => (t && t[k] !== undefined ? t[k] : ""));
    };
    return { d: e.d, ins: list(e.i, x.nin), outs: list(e.o, x.outTypes.length) };
  }
  window.ASSIST = { table: A, describe };
})();

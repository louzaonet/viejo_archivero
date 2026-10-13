/*
 * Motor de aventuras tipo PAW (Professional Adventure Writer) en JavaScript.
 * Es el del remake 2026 de "Don Quijote de la Mancha" (Aventuras Level 10),
 * ajustado para mover juegos de PAW tal cual: la base de datos la saca
 * tools/de_paw.mjs de la instantánea del Spectrum, con los mismos números y
 * los mismos condactos, y aquí se hace lo que hacía el intérprete de PAW:
 * oscuridad y objeto 0 (la luz), banderas que bajan solas (2 a 10), la 1
 * (objetos que se llevan), NOTDONE, DOALL que se corta, GRAPHIC, ABILITY...
 * El motor no sabe nada de pantallas: toda la E/S pasa por el objeto `io`,
 * que en el navegador es la pantalla Spectrum (screen.js) y en Node el
 * arnés de pruebas (test/run.mjs).
 *
 * Interfaz io (todas las funciones pueden devolver Promise):
 *   print(text)        texto con códigos de color \x10n (ink) \x11n (paper) \x13n (bright)
 *   cls()              borra toda la pantalla
 *   picture(n)         dibuja la imagen n (o -1 para ninguna) en la zona gráfica
 *   input()            devuelve la orden tecleada (string)
 *   anykey(prompt)     espera una tecla
 *   pause(ms)          pausa
 *   border(n)          color del borde
 *   store(key, value?) persistencia (SAVE/LOAD); devuelve el valor si value es undefined
 */
(function (root) {
  'use strict';

  // Flags del sistema, con los mismos números que PAW
  const F = {
    DARK: 0, CARRIED: 1, SCORE: 30, TURNS_LO: 31, TURNS_HI: 32, VERB: 33, NOUN1: 34, ADJ1: 35,
    ADVERB: 36, MAXOBJ: 37, LOC: 38, MODE: 40, LINE: 41, PROMPT: 42, PREP: 43, NOUN2: 44, ADJ2: 45,
    PRON_N: 46, PRON_A: 47, OBJREF: 51, MAXWEIGHT: 52, OBJFLAGS: 53, OBJLOC: 54,
  };
  // Localidades especiales de objetos
  const L = { NOTCREATED: 252, WORN: 253, CARRIED: 254, HERE: 255 };
  const NONE = 255;
  // Tipos de palabra del vocabulario
  const T = { VERB: 0, ADVERB: 1, NOUN: 2, ADJ: 3, PREP: 4, CONJ: 5, PRON: 6 };

  // Señales de control de flujo (se lanzan como excepciones)
  class Signal { constructor(kind, data) { this.kind = kind; this.data = data; } }

  /** Normaliza texto tecleado: mayúsculas, sin acentos salvo la Ñ */
  function normalize(s) {
    return s.toUpperCase()
      .replace(/[ÁÀÂÄ]/g, 'A').replace(/[ÉÈÊË]/g, 'E').replace(/[ÍÌÎÏ]/g, 'I')
      .replace(/[ÓÒÔÖ]/g, 'O').replace(/[ÚÙÛÜ]/g, 'U');
  }

  class Engine {
    constructor(db, io) {
      this.db = db;
      this.io = io;
      // Índice de vocabulario: palabra(5) -> lista de [num, tipo]
      this.voc = new Map();
      for (const [w, n, t] of db.vocab) {
        if (!this.voc.has(w)) this.voc.set(w, []);
        this.voc.get(w).push([n, t]);
      }
      this.ramsave = null;     // como en PAW, sobrevive a END (se pierde al cerrar)
      this.reset();
    }

    reset() {
      this.flags = new Array(256).fill(0);
      this.flags[F.MAXOBJ] = this.db.config.maxobj;
      this.flags[F.MAXWEIGHT] = this.db.config.maxweight;
      this.flags[F.LOC] = this.db.config.start;
      this.objloc = this.db.objs.map(o => o.loc);
      this.flags[F.PRON_N] = NONE; this.flags[F.PRON_A] = NONE;
      this.graphic = 0;        // GRAPHIC: 0 dibujo la primera vez, 1 nunca, 2 siempre
      this.visited = new Set();
      this.doallStop = false;
      this.sentences = [];     // frases pendientes de la última orden
      this.quoted = null;      // texto entre comillas (para PARSE)
      this.lastVerb = NONE;
      this.lastNoun = NONE; this.lastAdj = NONE;
    }

    // ---------------------------------------------------------------- texto
    msg(n) { return this.db.msgs[n]; }
    sys(n) { return this.db.sys[n] || ''; }
    // PAW pone el texto del objeto en el sitio de "_" sin el punto final
    objName(o) { const t = this.db.objs[o].text, d = t.indexOf('.'); return d >= 0 ? t.slice(0, d) : t; }
    dark() { return this.flags[F.DARK] !== 0 && !this.isPresent(0); }
    syncCarried() { this.flags[F.CARRIED] = this.countCarried(); }
    async out(s) { await this.io.print(s); }
    async sysmess(n) {
      let s = this.sys(n);
      if (s.includes('_')) {
        const o = this.flags[F.OBJREF];
        s = s.replace('_', o < this.db.objs.length ? this.objName(o) : '');
      }
      await this.out(s);
    }

    // ---------------------------------------------------------- objetos
    objsAt(loc) {
      const r = [];
      for (let i = 0; i < this.objloc.length; i++) if (this.objloc[i] === loc) r.push(i);
      return r;
    }
    countCarried() { return this.objsAt(L.CARRIED).length; }
    weight(o) {
      let w = this.db.objs[o].w;
      if (this.db.objs[o].cont) for (const c of this.objsAt(o)) w += this.weight(c);
      return w;
    }
    carriedWeight() {
      let w = 0;
      for (let i = 0; i < this.objloc.length; i++)
        if (this.objloc[i] === L.CARRIED || this.objloc[i] === L.WORN) w += this.weight(i);
      return w;
    }
    /** Busca el objeto de noun1/adj1, prefiriendo los de `prefer` (lista de localidades) */
    findObj(noun, adj, prefer) {
      const cands = [];
      for (let i = 0; i < this.db.objs.length; i++) {
        const o = this.db.objs[i];
        if (o.noun === noun && noun !== NONE && (adj === NONE || o.adj === adj)) cands.push(i);
      }
      for (const loc of prefer) for (const c of cands) if (this.objloc[c] === loc) return c;
      return cands.length ? cands[0] : -1;
    }
    here() { return this.flags[F.LOC]; }
    saveKey() { return 'paw-' + (this.db.config.save || 'juego'); }
    /** ¿El nombre de la frase es el de algún objeto? (PAW: SM26/28 si lo es, SM8 si no) */
    isObjWord() { const n = this.flags[F.NOUN1]; return n !== NONE && this.db.objs.some(o => o.noun === n); }
    /** Puntuación en tanto por ciento sobre db.config.maxscore (flag 30 = puntos) */
    percent() { return Math.floor(this.flags[F.SCORE] * 100 / (this.db.config.maxscore || 100)); }
    isPresent(o) {
      const l = this.objloc[o];
      return l === L.CARRIED || l === L.WORN || l === this.here();
    }
    // Como LISTOBJ/LISTAT de PAW: un objeto por línea, o seguidos en una frase
    // si el bit 6 de la bandera 53 está puesto
    async listObjs(objs, intro) {
      const f = this.flags;
      f[F.OBJFLAGS] &= 0x7f;
      if (!objs.length) return false;
      f[F.OBJFLAGS] |= 0x80;
      if (intro !== null) await this.out(intro);
      if (!(f[F.OBJFLAGS] & 0x40)) {
        if (intro !== null) await this.out('\n');
        for (const o of objs) await this.out(this.db.objs[o].text + '\n');
        return true;
      }
      for (let i = 0; i < objs.length; i++) {
        let t = this.db.objs[objs[i]].text;
        const dot = t.indexOf('.');
        if (dot >= 0) t = t.slice(0, dot);
        await this.out(t + this.sys(i < objs.length - 2 ? 46 : i === objs.length - 2 ? 47 : 48));
      }
      return true;
    }

    // ---------------------------------------------------------- parser
    lookup(word) {
      const w = word.slice(0, 5);
      return this.voc.get(w) || null;
    }
    /** Separa la orden en frases y guarda el texto entre comillas */
    splitInput(line) {
      line = normalize(line);
      this.quoted = null;
      const q = line.indexOf('"');
      if (q >= 0) {
        const q2 = line.indexOf('"', q + 1);
        this.quoted = line.slice(q + 1, q2 < 0 ? undefined : q2);
        line = line.slice(0, q) + ' ' + (q2 < 0 ? '' : line.slice(q2 + 1));
      }
      const sentences = [];
      let cur = [];
      for (const tok of line.split(/([.,;:])|\s+/)) {
        if (tok === undefined || tok === '') continue;
        if (/^[.,;:]$/.test(tok)) { if (cur.length) sentences.push(cur); cur = []; continue; }
        const e = this.lookup(tok);
        if (e && e.some(([, t]) => t === T.CONJ)) { if (cur.length) sentences.push(cur); cur = []; continue; }
        cur.push(tok);
      }
      if (cur.length) sentences.push(cur);
      return sentences;
    }
    /** Analiza una frase y rellena los flags 33-36, 43-45. Devuelve false si no hay nada útil. */
    parseSentence(words) {
      let verb = NONE, n1 = NONE, a1 = NONE, n2 = NONE, a2 = NONE, prep = NONE, adv = NONE;
      let pron = false, any = false;
      const ENCL = ['SELO', 'SELA', 'SELOS', 'SELAS', 'LOS', 'LAS', 'LES', 'LO', 'LA', 'LE', 'ME', 'TE', 'SE'];
      for (let word of words) {
        let e = this.lookup(word);
        // enclíticos: COGELA, DAMELO, DESATALO... (solo en español)
        if (!e && (this.db.config.lang || 'es') === 'es') {
          for (const suf of ENCL) {
            if (word.length > suf.length + 2 && word.endsWith(suf)) {
              const base = word.slice(0, -suf.length);
              const be = this.lookup(base);
              if (be && be.some(([, t]) => t === T.VERB)) {
                e = be;
                if (!['ME', 'TE', 'SE'].includes(suf)) pron = true;
                break;
              }
            }
          }
        }
        if (!e) continue;
        any = true;
        const has = t => e.find(([, tt]) => tt === t);
        let v;
        if (verb === NONE && (v = has(T.VERB))) { verb = v[0]; continue; }
        if ((v = has(T.NOUN))) {
          if (n1 === NONE) { n1 = v[0]; continue; }
          // una dirección detrás del objeto no es el segundo nombre (TAKE SWORD OUT OF BAGS)
          if (n2 === NONE && !(v[0] < 20 && verb !== NONE && n1 >= 20)) { n2 = v[0]; continue; }
          continue;
        }
        if ((v = has(T.ADJ))) { if (n2 !== NONE) a2 = v[0]; else a1 = a1 === NONE ? v[0] : a1; continue; }
        if ((v = has(T.PREP))) { if (prep === NONE) prep = v[0]; continue; }
        if ((v = has(T.ADVERB))) { if (adv === NONE) adv = v[0]; continue; }
        if ((v = has(T.PRON))) { pron = true; continue; }
      }
      if (!any) return false;
      // Nombres de movimiento (<20) sin verbo: hacen de verbo (N, SUBIR, SALIR...)
      if (verb === NONE && n1 !== NONE && n1 < 20) { verb = n1; n1 = n2; a1 = a2; n2 = NONE; a2 = NONE; }
      // con verbo, una palabra de dirección delante de un nombre sobra (PICK UP THE LANCE)
      else if (verb !== NONE && n1 !== NONE && n1 < 20 && n2 !== NONE) { n1 = n2; a1 = a2; n2 = NONE; a2 = NONE; }
      if (pron && n1 === NONE) { n1 = this.lastNoun; a1 = this.lastAdj; }
      if (verb === NONE) verb = this.lastVerb;
      if (verb === NONE && n1 === NONE) return false;
      const f0 = this.flags;
      if (n1 !== NONE && n1 >= 20) { this.lastNoun = n1; this.lastAdj = a1; f0[F.PRON_N] = n1; f0[F.PRON_A] = a1; }
      this.lastVerb = verb;
      const f = this.flags;
      f[F.VERB] = verb; f[F.NOUN1] = n1; f[F.ADJ1] = a1; f[F.NOUN2] = n2; f[F.ADJ2] = a2;
      f[F.PREP] = prep; f[F.ADVERB] = adv;
      return true;
    }

    // ---------------------------------------------------------- tablas de proceso
    match(entry) {
      const v = entry.v, n = entry.n, f = this.flags;
      return (v === NONE || v === 1 || v === f[F.VERB]) && (n === NONE || n === 1 || n === f[F.NOUN1]);
    }
    /**
     * Ejecuta una tabla de proceso. Devuelve true si algún condacto de acción
     * se ejecutó (equivalente al "done" de PAW). DONE termina la tabla.
     */
    async runTable(num, startEntry = 0) {
      const table = this.db.procs[num] || [];
      let did = false;
      for (let i = startEntry; i < table.length; i++) {
        const entry = table[i];
        if (!this.match(entry)) continue;
        const r = await this.runEntry(entry, num, i);
        if (r === 'done') return true;
        if (r === 'notdone') return false;
        if (r === 'did') did = true;
      }
      return did;
    }
    /** Ejecuta los condactos de una entrada. 'fail' | 'did' | 'done' | 'cont' */
    async runEntry(entry, tnum, idx) {
      let did = false;
      for (const c of entry.c) {
        const r = await this.condact(c, tnum, idx);
        if (r === false) return did ? 'did' : 'fail';
        if (r === 'done' || r === 'notdone') return r;
        if (r === 'skip') return did ? 'did' : 'fail';   // PARSE con éxito
        if (r === 'act') did = true;
      }
      return did ? 'did' : 'cont';
    }

    /** Ejecuta un condacto. true = condición cumplida, false = falla, 'act' = acción, 'done' = DONE */
    async condact(c, tnum, idx) {
      const [op, a, b] = c;
      const f = this.flags, ol = this.objloc;
      const loc = () => f[F.LOC];
      this.syncCarried();
      switch (op) {
        // ---- condiciones
        case 'AT': return loc() === a;
        case 'NOTAT': return loc() !== a;
        case 'ATGT': return loc() > a;
        case 'ATLT': return loc() < a;
        case 'PRESENT': return this.isPresent(a);
        case 'ABSENT': return !this.isPresent(a);
        case 'WORN': return ol[a] === L.WORN;
        case 'NOTWORN': return ol[a] !== L.WORN;
        case 'CARRIED': return ol[a] === L.CARRIED;
        case 'NOTCARR': return ol[a] !== L.CARRIED;
        case 'CHANCE': return Math.random() * 100 < a;
        case 'ZERO': return f[a] === 0;
        case 'NOTZERO': return f[a] !== 0;
        case 'EQ': return f[a] === b;
        case 'NOTEQ': return f[a] !== b;
        case 'GT': return f[a] > b;
        case 'LT': return f[a] < b;
        case 'SAME': return f[a] === f[b];
        case 'NOTSAME': return f[a] !== f[b];
        case 'ADJECT1': return f[F.ADJ1] === a;
        case 'ADJECT2': return f[F.ADJ2] === a;
        case 'ADVERB': return f[F.ADVERB] === a;
        case 'PREP': return f[F.PREP] === a;
        case 'NOUN2': return f[F.NOUN2] === a;
        case 'ISAT': return ol[a] === (b === L.HERE ? loc() : b);
        case 'ISNOTAT': return ol[a] !== (b === L.HERE ? loc() : b);
        case 'WEIGHT_LT': return this.carriedWeight() < a;
        // ---- acciones
        case 'INVEN': {
          const c1 = this.objsAt(L.CARRIED), c2 = this.objsAt(L.WORN);
          await this.out(this.sys(9) + (this.sys(9).endsWith('\n') ? '' : '\n'));   // PAW salta de línea tras el SM9
          if (!c1.length && !c2.length) await this.out(this.sys(11));
          for (const o of c1) await this.out(this.db.objs[o].text + '\n');
          for (const o of c2) await this.out(this.db.objs[o].text + this.sys(10) + '\n');
          return 'done';
        }
        case 'DESC': throw new Signal('desc');
        case 'QUIT': {
          await this.sysmess(12);
          const k = normalize(await this.io.input(true));
          if (!k.startsWith(normalize(this.sys(30).trim()[0] || 'S'))) return 'done';
          return 'act';
        }
        case 'END': throw new Signal('end');
        case 'DONE': return 'done';
        case 'NOTDONE': return 'notdone';
        case 'OK': await this.sysmess(15); return 'done';
        case 'ANYKEY': await this.io.anykey(this.sys(16)); return 'act';
        case 'SAVE': {
          const ok = await this.io.store(this.saveKey(), JSON.stringify({ f: this.flags, o: this.objloc }));
          if (ok === false) await this.out('No se ha podido grabar la partida.\n'); else await this.sysmess(15);
          return 'done';
        }
        case 'LOAD': {
          const s = await this.io.store(this.saveKey());
          if (!s) { await this.out('No hay ninguna partida grabada.\n'); return 'done'; }
          const d = JSON.parse(s);
          this.flags = d.f; this.objloc = d.o;
          throw new Signal('desc');
        }
        case 'RAMSAVE': this.ramsave = { f: this.flags.slice(), o: this.objloc.slice() }; return 'act';
        case 'RAMLOAD':     // RAMLOAD n: las banderas por encima de n se quedan como están
          if (!this.ramsave) return 'act';
          for (let i = 0; i <= Math.min(a, 255); i++) this.flags[i] = this.ramsave.f[i];
          this.objloc = this.ramsave.o.slice();
          return 'act';
        case 'TURNS': {
          const t = f[F.TURNS_LO] + 256 * f[F.TURNS_HI];
          await this.out(this.sys(17) + t + this.sys(18) + (t === 1 ? '' : this.sys(19)) + this.sys(20));
          return 'act';
        }
        case 'SCORE': await this.out(this.sys(21) + this.percent() + this.sys(22)); return 'act';
        case 'CLS': await this.io.cls(); return 'act';
        case 'DROPALL':
          for (let i = 0; i < ol.length; i++) if (ol[i] === L.CARRIED || ol[i] === L.WORN) ol[i] = loc();
          return 'act';
        case 'AUTOG': case 'AUTOD': case 'AUTOW': case 'AUTOR': {
          const pref = { AUTOG: [loc(), L.CARRIED, L.WORN], AUTOD: [L.CARRIED, L.WORN, loc()],
            AUTOW: [L.CARRIED, L.WORN, loc()], AUTOR: [L.WORN, L.CARRIED, loc()] }[op];
          const o = this.findObj(f[F.NOUN1], f[F.ADJ1], pref);
          if (o < 0) { await this.sysmess(this.isObjWord() ? { AUTOG: 26, AUTOD: 28, AUTOW: 28, AUTOR: 23 }[op] : 8); return 'done'; }
          return await this.condact([{ AUTOG: 'GET', AUTOD: 'DROP', AUTOW: 'WEAR', AUTOR: 'REMOVE' }[op], o]);
        }
        case 'AUTOP': case 'AUTOT': {
          const o = this.findObj(f[F.NOUN1], f[F.ADJ1], op === 'AUTOP' ? [L.CARRIED, L.WORN, loc()] : [a]);
          if (o < 0) {
            if (!this.isObjWord()) await this.sysmess(8);
            else if (op === 'AUTOP') await this.sysmess(28);
            else await this.out(this.sys(52) + this.objName(a) + this.sys(51));
            return 'done';
          }
          return await this.condact([op === 'AUTOP' ? 'PUTIN' : 'TAKEOUT', o, a]);
        }
        case 'GET': {
          f[F.OBJREF] = a;
          if (ol[a] === L.CARRIED || ol[a] === L.WORN) { await this.sysmess(25); return 'done'; }
          if (ol[a] !== loc()) { await this.sysmess(26); return 'done'; }
          if (this.carriedWeight() + this.weight(a) > f[F.MAXWEIGHT]) { await this.sysmess(43); return 'done'; }
          if (this.countCarried() >= f[F.MAXOBJ]) { await this.sysmess(27); this.doallStop = true; return 'done'; }
          ol[a] = L.CARRIED; await this.sysmess(36); return 'act';
        }
        case 'DROP': {
          f[F.OBJREF] = a;
          if (ol[a] === L.WORN) { await this.sysmess(24); return 'done'; }
          if (ol[a] === loc()) { await this.sysmess(49); return 'done'; }
          if (ol[a] !== L.CARRIED) { await this.sysmess(28); return 'done'; }
          ol[a] = loc(); await this.sysmess(39); return 'act';
        }
        case 'WEAR': {
          f[F.OBJREF] = a;
          if (ol[a] === L.WORN) { await this.sysmess(29); return 'done'; }
          if (ol[a] !== L.CARRIED) { await this.sysmess(28); return 'done'; }
          if (!this.db.objs[a].wear) { await this.sysmess(40); return 'done'; }
          ol[a] = L.WORN; await this.sysmess(37); return 'act';
        }
        case 'REMOVE': {
          f[F.OBJREF] = a;
          if (ol[a] !== L.WORN) { await this.sysmess(23); return 'done'; }
          if (this.countCarried() >= f[F.MAXOBJ]) { await this.sysmess(42); return 'done'; }
          ol[a] = L.CARRIED; await this.sysmess(38); return 'act';
        }
        case 'PUTIN': {   // PUTIN obj contenedor
          f[F.OBJREF] = a;
          if (ol[a] !== L.CARRIED) { await this.sysmess(28); return 'done'; }
          if (a === b) { await this.sysmess(8); return 'done'; }
          ol[a] = b; await this.out(this.sys(44).replace('_', this.objName(a)) + this.objName(b) + this.sys(51));
          return 'act';
        }
        case 'TAKEOUT': {
          f[F.OBJREF] = a;
          if (ol[a] !== b) { await this.out(this.sys(45).replace('_', this.objName(a)) + this.objName(b) + this.sys(51)); return 'done'; }
          if (this.countCarried() >= f[F.MAXOBJ]) { await this.sysmess(27); return 'done'; }
          ol[a] = L.CARRIED; await this.sysmess(36); return 'act';
        }
        case 'DESTROY': ol[a] = L.NOTCREATED; return 'act';
        case 'CREATE': ol[a] = loc(); return 'act';
        case 'SWAP': { const t = ol[a]; ol[a] = ol[b]; ol[b] = t; return 'act'; }
        case 'PLACE': ol[a] = b === L.HERE ? loc() : b; return 'act';
        case 'PAUSE': await this.io.pause(a * 20); return 'act';
        case 'GOTO': f[F.LOC] = a; return 'act';
        case 'MESSAGE': await this.out(this.msg(a) + '\n'); return 'act';
        case 'MES': await this.out(this.msg(a)); return 'act';
        case 'SYSMESS': await this.sysmess(a); return 'act';
        case 'NEWLINE': await this.out('\n'); return 'act';
        case 'PRINT': await this.out(String(f[a])); return 'act';
        case 'SET': f[a] = 255; return 'act';
        case 'CLEAR': f[a] = 0; return 'act';
        case 'LET': f[a] = b; return 'act';
        case 'PLUS': f[a] = Math.min(255, f[a] + b); return 'act';
        case 'MINUS': f[a] = Math.max(0, f[a] - b); return 'act';
        case 'ADD': f[b] = Math.min(255, f[b] + f[a]); return 'act';
        case 'SUB': f[b] = Math.max(0, f[b] - f[a]); return 'act';
        case 'COPYFF': f[b] = f[a]; return 'act';
        case 'COPYOF': f[b] = ol[a]; return 'act';
        case 'COPYFO': ol[b] = f[a]; return 'act';
        case 'LISTOBJ': await this.listObjs(this.objsAt(loc()), this.sys(1)); return 'act';
        case 'LISTAT': if (!(await this.listObjs(this.objsAt(a), ''))) await this.sysmess(53); return 'act';
        case 'PROCESS': {
          const r = await this.runTable(a);
          return r ? 'act' : true;
        }
        case 'PARSE': {
          // Analiza el texto entre comillas. Si se entiende, la entrada actual
          // termina y la tabla sigue buscando con las palabras nuevas.
          if (this.quoted === null) return true;
          const s = this.splitInput(this.quoted);
          this.quoted = null;
          if (s.length && this.parseSentence(s[0])) return 'skip';
          return true;
        }
        case 'PICTURE': await this.io.picture(a); return 'act';
        case 'GRAPHIC': this.graphic = a; return 'act';
        case 'MODE': f[F.MODE] = a; return 'act';
        case 'LINE': f[F.LINE] = a; return 'act';
        case 'PROMPT': f[F.PROMPT] = a; return 'act';
        case 'ABILITY': f[F.MAXOBJ] = a; f[F.MAXWEIGHT] = b; return 'act';
        case 'RANDOM': f[a] = 1 + Math.floor(Math.random() * 100); return 'act';
        case 'WEIGH': f[b] = Math.min(255, this.weight(a)); return 'act';
        case 'COPYOO': ol[b] = ol[a]; f[F.OBJREF] = b; return 'act';
        case 'WHATO': {
          const o = this.findObj(f[F.NOUN1], f[F.ADJ1], [L.CARRIED, L.WORN, loc()]);
          f[F.OBJREF] = o < 0 ? NONE : o;
          if (o >= 0) f[F.OBJLOC] = ol[o];
          return 'act';
        }
        case 'PUTO': if (f[F.OBJREF] < ol.length) ol[f[F.OBJREF]] = a === L.HERE ? loc() : a; return 'act';
        case 'NEWTEXT': this.sentences = []; return 'act';
        case 'INK': await this.out('\x10' + (a & 7)); return 'act';
        case 'PAPER': await this.out('\x11' + (a & 7)); return 'act';
        case 'TIMEOUT': return false;
        case 'TIME': case 'EXTERN': case 'CHARSET': case 'PROTECT': case 'SAVEAT': case 'BACKAT': case 'PRINTAT': case 'INPUT':
          return 'act';
        case 'RESET':
          for (let i = 0; i < ol.length; i++) ol[i] = ol[i] === loc() ? a : this.db.objs[i].loc;
          f[F.LOC] = a;
          throw new Signal('desc');
        case 'BORDER': await this.io.border(a); return 'act';
        case 'BEEP': return 'act';
        case 'DOALL': {
          // Repite el resto de la tabla para cada objeto de la localidad `a`
          const where = a === L.HERE ? loc() : a;
          const objs = this.objsAt(where).filter(o => this.db.objs[o].noun !== f[F.NOUN2]);
          if (!objs.length) { await this.sysmess(8); return 'done'; }
          this.doallStop = false;
          for (const o of objs) {
            if (this.objloc[o] !== where) continue;      // ya no está (lo ha movido otra vuelta)
            f[F.NOUN1] = this.db.objs[o].noun; f[F.ADJ1] = this.db.objs[o].adj;
            await this.runTable(tnum, idx + 1);
            if (this.doallStop) break;
          }
          this.doallStop = false;
          return 'done';
        }
        case 'MOVE': {  // MOVE flag: mueve según conexiones de la localidad guardada en flag
          const dest = (this.db.conns[f[a]] || []).find(([d]) => d === f[F.VERB]);
          if (!dest) return false;
          f[a] = dest[1]; return 'act';
        }
        default:
          if (typeof console !== 'undefined') console.warn('Condacto sin hacer: ' + op);
          return 'act';
      }
    }

    // ---------------------------------------------------------- bucle principal
    // Describir la localidad como PAW: banderas 2-4, borrar (salvo en el modo
    // 1), oscuridad, dibujo (según GRAPHIC), texto sin salto de línea y luego
    // el proceso 1. En el modo 0 el dibujo ocupa la pantalla y se espera una
    // tecla antes del texto (así salen las pantallas de presentación).
    async describe() {
      const f = this.flags, dark = f[F.DARK] !== 0;
      if (f[2]) f[2]--;
      if (dark && f[3]) f[3]--;
      if (dark && f[4] && !this.isPresent(0)) f[4]--;
      const here = this.here(), l = this.db.locs[here];
      if (f[F.MODE] !== 1) await this.io.clearText();
      if (this.dark()) {
        await this.io.picture(-1);
        await this.sysmess(0);
      } else {
        const first = !this.visited.has(here);
        this.visited.add(here);
        const draw = l.pic >= 0 && (this.graphic === 2 || (this.graphic === 0 && first));
        if (draw && f[F.MODE] === 0) {
          await this.io.picture(l.pic, true);     // a pantalla completa
          await this.io.key();
          await this.io.cls();
        } else if (draw) await this.io.picture(l.pic);
        if (l.text) await this.out(l.text);
      }
      await this.runTable(1);
    }

    // PAW: las banderas 5 a 10 bajan en cada vuelta de leer frase
    tickFlags() {
      const f = this.flags, dark = f[F.DARK] !== 0;
      for (let i = 5; i <= 8; i++) if (f[i]) f[i]--;
      if (dark && f[9]) f[9]--;
      if (dark && f[10] && !this.isPresent(0)) f[10]--;
    }
    async prompt() {
      const p = this.flags[F.PROMPT];
      if (p) { await this.sysmess(p); return; }
      const r = Math.random() * 100;
      await this.sysmess(r < 30 ? 2 : r < 60 ? 3 : r < 90 ? 4 : 5);
    }

    incTurns() {
      const f = this.flags;
      if (++f[F.TURNS_LO] > 255) { f[F.TURNS_LO] = 0; f[F.TURNS_HI]++; }
    }

    /** Un turno: procesa una frase ya analizada */
    async turn() {
      const f = this.flags;
      this.incTurns();
      const did = await this.runTable(0);
      if (did) return;
      // Movimiento por la tabla de conexiones (PAW: los números por debajo de 14 son movimientos)
      const conn = (this.db.conns[this.here()] || []).find(([d]) => d === f[F.VERB]);
      if (conn) { f[F.LOC] = conn[1]; throw new Signal('desc'); }
      if (f[F.VERB] < 14) await this.sysmess(7);
      else await this.sysmess(8);
    }

    async run() {
      for (;;) {
        this.reset();
        try {
          await this.loop();
        } catch (e) {
          if (!(e instanceof Signal) || e.kind !== 'restart') throw e;
        }
      }
    }

    async loop() {
      let describe = true;
      for (;;) {
        try {
          if (describe) { describe = false; await this.describe(); }
          await this.runTable(2);
          // Siguiente frase (de la misma orden o una nueva)
          let parsed = false;
          while (!parsed) {
            this.tickFlags();
            if (!this.sentences.length) {
              await this.prompt();
              const line = await this.io.input(false);
              this.sentences = this.splitInput(line);
              if (!this.sentences.length) { await this.sysmess(6); continue; }
            }
            parsed = this.parseSentence(this.sentences.shift());
            if (!parsed) { this.sentences = []; await this.sysmess(6); }
          }
          await this.turn();
        } catch (e) {
          if (!(e instanceof Signal)) throw e;
          if (e.kind === 'desc') { describe = true; this.sentences = []; continue; }
          if (e.kind === 'end') {
            this.sentences = [];
            await this.sysmess(13);
            const k = normalize(await this.io.input(true));
            if (k.startsWith(normalize(this.sys(31).trim()[0] || 'N'))) {
              // en el Spectrum se acababa aquí; en la página se vuelve a empezar
              await this.sysmess(14);
              await this.io.anykey(this.sys(16).replace(/^\s+/, ''));
            }
            await this.io.cls();
            throw new Signal('restart');
          }
          throw e;
        }
      }
    }
  }

  const api = { Engine, normalize, F, L };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PAW = api;
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * Pantalla ZX Spectrum para el motor PAW: 256x192 píxeles, atributos de 8x8
 * (ink/paper/bright/flash, con su "color clash"), borde y la fuente del juego.
 * Es la del remake del Quijote; aquí los dibujos llegan ya pintados (mapas de
 * bits sacados del Spectrum) y la zona del dibujo tiene las filas que diga la
 * base de datos (db.config.picRows).
 */
(function (root) {
  'use strict';

  const W = 256, H = 192, COLS = 32, ROWS = 24;
  let PIC_ROWS = 12;                 // filas de caracteres para la imagen (las fija la base de datos)
  let PH = PIC_ROWS * 8;             // alto de la zona gráfica en píxeles
  let TOP = PIC_ROWS;                // primera fila de la ventana de texto
  const PAL = [
    [0, 0, 0], [0, 0, 0xD7], [0xD7, 0, 0], [0xD7, 0, 0xD7],
    [0, 0xD7, 0], [0, 0xD7, 0xD7], [0xD7, 0xD7, 0], [0xD7, 0xD7, 0xD7],
  ];
  const PALB = PAL.map(c => c.map(v => (v ? 0xFF : 0)));

  // Caracteres españoles -> posición en la fuente original de 1989
  const CHARMAP = { 'á': '@', 'é': '#', 'í': '$', 'ó': '%', 'ú': '&', '¡': '[', 'Ñ': '\\',
    '¿': ']', '«': '^', '»': '`', 'ü': '{', 'ñ': '|', 'ç': '~', '©': '\x7f',
    'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ü': 'U', '—': '-', '…': '.' };

  class Screen {
    constructor(canvas, borderEl, font, db, inputEl) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.img = this.ctx.createImageData(W, H);
      this.borderEl = borderEl;
      this.font = font;
      this.db = db;
      PIC_ROWS = db.config.picRows || 12; PH = PIC_ROWS * 8; TOP = PIC_ROWS;
      this.bitmaps = [];
      this.inputEl = inputEl;
      this.px = new Uint8Array(W * H);
      this.ink = new Uint8Array(COLS * ROWS).fill(7);
      this.paper = new Uint8Array(COLS * ROWS);
      this.bright = new Uint8Array(COLS * ROWS);
      this.flash = new Uint8Array(COLS * ROWS);
      this.dirty = true;
      this.frame = 0;
      this.resetText();
      this.waiters = [];          // promesas esperando tecla/orden
      this.line = '';
      this.mode = null;           // 'input' | 'key' | null
      this.setupInput();
      const tick = () => {
        this.frame++;
        if (this.frame % 20 === 0) this.dirty = true;   // parpadeo FLASH / cursor
        if (this.dirty) this.render();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    // top: primera fila de la ventana de texto. Con dibujo es la 12; tras un
    // CLS el texto usa toda la pantalla hasta que se vuelve a pintar un dibujo.
    resetText(top = TOP) {
      this.top = top;
      this.col = 0; this.row = top;
      this.tInk = 7; this.tPaper = 0; this.tBright = 0; this.tFlash = 0;
      this.scrolled = 0;          // líneas completas desde la última pausa (para "más")
    }

    // ------------------------------------------------------------ render
    render() {
      const d = this.img.data, fl = (this.frame >> 4) & 1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const a = (y >> 3) * COLS + (x >> 3);
          let on = this.px[y * W + x];
          if (this.flash[a] && fl) on = !on;
          const pal = this.bright[a] ? PALB : PAL;
          const c = pal[on ? this.ink[a] : this.paper[a]];
          const i = (y * W + x) * 4;
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        }
      }
      // cursor de entrada
      if (this.mode === 'input' && fl) {
        const a = this.row * COLS + this.col;
        const c = PALB[5];
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          if (y < 6) continue;
          const i = (((this.row * 8 + y) * W) + this.col * 8 + x) * 4;
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
        }
      }
      this.ctx.putImageData(this.img, 0, 0);
      this.dirty = false;
    }

    border(n) { this.borderEl.style.backgroundColor = `rgb(${PAL[n & 7].join(',')})`; }

    // ------------------------------------------------------------ texto
    glyph(ch) {
      const u = ch.charCodeAt(0);
      // caracteres gráficos del juego (UDG, bloques): U+E000 + código del Spectrum
      if (u >= 0xe000 && u < 0xe100 && this.db.graphics && this.db.graphics[u - 0xe000]) return this.db.graphics[u - 0xe000];
      ch = CHARMAP[ch] || ch;
      let c = ch.charCodeAt(0);
      if (c < 32 || c > 127) c = 63;
      return this.font.slice((c - 32) * 8, (c - 32) * 8 + 8);
    }
    putChar(ch, row, col, ink = this.tInk, paper = this.tPaper, bright = this.tBright, flash = this.tFlash) {
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
      const g = this.glyph(ch);
      for (let y = 0; y < 8; y++) {
        const b = g[y];
        for (let x = 0; x < 8; x++) this.px[(row * 8 + y) * W + col * 8 + x] = (b >> (7 - x)) & 1;
      }
      const a = row * COLS + col;
      this.ink[a] = ink; this.paper[a] = paper; this.bright[a] = bright; this.flash[a] = flash;
      this.dirty = true;
    }
    clearRows(r0, r1) {
      for (let r = r0; r <= r1; r++) {
        this.px.fill(0, r * 8 * W, (r + 1) * 8 * W);
        for (let c = 0; c < COLS; c++) {
          const a = r * COLS + c;
          this.ink[a] = 7; this.paper[a] = 0; this.bright[a] = 0; this.flash[a] = 0;
        }
      }
      this.dirty = true;
    }
    scrollText() {
      const top = this.top;
      this.px.copyWithin(top * 8 * W, (top + 1) * 8 * W);
      for (const arr of [this.ink, this.paper, this.bright, this.flash])
        arr.copyWithin(top * COLS, (top + 1) * COLS);
      this.clearRows(ROWS - 1, ROWS - 1);
      if (this.echo) this.echo.row--;
    }
    async newline() {
      this.col = 0;
      this.row++;
      if (this.row >= ROWS) {
        this.row = ROWS - 1;
        this.scrollText();
      }
      // "más": cuando las líneas sin leer llenan la ventana menos una, se para
      // antes de que la primera se vaya por arriba. El aviso va en la última
      // línea, que en ese momento está vacía. (Antes solo se contaban las
      // líneas que hacían subir el texto, y tras un CLS se perdían las primeras.)
      this.scrolled++;
      if (this.scrolled >= ROWS - this.top - 1) await this.more();
    }
    async more() {
      for (let c = 0; c < COLS; c++) this.putChar(' ', ROWS - 1, c, 0, 0, 0, 0);
      const t = '  . . .  ';
      for (let i = 0; i < t.length; i++) this.putChar(t[i], ROWS - 1, 23 + i, 5, 0, 1, 0);
      this.putChar('`', ROWS - 1, 31, 6, 0, 1, 1);
      await this.waitKey();
      this.clearRows(ROWS - 1, ROWS - 1);
      this.scrolled = 0;
    }
    /** Imprime texto con ajuste por palabras y códigos de color */
    async print(text) {
      let i = 0;
      while (i < text.length) {
        const ch = text[i];
        if (ch === '\x10' || ch === '\x11' || ch === '\x12' || ch === '\x13') {
          const v = +text[i + 1];
          if (!(v >= 0 && v <= 7)) { i += 2; continue; }
          if (ch === '\x10') this.tInk = v; else if (ch === '\x11') this.tPaper = v;
          else if (ch === '\x12') this.tFlash = v; else this.tBright = v;
          i += 2; continue;
        }
        if (ch === '\n') { await this.newline(); this.wrapped = false; i++; continue; }
        if (ch === ' ') {
          // tras un salto automático no se pintan espacios al principio de línea
          if (this.col >= COLS) { await this.newline(); this.wrapped = true; }
          else if (!(this.col === 0 && this.wrapped)) {
            this.putChar(' ', this.row, this.col); this.col++;
            if (this.col >= COLS) { await this.newline(); this.wrapped = true; }
          }
          i++; continue;
        }
        // palabra completa
        let j = i;
        while (j < text.length && !' \n\x10\x11\x12\x13'.includes(text[j])) j++;
        const word = text.slice(i, j);
        if (this.col + word.length > COLS && this.col > 0 && word.length <= COLS) { await this.newline(); this.wrapped = true; }
        for (const c of word) {
          if (this.col >= COLS) { await this.newline(); this.wrapped = true; }
          this.putChar(c, this.row, this.col); this.col++;
        }
        this.wrapped = false;
        i = j;
      }
    }
    async cls() {
      this.clearRows(0, ROWS - 1);
      this.resetText(0);
    }
    /** Borra la ventana de texto (debajo del dibujo), como PAW al describir */
    async clearText() {
      if (this.top === 0) this.clearRows(0, ROWS - 1);
      else this.clearRows(TOP, ROWS - 1);
      this.resetText(TOP);
    }

    // ------------------------------------------------------------ teclado
    setupInput() {
      const el = this.inputEl;
      el.addEventListener('input', () => {
        if (this.mode === 'key') { el.value = ''; this.resolveKey(); return; }
        if (this.mode !== 'input') { el.value = ''; return; }
        let v = el.value.replace(/[\r\n]/g, '');
        if (v.length > 60) { v = v.slice(0, 60); el.value = v; }
        this.line = v;
        this.redrawEcho();
      });
      el.addEventListener('keydown', e => {
        if (this.mode === 'key') { e.preventDefault(); this.resolveKey(); return; }
        if (e.key === 'Enter' && this.mode === 'input') {
          e.preventDefault();
          const line = this.line;
          el.value = ''; this.line = '';
          const w = this.waiters.shift();
          this.mode = null;
          if (w) w(line);
        }
      });
      const focus = () => { el.focus({ preventScroll: true }); };
      this.canvas.parentElement.addEventListener('pointerdown', () => {
        if (this.mode === 'key') this.resolveKey();
        setTimeout(focus, 0);
      });
      document.addEventListener('keydown', e => {
        if (document.activeElement !== el && !e.metaKey && !e.ctrlKey) {
          if (this.mode === 'key') { e.preventDefault(); this.resolveKey(); }
          focus();
        }
      });
      focus();
    }
    resolveKey() {
      const w = this.waiters.shift();
      this.mode = null;
      if (w) w();
    }
    waitKey() {
      this.mode = 'key';
      this.dirty = true;
      return new Promise(r => this.waiters.push(r));
    }
    redrawEcho() {
      const e = this.echo;
      // borra lo escrito antes
      for (let k = 0; k < e.len; k++) {
        const p = e.col + k, r = e.row + Math.floor(p / COLS);
        if (r < ROWS) this.putChar(' ', r, p % COLS, 7, 0, 0, 0);
      }
      const s = this.line.toUpperCase();
      for (let k = 0; k < s.length; k++) {
        const p = e.col + k, r = e.row + Math.floor(p / COLS);
        if (r < ROWS) this.putChar(s[k], r, p % COLS, 7, 0, 1, 0);
      }
      e.len = s.length;
      const p = e.col + s.length;
      this.row = Math.min(ROWS - 1, e.row + Math.floor(p / COLS));
      this.col = p % COLS;
      this.dirty = true;
    }
    async input() {
      if (this.col > 0) await this.newline();
      // deja sitio para dos líneas de orden
      while (this.row > ROWS - 2) { this.scrollText(); this.row--; }
      this.tInk = 7; this.tPaper = 0; this.tBright = 0; this.tFlash = 0;
      this.putChar('>', this.row, 0, 5, 0, 1, 0);
      this.col = 1;
      this.echo = { row: this.row, col: 1, len: 0 };
      this.line = '';
      this.inputEl.value = '';
      this.mode = 'input';
      this.dirty = true;
      const line = await new Promise(r => this.waiters.push(r));
      this.redrawEcho();
      this.echo = null;
      await this.newline();
      this.scrolled = 0;
      return line;
    }
    async anykey(prompt) {
      if (this.col > 0) await this.newline();
      const r0 = this.row;
      await this.print('\x105\x131' + prompt + '\x107\x130');
      await this.waitKey();
      // borra el aviso
      this.clearRows(Math.min(r0, this.row), this.row);
      this.row = Math.min(r0, this.row); this.col = 0;
      this.scrolled = 0;
    }
    pause(ms) { return new Promise(r => setTimeout(r, Math.min(ms, 4000))); }
    store(key, value) {
      try {
        if (value === undefined) return localStorage.getItem(key);
        localStorage.setItem(key, value); return true;
      } catch (e) { return value === undefined ? null : false; }
    }

    // ------------------------------------------------------------ gráficos
    picture(n, full = false) {
      if (full) { this.drawPicture(n, ROWS); return; }
      // tras un CLS el texto ocupa toda la pantalla: antes de pintar se baja a
      // su ventana (con una pausa si hay líneas sin leer que va a tapar el dibujo)
      if (this.top === 0) return this.toTextWindow().then(() => this.drawPicture(n));
      this.drawPicture(n);
    }
    async toTextWindow() {
      const H = ROWS - TOP;
      // si hay más líneas sin leer de las que caben en la ventana de texto,
      // pausa antes de que el dibujo tape las de arriba
      if (this.scrolled + (this.col > 0 ? 1 : 0) > H) {
        if (this.col > 0) await this.newline();
        if (this.scrolled > 0) await this.more();
      }
      const used = this.col > 0 ? this.row + 1 : this.row;     // filas con texto
      const n = Math.min(used, H), from = used - n;
      if (n > 0 && from !== TOP) {
        this.px.copyWithin(TOP * 8 * W, from * 8 * W, (from + n) * 8 * W);
        for (const arr of [this.ink, this.paper, this.bright, this.flash]) arr.copyWithin(TOP * COLS, from * COLS, (from + n) * COLS);
      }
      if (TOP + n <= ROWS - 1) this.clearRows(TOP + n, ROWS - 1);
      this.row = Math.min(ROWS - 1, TOP + (this.col > 0 ? n - 1 : n));
      this.top = TOP;
      this.scrolled = 0;
    }
    drawPicture(n, rows = PIC_ROWS) {
      this.clearRows(0, rows - 1);
      const p = n >= 0 && this.db.pics[n];
      if (!p) return;
      if (!this.bitmaps[n]) {
        const dec = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
        this.bitmaps[n] = { px: dec(p.px), at: dec(p.at) };
      }
      const { px, at } = this.bitmaps[n];
      for (let y = 0; y < rows * 8; y++) for (let c = 0; c < COLS; c++) {
        const b = px[y * COLS + c];
        for (let k = 0; k < 8; k++) this.px[y * W + c * 8 + k] = (b >> (7 - k)) & 1;
      }
      for (let a = 0; a < rows * COLS; a++) {
        const v = at[a];
        this.ink[a] = v & 7; this.paper[a] = (v >> 3) & 7; this.bright[a] = (v >> 6) & 1; this.flash[a] = (v >> 7) & 1;
      }
      this.dirty = true;
    }
  }

  root.SpectrumScreen = Screen;
})(window);

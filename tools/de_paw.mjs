// Saca la base de datos de un juego de PAW (instantánea .z80 o .sna de 48K)
// y la deja como la espera el motor del remake del Quijote (src/engine.js):
// vocabulario, localidades, objetos, mensajes, mensajes del sistema,
// conexiones y procesos tal cual estaban en PAW (mismos números, mismos
// condactos). Los dibujos se pintan con el código de Rocinante, que copia la
// rutina de PAW, y van como mapa de bits: salen igual que en el Spectrum.
//
// Uso: node tools/de_paw.mjs juego.z80 build/juego.json [--listado build/juego.txt]
// Necesita las fuentes de Rocinante (por defecto en ../rocinante; o ROCINANTE=ruta).
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const ROC = process.env.ROCINANTE || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../rocinante');
const roc = (p) => import(pathToFileURL(path.join(ROC, p)).href);
const { readSnapshot } = await roc('src/spectrum/z80read.js');
const { importPAW } = await roc('src/paw/import.js');
const { numberPictures } = await roc('src/project/compile.js');
const { paint } = await roc('src/gfx/vector.js');
const { defaultCharset } = await roc('src/spectrum/zxexport.js');

const args = process.argv.slice(2);
const listIdx = args.indexOf('--listado');
const listFile = listIdx >= 0 ? args.splice(listIdx, 2)[1] : null;
const [inFile, outFile] = args;
const bytes = new Uint8Array(fs.readFileSync(inFile));

// ------------------------------------------------------------------ memoria
const snap = readSnapshot(bytes, inFile);
if (snap.banks) throw new Error('Solo juegos de 48K');
const m = snap.ram;
const w = (a) => m[a] | (m[a + 1] << 8);
const P = {
  proc: w(0xffd9), objd: w(0xffdb), locd: w(0xffdd), msg: w(0xffdf), sys: w(0xffe1), conn: w(0xffe3),
  voc: w(0xffe5), oloc: w(0xffe7), owords: w(0xffe9), oattr: w(0xffeb),
};
const MT = w(0xfffd);
const hasHeader = MT >= 0x5c00 && MT < 0xfe00 && m[MT + 325] > 0;
const [nObj, nLoc, nMsg, nSys, nProc] = hasHeader ? [324, 325, 326, 327, 328].map((o) => m[MT + o])
  : [m[0xfffa], m[0xfffb], m[0xfff8], m[0xfff9], m[0xfffc]];

// Condactos de PAW: nombre y número de parámetros (por código)
const PAW = [['AT', 1], ['NOTAT', 1], ['ATGT', 1], ['ATLT', 1], ['PRESENT', 1], ['ABSENT', 1], ['WORN', 1], ['NOTWORN', 1],
  ['CARRIED', 1], ['NOTCARR', 1], ['CHANCE', 1], ['ZERO', 1], ['NOTZERO', 1], ['EQ', 2], ['GT', 2], ['LT', 2],
  ['ADJECT1', 1], ['ADVERB', 1], ['INVEN', 0], ['DESC', 0], ['QUIT', 0], ['END', 0], ['DONE', 0], ['OK', 0],
  ['ANYKEY', 0], ['SAVE', 0], ['LOAD', 0], ['TURNS', 0], ['SCORE', 0], ['CLS', 0], ['DROPALL', 0], ['AUTOG', 0],
  ['AUTOD', 0], ['AUTOW', 0], ['AUTOR', 0], ['PAUSE', 1], ['TIMEOUT', 0], ['GOTO', 1], ['MESSAGE', 1], ['REMOVE', 1],
  ['GET', 1], ['DROP', 1], ['WEAR', 1], ['DESTROY', 1], ['CREATE', 1], ['SWAP', 2], ['PLACE', 2], ['SET', 1],
  ['CLEAR', 1], ['PLUS', 2], ['MINUS', 2], ['LET', 2], ['NEWLINE', 0], ['PRINT', 1], ['SYSMESS', 1], ['ISAT', 2],
  ['COPYOF', 2], ['COPYOO', 2], ['COPYFO', 2], ['COPYFF', 2], ['LISTOBJ', 0], ['EXTERN', 1], ['RAMSAVE', 0],
  ['RAMLOAD', 1], ['BEEP', 2], ['PAPER', 1], ['INK', 1], ['BORDER', 1], ['PREP', 1], ['NOUN2', 1], ['ADJECT2', 1],
  ['ADD', 2], ['SUB', 2], ['PARSE', 0], ['LISTAT', 1], ['PROCESS', 1], ['SAME', 2], ['MES', 1], ['CHARSET', 1],
  ['NOTEQ', 2], ['NOTSAME', 2], ['MODE', 2], ['LINE', 1], ['TIME', 2], ['PICTURE', 1], ['DOALL', 1], ['PROMPT', 1],
  ['GRAPHIC', 1], ['ISNOTAT', 2], ['WEIGH', 2], ['PUTIN', 2], ['TAKEOUT', 2], ['NEWTEXT', 0], ['ABILITY', 2],
  ['WEIGHT', 1], ['RANDOM', 1], ['INPUT', 1], ['SAVEAT', 0], ['BACKAT', 0], ['PRINTAT', 2], ['WHATO', 0],
  ['RESET', 1], ['PUTO', 1], ['NOTDONE', 0], ['AUTOP', 1], ['AUTOT', 1], ['MOVE', 1], ['PROTECT', 0]];
const WORD_TYPES = ['verbo', 'adverbio', 'nombre', 'adjetivo', 'preposición', 'conjunción', 'pronombre'];

// ------------------------------------------------------------------ textos
// XOR FFh, terminan en 1Fh; desde el 164 son abreviaturas
const chars = w(23606);
const tokBase = hasHeader ? w(MT + 332) + 1 : chars + 0x401;
const tokens = [];
for (let i = 0, a = tokBase; i < 92; i++) {
  let s = '';
  for (;;) { const c = m[a++]; s += String.fromCharCode(c & 0x7f); if (c & 0x80) break; }
  tokens.push(s);
}
const rawText = (a) => {
  const out = [];
  for (let n = 0; n < 4000; n++) {
    const c = m[a++] ^ 0xff;
    if (c === 0x1f) break;
    if (c >= 164) for (const ch of tokens[c - 164]) out.push(ch.charCodeAt(0)); else out.push(c);
  }
  return out;
};
// Convenio de los PAW en castellano: símbolos con forma de letra acentuada
const ES_MAP = { '@': 'á', '#': 'é', '$': 'í', '%': 'ó', '&': 'ú', '[': '¡', '\\': 'Ñ', ']': '¿', '^': '«', '`': '»', '{': 'ü', '|': 'ñ', '~': 'ç' };
// Texto para el motor: acentos en Unicode, colores con los códigos del motor
// (\x10 tinta, \x11 papel, \x12 parpadeo, \x13 brillo) y los caracteres
// gráficos (127 a 163) en la zona de uso privado (U+E000 + código)
const usedGraphics = new Set();
const clean = (codes) => {
  let s = '';
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 7 || c === 13) { s += '\n'; continue; }
    if (c >= 16 && c <= 19) { s += String.fromCharCode(c) + String(codes[i + 1]); i++; continue; }
    if (c === 20 || c === 21) { i++; continue; }        // INVERSE, OVER
    if (c === 22 || c === 23) { i += 2; continue; }     // AT, TAB
    if (c < 32) continue;
    if (c >= 127 && c < 164) { usedGraphics.add(c); s += String.fromCharCode(0xe000 + c); continue; }
    const ch = String.fromCharCode(c);
    s += ES_MAP[ch] ?? ch;
  }
  return s;
};
const tbl = (base, n) => Array.from({ length: n }, (_, i) => clean(rawText(w(base + 2 * i))));
const locs = tbl(P.locd, nLoc), objText = tbl(P.objd, nObj), msgs = tbl(P.msg, nMsg), sys = tbl(P.sys, nSys);

// ------------------------------------------------------------------ vocabulario
const vocab = [];      // [palabra, número, tipo]
for (let a = P.voc; m[a] !== 0 && vocab.length < 2000; a += 7) {
  let word = '';
  for (let k = 0; k < 5; k++) { const ch = String.fromCharCode(m[a + k] ^ 0xff); word += ES_MAP[ch] ? ES_MAP[ch].toUpperCase() : ch; }
  word = word.trim().normalize('NFD').replace(/[́̈]/g, '').normalize('NFC');   // sin tildes (el motor las quita)
  if (m[a + 6] > 6 || !word) continue;
  vocab.push([word, m[a + 5], m[a + 6]]);
}

// ------------------------------------------------------------------ conexiones, objetos
const conns = [];
for (let l = 0; l < nLoc; l++) {
  const list = [];
  for (let a = w(P.conn + 2 * l); m[a] !== 0xff && list.length < 64; a += 2) list.push([m[a], m[a + 1]]);
  conns.push(list);
}
const objs = [];
for (let o = 0; o < nObj; o++) {
  const at = m[P.oattr + o];
  objs.push({ text: objText[o], loc: m[P.oloc + o], noun: m[P.owords + 2 * o], adj: m[P.owords + 2 * o + 1],
    w: at & 0x3f, cont: !!(at & 0x40), wear: !!(at & 0x80) });
}

// ------------------------------------------------------------------ procesos
const procs = [];
for (let p = 0; p < nProc; p++) {
  const table = [];
  for (let a = w(P.proc + 2 * p); m[a] !== 0 && table.length < 2000; a += 4) {
    const e = { v: m[a], n: m[a + 1], c: [] };
    for (let c = w(a + 2), k = 0; m[c] !== 0xff && k < 200; k++) {
      const def = PAW[m[c]];
      if (!def) throw new Error(`Condacto desconocido ${m[c]} en el proceso ${p}`);
      e.c.push([def[0], ...m.subarray(c + 1, c + 1 + def[1])]);
      c += 1 + def[1];
    }
    table.push(e);
  }
  procs.push(table);
}

// ------------------------------------------------------------------ fuente
// La fuente con la que empieza el juego (la 0 de la base de datos o la de la ROM)
const font = hasHeader ? (m[MT + 329] > 0 ? w(MT + 330) : 0x3d00) : chars + 256;
const romFont = defaultCharset();
const fontBytes = font === 0x3d00 ? [...romFont.subarray(256, 1024)] : [...m.subarray(font, font + 768)];
// caracteres gráficos que usan los textos: UDG (144-163), bloques (128-143) y © (127)
const udg = hasHeader ? MT : w(23675);
const graphics = {};
for (const c of usedGraphics) {
  let g;
  if (c >= 144) g = [...m.subarray(udg + (c - 144) * 8, udg + (c - 144) * 8 + 8)];
  else if (c >= 128) {
    const b = c - 128, top = (b & 2 ? 0xf0 : 0) | (b & 1 ? 0x0f : 0), bot = (b & 8 ? 0xf0 : 0) | (b & 4 ? 0x0f : 0);
    g = [top, top, top, top, bot, bot, bot, bot];
  } else g = fontBytes.slice(95 * 8, 96 * 8);
  graphics[c] = g;
}

// ------------------------------------------------------------------ dibujos
// Rocinante los pasa a cadenas de DAAD (casi el mismo formato) y los pinta con
// la rutina de PAW. Aquí se guardan ya pintados: filas de arriba de la pantalla.
const { project } = importPAW(bytes, path.basename(inFile));
const picRows = project.settings.textTop ?? 12;
const cs = project.settings.charset ? Uint8Array.from(atob(project.settings.charset), (c) => c.charCodeAt(0)) : defaultCharset();
const { slots } = numberPictures(project);
const lib = slots.map((x) => (x?.drawstring ? { data: x.drawstring } : null));
const rowAddr = (y) => ((y & 0xc0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);
const pics = [];
const b64 = (u) => Buffer.from(u).toString('base64');
for (const pic of project.pictures || []) {
  if (!Number.isInteger(pic.number) || pic.number >= nLoc) continue;
  // la pantalla entera: en el modo 0 de PAW el dibujo la ocupa toda; en los
  // demás se ven solo las filas de arriba (picRows)
  const { mem } = paint(lib, pic.number, { ...pic, line: 0, height: 24 }, { charset: cs });
  const px = new Uint8Array(192 * 32), at = new Uint8Array(24 * 32);
  for (let y = 0; y < 192; y++) px.set(mem.subarray(rowAddr(y), rowAddr(y) + 32), y * 32);
  at.set(mem.subarray(6144, 6144 + 24 * 32));
  pics[pic.number] = { px: b64(px), at: b64(at), loc: pic.location };
}
// PAW: el bit 7 del atributo del dibujo dice si es de localidad (se pinta al
// describirla); los demás solo con PICTURE
const locPic = locs.map((_, i) => (pics[i]?.loc ? i : -1));

const db = {
  config: { start: 0, maxobj: 4, maxweight: 10, maxscore: 100, lang: 'es', paw: true, picRows, save: path.basename(outFile, '.json') },
  vocab, locs: locs.map((text, i) => ({ text, pic: locPic[i] })), conns, objs, msgs, sys, procs,
  pics: pics.map((p) => (p ? { px: p.px, at: p.at } : null)),
  font: fontBytes, graphics,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(db));
console.log(`${outFile}: ${nLoc} localidades, ${nObj} objetos, ${nMsg} mensajes, ${nSys} del sistema, ${nProc} procesos, ` +
  `${pics.filter(Boolean).length} dibujos (${picRows} filas), ${vocab.length} palabras, ${usedGraphics.size} caracteres gráficos`);

// ------------------------------------------------------------------ listado legible
if (listFile) {
  const wname = (n, t) => vocab.find(([, v, tt]) => v === n && (t == null || tt === t))?.[0] ?? (n === 255 || n === 1 ? '_' : n);
  const L = [];
  L.push('== VOCABULARIO');
  for (const [wd, n, t] of vocab) L.push(`${String(n).padStart(3)} ${WORD_TYPES[t].padEnd(12)} ${wd}`);
  L.push('', '== LOCALIDADES');
  locs.forEach((t, i) => L.push(`${i} [dibujo ${locPic[i]}] ${JSON.stringify(t)}`, `   salidas: ${conns[i].map(([v, d]) => `${wname(v)}->${d}`).join(' ')}`));
  L.push('', '== OBJETOS');
  objs.forEach((o, i) => L.push(`${i} en ${o.loc} ${wname(o.noun, 2)} ${wname(o.adj, 3)} peso ${o.w}${o.cont ? ' contenedor' : ''}${o.wear ? ' prenda' : ''}: ${JSON.stringify(o.text)}`));
  L.push('', '== MENSAJES');
  msgs.forEach((t, i) => L.push(`${i} ${JSON.stringify(t)}`));
  L.push('', '== SISTEMA');
  sys.forEach((t, i) => L.push(`${i} ${JSON.stringify(t)}`));
  procs.forEach((tb, p) => {
    L.push('', `== PROCESO ${p}`);
    for (const e of tb) {
      L.push(`> ${wname(e.v, 0) === e.v ? wname(e.v) : wname(e.v, 0)} ${wname(e.n, 2)}`);
      for (const c of e.c) L.push(`    ${c.join(' ')}`);
    }
  });
  fs.writeFileSync(listFile, L.join('\n') + '\n');
}

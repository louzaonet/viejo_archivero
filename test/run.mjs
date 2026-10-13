// Arnés de pruebas: juega una lista de órdenes contra el motor y vuelca la transcripción.
// Uso: node test/run.mjs build/archivero.json test/solucion.txt [--quiet]
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { Engine } = require('../src/engine.js');

const [dbPath, solPath, ...opts] = process.argv.slice(2);
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const cmds = fs.readFileSync(solPath, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
const strip = (s) => s.replace(/[\x10-\x13]./g, '').replace(/[-]/g, '#');

let out = '', i = 0, ended = null;
class Stop extends Error {}
const io = {
  print: (s) => { out += strip(s); },
  cls: () => { out += '\n[CLS]\n'; },
  clearText: () => { out += '\n'; },
  picture: (n, full) => { out += n >= 0 ? `[DIBUJO ${n}${full ? ' A PANTALLA COMPLETA' : ''}]\n` : ''; },
  key: () => { out += '[TECLA]\n'; },
  input: (yesno) => {
    if (yesno) { ended = out.slice(-700); throw new Stop(); }
    if (i >= cmds.length) throw new Stop();
    const c = cmds[i++];
    out += `\n> ${c.toUpperCase()}\n`;
    return c;
  },
  anykey: () => { out += '[TECLA]\n'; },
  pause: () => {}, border: () => {}, store: () => null,
};
const eng = new Engine(db, io);
try { await eng.run(); } catch (e) { if (!(e instanceof Stop)) throw e; }
if (!opts.includes('--quiet')) console.log(out);
const bad = out.split('\n> ').slice(1).filter((b) => /No te entiendo|No puedes ir|No es necesario|No hay de eso|No tengo eso|No puedo/.test(b))
  .map((b) => b.split('\n').slice(0, 3).join(' / '));
console.log('\n==== RESUMEN ====');
console.log(`Órdenes: ${i}/${cmds.length}. Localidad final: ${eng.flags[38]}. Turnos: ${eng.flags[31] + 256 * eng.flags[32]}`);
if (ended) console.log('FIN DE PARTIDA:\n' + ended);
if (bad.length) console.log('Respuestas de error:\n  ' + bad.join('\n  '));

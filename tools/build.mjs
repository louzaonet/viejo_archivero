// Saca la base de datos del juego de PAW y monta index.html: el juego entero
// en una sola página, con el motor y la pantalla del remake del Quijote.
// Uso: node tools/build.mjs [juego.z80]
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const R = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const z80 = process.argv[2] || path.join(R, 'viejo_archivero.z80');
const dbf = path.join(R, 'build/archivero.json');
execFileSync(process.execPath, [path.join(R, 'tools/de_paw.mjs'), z80, dbf, '--listado', path.join(R, 'build/archivero.txt')], { stdio: 'inherit' });

const db = JSON.parse(fs.readFileSync(dbf, 'utf8'));
const UI = {
  title: 'El Viejo Archivero',
  screen: 'Pantalla de la aventura',
  input: 'Escribe tu orden y pulsa Enter',
  help: 'Pulsa una tecla para pasar la presentación. Escribe y pulsa <kbd>Enter</kbd>; en el móvil, toca la pantalla. Prueba <kbd>AYUDA</kbd>, ' +
    '<kbd>SALIDAS</kbd>, <kbd>I</kbd>, <kbd>GRABA</kbd>, <kbd>CARGA</kbd>.',
  credits: '(c) Aventuras Level 10 · The Thunderstorm Brothers · 1988',
};
let t = fs.readFileSync(path.join(R, 'tools/template.html'), 'utf8');
const put = (k, v) => { t = t.split(k).join(v); };
put('/*__ENGINE__*/', fs.readFileSync(path.join(R, 'src/engine.js'), 'utf8'));
put('/*__SCREEN__*/', fs.readFileSync(path.join(R, 'src/screen.js'), 'utf8'));
put('/*__DB__*/null', JSON.stringify(db).replace(/<\//g, '<\\/'));
for (const [k, v] of Object.entries(UI)) put('{{' + k + '}}', v);
const full = '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  '</head>\n<body style="margin:0">\n' + t + '\n</body>\n</html>\n';
fs.writeFileSync(path.join(R, 'index.html'), full);
// la misma página sin cabecera, para publicarla como artefacto en claude.ai
fs.writeFileSync(path.join(R, 'build/archivero-artefacto.html'), t);
console.log('index.html', Math.round(full.length / 1024), 'KB');

# El Viejo Archivero

Aventura conversacional de Aventuras Level 10 (1988), hecha con el PAW en castellano para el ZX Spectrum. Esta es la versión para el navegador: `index.html` es el juego entero en una sola página y se abre con doble clic o se sube tal cual a una web.

## Cómo está hecha

No es un remake: es el juego original. `tools/de_paw.mjs` lee la instantánea del Spectrum (`viejo_archivero.z80`) y saca la base de datos de PAW tal cual: vocabulario, localidades, objetos, mensajes, conexiones y procesos, con los mismos números y los mismos condactos. Los dibujos se pintan con el código de Rocinante, que copia la rutina de PAW, y van como mapas de bits, así que salen como en el Spectrum. La fuente de letra también es la del juego.

El motor (`src/engine.js`) y la pantalla (`src/screen.js`) son los del remake de *Don Quijote de la Mancha* (Aventuras Level 10, 1989), ajustados para hacer lo que hacía el intérprete de PAW: la oscuridad y el objeto 0 como luz, las banderas que bajan solas, la bandera de objetos que se llevan, NOTDONE, GRAPHIC y MODE (la presentación a pantalla completa), la lista de objetos línea a línea, el texto del objeto sin punto en los mensajes del sistema y RAMSAVE/RAMLOAD, que sobreviven a una partida nueva.

Lo que no se puede hacer igual en una página web: GRABA y CARGA guardan la partida en el navegador en lugar de en cinta, y al terminar se vuelve a empezar en vez de salir al BASIC.

## Construir y probar

Hace falta Node 18 o posterior y las fuentes de Rocinante al lado (`../rocinante`, o la ruta en la variable `ROCINANTE`).

```
node tools/build.mjs                                          # build/archivero.json, index.html
node test/run.mjs build/archivero.json test/solucion.txt      # juega la solución en Node
python3 tools/e2e.py                                          # la juega en Chromium (Playwright) y guarda capturas
```

`build/archivero.txt` es un listado legible de la base de datos (vocabulario, textos y procesos). `test/solucion.txt` tiene la solución completa.

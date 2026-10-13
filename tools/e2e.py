"""Juega la solución en Chromium sobre index.html y guarda capturas.
Uso: python3 tools/e2e.py [carpeta_capturas]"""
import sys, os
from playwright.sync_api import sync_playwright
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/archivero_e2e'
os.makedirs(OUT, exist_ok=True)
cmds = [l.split('#')[0].strip() for l in open(f'{R}/test/solucion.txt', encoding='utf-8')]
cmds = [c for c in cmds if c]
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 900, 'height': 760})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type in ('error', 'warning') else None)
    pg.goto('file://' + R + '/index.html')
    pg.wait_for_timeout(500)
    pg.locator('.tv').screenshot(path=f'{OUT}/00_titulo.png')
    pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
    pg.locator('.tv').screenshot(path=f'{OUT}/01_inicio.png')
    shots = {'n', 'coge llave', 'abre puerta con llave', 'corta ala con espada', 'saca grafistas', 'dar aventura al viejo', 'coge papiro', 'sal'}
    for k, c in enumerate(cmds):
        pg.keyboard.type(c); pg.keyboard.press('Enter'); pg.wait_for_timeout(120)
        # pausas de "más" y teclas: se pulsa espacio mientras la pantalla espere
        for _ in range(4):
            if pg.evaluate('window.__screen.mode') == 'key': pg.keyboard.press('Space'); pg.wait_for_timeout(100)
        if c in shots: pg.locator('.tv').screenshot(path=f'{OUT}/{k + 2:02d}_{c.replace(" ", "_")}.png'); shots.discard(c)
    pg.wait_for_timeout(300)
    pg.locator('.tv').screenshot(path=f'{OUT}/99_final.png')
    b.close()
print('errores:', errors)

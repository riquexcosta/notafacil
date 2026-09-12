/** Renderiza os diagramas SVG em PNG de alta resolução para o artigo. */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const DESTINO = path.join(process.cwd(), 'capturas', 'diagramas');
fs.mkdirSync(DESTINO, { recursive: true });

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
});
const pagina = await navegador.newPage({ deviceScaleFactor: 3 });
await pagina.goto(pathToFileURL(path.join(process.cwd(), 'capturas', 'diagramas.html')).href, {
  waitUntil: 'networkidle'
});

for (const id of ['casos-de-uso', 'modelo-dados', 'arquitetura']) {
  await pagina.locator(`#${id}`).screenshot({ path: path.join(DESTINO, `${id}.png`) });
  console.log(`  ✓ ${id}.png`);
}

await navegador.close();

/**
 * Recortes de elementos específicos, em proporção larga, para inserção no artigo.
 * Requer a API (3333) e o front (5173) em execução, com a base recém-populada.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const DESTINO = path.join(process.cwd(), 'capturas', 'recortes');
const BASE = 'http://localhost:5173';
const CHAVE = '25260907526557000100650010000099911555123458';
fs.mkdirSync(DESTINO, { recursive: true });

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
});
const contexto = await navegador.newContext({
  viewport: { width: 1240, height: 950 },
  deviceScaleFactor: 2,
  locale: 'pt-BR',
  timezoneId: 'America/Recife'
});
const pagina = await contexto.newPage();

async function recortar(seletor, nome, indice = 0) {
  await pagina.mouse.move(4, 4);
  await pagina.waitForTimeout(700);
  await pagina.locator(seletor).nth(indice).screenshot({ path: path.join(DESTINO, `${nome}.png`) });
  console.log(`  ✓ ${nome}.png`);
}

await pagina.goto(`${BASE}/entrar`, { waitUntil: 'networkidle' });
await pagina.click('button[type="submit"]');
await pagina.waitForURL('**/painel');
await pagina.waitForSelector('table');

// Indicadores + gráfico de gasto mensal
await recortar('.grade.grade-4', 'painel-indicadores');
await recortar('.grade.grade-2-1', 'painel-graficos');

// Resultado da leitura: cartão da nota com a comparação item a item
await pagina.click('text=Ler nota fiscal');
await pagina.waitForSelector('#chave');
await pagina.fill('#chave', CHAVE);
await pagina.click('button:has-text("Consultar nota")');
await pagina.waitForSelector('.aviso.sucesso', { timeout: 15000 });
await recortar('.cartao:has(.cabecalho-nota)', 'comparacao-itens');
await recortar('.cartao:has(.painel-chave)', 'chave-interpretada');

// Evolução do preço de um produto recorrente
await pagina.click('text=Produtos');
await pagina.waitForSelector('button:has-text("Só recorrentes")');
await pagina.click('button:has-text("Só recorrentes")');
await pagina.waitForTimeout(800);
await pagina.click('table tbody tr:first-child a');
await pagina.waitForSelector('text=Evolução do preço unitário');
await recortar('.cartao:has-text("Evolução do preço unitário")', 'evolucao-preco');
await recortar('.grade.grade-4', 'produto-indicadores');

await navegador.close();
console.log(`\nRecortes salvos em ${DESTINO}`);

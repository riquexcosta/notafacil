/**
 * Captura as telas do NotaFácil para a documentação do TCC.
 * Requer a API (porta 3333) e o front (porta 5173) em execução.
 *
 *   node capturas/capturar.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const DESTINO = path.join(process.cwd(), 'capturas', 'telas');
const BASE = 'http://localhost:5173';
fs.mkdirSync(DESTINO, { recursive: true });

const CHAVE_DEMONSTRACAO = '25260907526557000100650010000099911555123458';

async function capturar(pagina, nome) {
  await pagina.mouse.move(4, 4); // evita tooltips congelados sob o ponteiro
  await pagina.waitForTimeout(900);
  await pagina.screenshot({ path: path.join(DESTINO, `${nome}.png`), fullPage: true });
  console.log(`  ✓ ${nome}.png`);
}

const navegador = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
});
const contexto = await navegador.newContext({
  viewport: { width: 1360, height: 900 },
  deviceScaleFactor: 2,
  locale: 'pt-BR',
  timezoneId: 'America/Recife'
});
const pagina = await contexto.newPage();

console.log('Capturando telas:');

// 1. Autenticação
await pagina.goto(`${BASE}/entrar`, { waitUntil: 'networkidle' });
await capturar(pagina, '01-autenticacao');

// 2. Painel
await pagina.click('button[type="submit"]');
await pagina.waitForURL('**/painel');
await pagina.waitForSelector('table');
await capturar(pagina, '02-painel');

// 3. Leitura — entrada da chave de acesso
await pagina.click('text=Ler nota fiscal');
await pagina.waitForSelector('#chave');
await pagina.fill('#chave', CHAVE_DEMONSTRACAO);
await capturar(pagina, '03-leitura-chave');

// 4. Resultado da leitura com comparação de preços
await pagina.click('button:has-text("Consultar nota")');
await pagina.waitForSelector('.aviso.sucesso', { timeout: 10000 });
await capturar(pagina, '04-comparacao-precos');

// 5. Modo câmera
await pagina.click('button.opcao-leitura:has-text("Câmera")');
await pagina.waitForTimeout(1200);
await capturar(pagina, '05-leitura-camera');

// 6. Histórico de notas
await pagina.click('text=Histórico de notas');
await pagina.waitForSelector('table tbody tr');
await capturar(pagina, '06-historico-notas');

// 7. Detalhe da nota
await pagina.click('table tbody tr:nth-child(2) a');
await pagina.waitForSelector('text=Itens e comparação de preços');
await capturar(pagina, '07-detalhe-nota');

// 8. Busca de produtos
await pagina.click('text=Produtos');
await pagina.waitForSelector('#ncm');
await pagina.fill('#ncm', '04');
await pagina.click('button:has-text("Buscar")');
await pagina.waitForTimeout(700);
await capturar(pagina, '08-busca-produtos');

// 9. Histórico e variação de preço de um produto
await pagina.click('button:has-text("Só recorrentes")');
await pagina.waitForTimeout(700);
await pagina.click('table tbody tr:first-child a');
await pagina.waitForSelector('text=Evolução do preço unitário');
await capturar(pagina, '09-variacao-produto');

// 10. Estabelecimentos
await pagina.click('text=Estabelecimentos');
await pagina.waitForSelector('text=Produtos em');
await capturar(pagina, '10-estabelecimentos');

await navegador.close();
console.log(`\nTelas salvas em ${DESTINO}`);

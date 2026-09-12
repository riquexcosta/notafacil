/**
 * Sonda da API Infosimples (SEFAZ/PB/NFC-e): faz UMA consulta real e grava a
 * resposta bruta em data/infosimples-amostra.json, usada para mapear os campos
 * do provedor. A pasta data/ não vai para o Git.
 *
 * Uso: npm run sonda:infosimples -- <chave de acesso ou URL do QR Code>
 * Cada execução consome uma requisição da conta (o saldo de teste permite 50).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_API = 'https://api.infosimples.com/api/v2/consultas/sefaz/pb/nfce';
const token = process.env.INFOSIMPLES_TOKEN;
const nfce = process.argv[2];

if (!token) {
  console.error('Defina INFOSIMPLES_TOKEN em server/.env (veja .env.example).');
  process.exit(1);
}
if (!nfce) {
  console.error('Uso: npm run sonda:infosimples -- <chave de acesso ou URL do QR Code>');
  process.exit(1);
}

const resposta = await fetch(URL_API, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ token, timeout: '300', nfce }),
  signal: AbortSignal.timeout(320_000)
});
const texto = await resposta.text();

const destino = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'infosimples-amostra.json');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, texto);

console.log(`HTTP ${resposta.status} — resposta gravada em ${destino}`);
try {
  const json = JSON.parse(texto);
  console.log(`code ${json.code}: ${json.code_message}`);
  console.log('cobrada:', json.header?.billable, '| preço:', json.header?.price);
  console.log('campos de data[0]:', Object.keys(json.data?.[0] ?? {}).join(', ') || '(vazio)');
  if (json.errors?.length) console.log('erros:', json.errors.join(' | '));
} catch {
  console.log(texto.slice(0, 500));
}

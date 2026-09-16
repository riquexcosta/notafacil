/**
 * Sonda da API Infosimples: faz UMA consulta real de NFC-e, de qualquer UF, e
 * grava a resposta anonimizada em data/infosimples-amostras/, usada para
 * conferir o formato de cada serviço. Mostra também a nota já convertida.
 *
 * Uso: npm run sonda:infosimples -- <chave de acesso ou URL do QR Code>
 * Cada execução consome uma consulta paga da conta (R$ 0,20 a R$ 0,26 conforme a UF).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extrairChave, validarChave } from '../src/domain/chaveAcesso.js';
import { criarGravadorDeAmostras } from '../src/domain/nfe/amostrasInfosimples.js';
import { ProvedorInfosimples } from '../src/domain/nfe/provedores.js';

const token = process.env.INFOSIMPLES_TOKEN?.trim();
const chave = extrairChave(process.argv[2]);

if (!token) {
  console.error('Defina INFOSIMPLES_TOKEN em server/.env (veja .env.example).');
  process.exit(1);
}
if (!chave || !validarChave(chave)) {
  console.error('Uso: npm run sonda:infosimples -- <chave de acesso válida ou URL do QR Code>');
  process.exit(1);
}

const pasta = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'infosimples-amostras');
const gravar = criarGravadorDeAmostras(pasta);
const provedor = new ProvedorInfosimples({
  token,
  timeoutSegundos: 300,
  registrar: console.log,
  aoResponder: (servico, chaveConsultada, resposta) => {
    gravar(servico, chaveConsultada, resposta);
    console.log(`${servico}: code ${resposta?.code} | cobrada: ${resposta?.header?.billable} | preço: ${resposta?.header?.price}`);
  }
});

try {
  const nota = await provedor.consultar(chave);
  console.log(JSON.stringify(nota, null, 2));
} catch (erro) {
  console.error(`Falha: ${erro.message}`);
  process.exitCode = 1;
}
console.log(`Respostas gravadas em ${pasta}`);

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { calcularDigitoVerificador } from '../src/domain/chaveAcesso.js';
import {
  CadeiaDeProvedores,
  ProvedorConsultaAssistida,
  ProvedorInfosimples
} from '../src/domain/nfe/provedores.js';

// Resposta real do serviço sefaz/pb/nfce, sem os dados da conta consultante.
const AMOSTRA = JSON.parse(
  fs.readFileSync(new URL('./fixtures/infosimples-pb-nfce.json', import.meta.url), 'utf8')
);
const CHAVE = AMOSTRA.data[0].informacoes_nota.chave_acesso;

function criarProvedor(resposta = AMOSTRA) {
  const chamadas = [];
  const fetch = async (url, opcoes) => {
    chamadas.push({ url, corpo: Object.fromEntries(opcoes.body) });
    if (resposta instanceof Error) throw resposta;
    return { json: async () => structuredClone(resposta) };
  };
  const provedor = new ProvedorInfosimples({ token: 'token-de-teste', fetch, registrar: () => {} });
  return { provedor, chamadas };
}

function comDados(alteracao) {
  const resposta = structuredClone(AMOSTRA);
  alteracao(resposta.data[0]);
  return resposta;
}

test('envia o token e a chave ao serviço SEFAZ/PB/NFC-e', async () => {
  const { provedor, chamadas } = criarProvedor();
  await provedor.consultar(CHAVE);
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].url, /\/api\/v2\/consultas\/sefaz\/pb\/nfce$/);
  assert.equal(chamadas[0].corpo.token, 'token-de-teste');
  assert.equal(chamadas[0].corpo.nfce, CHAVE);
});

test('converte a resposta da Infosimples na nota normalizada', async () => {
  const nota = await criarProvedor().provedor.consultar(CHAVE);
  assert.equal(nota.origem, 'infosimples');
  assert.equal(nota.numero, '898');
  assert.equal(nota.serie, '1');
  assert.equal(nota.modelo, '65');
  assert.equal(nota.dataEmissao, '2026-09-10');
  assert.equal(nota.valorTotal, 17.9);
  assert.equal(nota.valorTributos, 8.34);
  assert.equal(nota.emitente.cnpj, '64587757000106');
  assert.equal(nota.emitente.razaoSocial, 'leal material');
  assert.equal(nota.emitente.uf, 'PB');
  assert.equal(nota.itens.length, 2);
  assert.deepEqual(
    nota.itens.map((i) => [i.descricao, i.quantidade, i.valorUnitario, i.valorTotal]),
    [
      ['ESTILETE 18MM', 1, 11.9, 11.9],
      ['PARAFUSO JOMARCA 3,5X25', 20, 0.3, 6]
    ]
  );
});

test('usa o código do produto como EAN apenas quando é um GTIN válido', async () => {
  const nota = await criarProvedor().provedor.consultar(CHAVE);
  assert.equal(nota.itens[0].ean, null); // "CFOP5102"
  assert.equal(nota.itens[1].ean, '7892183539308');

  const digitoErrado = comDados((d) => (d.produtos[1].codigo = '7892183539309'));
  const outra = await criarProvedor(digitoErrado).provedor.consultar(CHAVE);
  assert.equal(outra.itens[1].ean, null);
});

test('aceita a data de emissão no formato brasileiro', async () => {
  const resposta = comDados((d) => (d.informacoes_nota.data_emissao = '10/09/2026'));
  const nota = await criarProvedor(resposta).provedor.consultar(CHAVE);
  assert.equal(nota.dataEmissao, '2026-09-10');
});

test('resposta sem sucesso deixa a cadeia seguir para a consulta assistida', async () => {
  const { provedor } = criarProvedor({ code: 612, code_message: 'Nenhum dado encontrado.', errors: [], data: [] });
  const cadeia = new CadeiaDeProvedores([provedor, new ProvedorConsultaAssistida()]);
  await assert.rejects(cadeia.consultar(CHAVE), { codigo: 'CONSULTA_ASSISTIDA' });
});

test('falha de rede também recai na consulta assistida', async () => {
  const { provedor } = criarProvedor(new Error('fetch failed'));
  const cadeia = new CadeiaDeProvedores([provedor, new ProvedorConsultaAssistida()]);
  await assert.rejects(cadeia.consultar(CHAVE), { codigo: 'CONSULTA_ASSISTIDA' });
});

test('UF sem serviço contratado não gera chamada paga', async () => {
  const base = '35' + '2603' + '07526557000100' + '65' + '001' + '000000001' + '1' + '10000001';
  const { provedor, chamadas } = criarProvedor();
  await assert.rejects(provedor.consultar(base + calcularDigitoVerificador(base)), {
    codigo: 'PROVEDOR_INDISPONIVEL'
  });
  assert.equal(chamadas.length, 0);
});

test('nota cancelada é recusada', async () => {
  const resposta = comDados((d) => (d.cancelada = true));
  await assert.rejects(criarProvedor(resposta).provedor.consultar(CHAVE), (erro) => {
    assert.equal(erro.status, 422);
    assert.match(erro.message, /cancelada/);
    return true;
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { calcularDigitoVerificador } from '../src/domain/chaveAcesso.js';
import {
  CadeiaDeProvedores,
  ProvedorCatalogoLocal,
  ProvedorConsultaAssistida,
  ProvedorSefaz
} from '../src/domain/nfe/provedores.js';

function chaveDaUf(cUF) {
  const base = cUF + '2603' + '07526557000100' + '65' + '001' + '000000001' + '1' + '10000001';
  return base + calcularDigitoVerificador(base);
}

const CHAVE_PB = chaveDaUf('25');

test('consulta assistida da PB por chave aponta para o portal oficial', async () => {
  await assert.rejects(new ProvedorConsultaAssistida().consultar(CHAVE_PB), (erro) => {
    assert.equal(erro.codigo, 'CONSULTA_ASSISTIDA');
    assert.equal(erro.status, 422);
    assert.equal(erro.urlConsulta, `https://www.sefaz.pb.gov.br/nfce?p=${CHAVE_PB}`);
    return true;
  });
});

test('consulta assistida preserva a URL oficial lida do QR Code', async () => {
  const conteudoQr = `https://www.sefaz.pb.gov.br/nfce?p=${CHAVE_PB}|2|1|1|ABCDEF0123`;
  await assert.rejects(
    new ProvedorConsultaAssistida().consultar(CHAVE_PB, { conteudoQr }),
    (erro) => erro.urlConsulta === new URL(conteudoQr).href
  );
});

test('consulta assistida descarta URLs fora de portais oficiais', async () => {
  for (const conteudoQr of [
    `https://exemplo.com/nfce?p=${CHAVE_PB}`,
    `javascript:alert(1)//${CHAVE_PB}`
  ]) {
    await assert.rejects(
      new ProvedorConsultaAssistida().consultar(CHAVE_PB, { conteudoQr }),
      (erro) => erro.urlConsulta === `https://www.sefaz.pb.gov.br/nfce?p=${CHAVE_PB}`
    );
  }
});

test('UF sem portal cadastrado orienta apenas a importação do XML', async () => {
  await assert.rejects(new ProvedorConsultaAssistida().consultar(chaveDaUf('35')), (erro) => {
    assert.equal(erro.codigo, 'CONSULTA_ASSISTIDA');
    assert.equal(erro.urlConsulta, null);
    assert.match(erro.message, /SP/);
    return true;
  });
});

test('fora do modo demonstração a cadeia não gera dados sintéticos', async () => {
  const cadeia = new CadeiaDeProvedores([new ProvedorSefaz(), new ProvedorConsultaAssistida()]);
  await assert.rejects(cadeia.consultar(CHAVE_PB), { codigo: 'CONSULTA_ASSISTIDA' });
});

test('no modo demonstração a cadeia recai sobre o catálogo local', async () => {
  const cadeia = new CadeiaDeProvedores([new ProvedorSefaz(), new ProvedorCatalogoLocal()]);
  const nota = await cadeia.consultar(CHAVE_PB);
  assert.equal(nota.origem, 'demo');
  assert.equal(nota.chave, CHAVE_PB);
});

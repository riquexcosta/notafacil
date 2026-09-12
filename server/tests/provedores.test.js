import test from 'node:test';
import assert from 'node:assert/strict';

import { calcularDigitoVerificador } from '../src/domain/chaveAcesso.js';
import {
  CadeiaDeProvedores,
  ProvedorCatalogoLocal,
  ProvedorSefaz
} from '../src/domain/nfe/provedores.js';

function chaveDaUf(cUF) {
  const base = cUF + '2603' + '07526557000100' + '65' + '001' + '000000001' + '1' + '10000001';
  return base + calcularDigitoVerificador(base);
}

const CHAVE_PB = chaveDaUf('25');

test('sem a SEFAZ disponível, a cadeia recai sobre o catálogo local', async () => {
  const cadeia = new CadeiaDeProvedores([new ProvedorSefaz(), new ProvedorCatalogoLocal()]);
  const nota = await cadeia.consultar(CHAVE_PB);
  assert.equal(nota.origem, 'demo');
  assert.equal(nota.chave, CHAVE_PB);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularDigitoVerificador,
  extrairChave,
  interpretarChave,
  validarChave,
  formatarCnpj
} from '../src/domain/chaveAcesso.js';

// Chave construída a partir dos campos do MOC 7.0 (NFC-e da Paraíba)
const BASE43 = '25' + '2603' + '07526557000100' + '65' + '001' + '000001001' + '1' + '10137137';
const CHAVE = BASE43 + calcularDigitoVerificador(BASE43);

test('a chave montada tem 44 dígitos', () => {
  assert.equal(CHAVE.length, 44);
});

test('valida a chave com dígito verificador correto', () => {
  assert.ok(validarChave(CHAVE));
});

test('rejeita chave com dígito verificador adulterado', () => {
  const adulterada = CHAVE.slice(0, 43) + ((Number(CHAVE[43]) + 1) % 10);
  assert.equal(validarChave(adulterada), false);
});

test('rejeita chave com quantidade de dígitos incorreta', () => {
  assert.equal(validarChave('123'), false);
  assert.equal(validarChave(null), false);
});

test('extrai a chave da URL do QR Code da NFC-e', () => {
  const url = `https://www.sefaz.pb.gov.br/nfce/consulta?p=${CHAVE}|2|1|1|abc123`;
  assert.equal(extrairChave(url), CHAVE);
});

test('extrai a chave do parâmetro chNFe', () => {
  assert.equal(extrairChave(`http://exemplo.gov.br/consulta?chNFe=${CHAVE}&tpAmb=1`), CHAVE);
});

test('extrai a chave digitada com separadores', () => {
  const digitada = CHAVE.match(/.{1,4}/g).join(' ');
  assert.equal(extrairChave(digitada), CHAVE);
});

test('devolve nulo quando não há chave no conteúdo lido', () => {
  assert.equal(extrairChave('https://exemplo.com/pagina'), null);
});

test('interpreta os campos da chave conforme o layout do MOC', () => {
  const dados = interpretarChave(CHAVE);
  assert.equal(dados.uf, 'PB');
  assert.equal(dados.cnpjEmitente, '07526557000100');
  assert.equal(dados.descricaoModelo, 'NFC-e');
  assert.equal(dados.serie, '1');
  assert.equal(dados.numero, '1001');
  assert.equal(dados.anoMesEmissao, '2026-03');
});

test('formata o CNPJ com máscara', () => {
  assert.equal(formatarCnpj('07526557000100'), '07.526.557/0001-00');
});

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Base isolada em disco temporário — os testes não tocam a base de desenvolvimento.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notafacil-')), 'teste.db');

const { db } = await import('../src/db/index.js');
const { calcularDigitoVerificador } = await import('../src/domain/chaveAcesso.js');
const { importarNota } = await import('../src/services/notaService.js');
const { normalizarDescricao } = await import('../src/services/produtoService.js');
const { ProvedorXmlAutorizado } = await import('../src/domain/nfe/provedores.js');

const CNPJ = '07526557000100';

function chaveValida(numero) {
  const base =
    '25' + '2603' + CNPJ + '65' + '001' + String(numero).padStart(9, '0') + '1' + '10000001';
  return base + calcularDigitoVerificador(base);
}

const emitente = {
  cnpj: CNPJ,
  razaoSocial: 'SUPERMERCADO BOM PRECO LTDA',
  nomeFantasia: 'Bom Preço',
  municipio: 'João Pessoa',
  uf: 'PB'
};

function nota(numero, dataEmissao, valorUnitario) {
  const item = {
    ean: '7891000100103',
    ncm: '04021010',
    descricao: 'LEITE INTEGRAL UHT 1L',
    unidade: 'UN',
    quantidade: 2,
    valorUnitario,
    valorTotal: Number((valorUnitario * 2).toFixed(2)),
    valorTributos: 0
  };
  return {
    chave: chaveValida(numero),
    numero: String(numero),
    serie: '1',
    modelo: '65',
    dataEmissao,
    valorTotal: item.valorTotal,
    valorTributos: 0,
    emitente,
    origem: 'qrcode',
    itens: [item]
  };
}

let usuarioId;

before(() => {
  usuarioId = Number(
    db
      .prepare('INSERT INTO usuario (nome, email, senha_hash) VALUES (?, ?, ?)')
      .run('Teste', 'teste@notafacil.app', 'x').lastInsertRowid
  );
});

test('recusa a mesma chave de acesso duas vezes', () => {
  importarNota(usuarioId, nota(1, '2026-03-10', 5.0));
  assert.throws(() => importarNota(usuarioId, nota(1, '2026-03-10', 5.0)), /já consta/i);
});

test('normaliza descrições para comparação quando não há EAN', () => {
  assert.equal(normalizarDescricao('Café Torrado  e Moído 500g'), 'CAFE TORRADO E MOIDO 500G');
});

test('o provedor de XML extrai emitente e itens do documento autorizado', async () => {
  const chave = chaveValida(9);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe Id="NFe${chave}" versao="4.00">
  <ide><nNF>9</nNF><serie>1</serie><mod>65</mod><dhEmi>2026-07-01T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>${CNPJ}</CNPJ><xNome>SUPERMERCADO BOM PRECO LTDA</xNome><xFant>Bom Preço</xFant>
    <enderEmit><xLgr>Av. Teste</xLgr><nro>10</nro><xMun>João Pessoa</xMun><UF>PB</UF></enderEmit></emit>
  <det nItem="1"><prod><cEAN>7891000100103</cEAN><xProd>LEITE INTEGRAL UHT 1L</xProd>
    <NCM>04021010</NCM><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>5.9900</vUnCom><vProd>11.98</vProd></prod>
    <imposto><vTotTrib>2.16</vTotTrib></imposto></det>
  <total><ICMSTot><vNF>11.98</vNF><vTotTrib>2.16</vTotTrib></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

  const resultado = await new ProvedorXmlAutorizado().consultarPorXml(xml);
  assert.equal(resultado.chave, chave);
  assert.equal(resultado.emitente.cnpj, CNPJ);
  assert.equal(resultado.origem, 'xml');
  assert.equal(resultado.itens.length, 1);
  assert.equal(resultado.itens[0].valorUnitario, 5.99);
  assert.equal(resultado.itens[0].ean, '7891000100103');
});

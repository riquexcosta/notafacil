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

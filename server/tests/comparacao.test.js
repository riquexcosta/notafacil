import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Base isolada em disco temporário — os testes não tocam a base de desenvolvimento.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notafacil-')), 'teste.db');

const { normalizarDescricao } = await import('../src/services/produtoService.js');

test('normaliza descrições para comparação quando não há EAN', () => {
  assert.equal(normalizarDescricao('Café Torrado  e Moído 500g'), 'CAFE TORRADO E MOIDO 500G');
});

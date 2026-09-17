import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Base isolada: cada arquivo de teste roda em processo próprio.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notafacil-vinculos-')), 'teste.db');

const { db } = await import('../src/db/index.js');
const { calcularDigitoVerificador } = await import('../src/domain/chaveAcesso.js');
const { normalizarGtin } = await import('../src/domain/gtin.js');
const { excluirNota, importarNota, obterNota } = await import('../src/services/notaService.js');
const { detalharProduto } = await import('../src/services/produtoService.js');
const { exportarDados } = await import('../src/services/contaService.js');
const { desvincularProduto, semelhancaDescricoes, sugerirVinculos, vincularProdutos } = await import(
  '../src/services/vinculoService.js'
);

let numero = 0;
function chave(cnpj) {
  numero += 1;
  const base = '25' + '2609' + cnpj + '65' + '001' + String(numero).padStart(9, '0') + '1' + '10000001';
  return base + calcularDigitoVerificador(base);
}

const loja = (cnpj, nome) => ({ cnpj, razaoSocial: nome, nomeFantasia: null, municipio: 'João Pessoa', uf: 'PB' });
const ATACADO = loja('20300157008043', 'NOVO ATACADO COMERCIO DE ALIMENTOS S.A');
const POSTO = loja('02561589000122', 'POSTO EXPRESSAO COMBUSTIVEIS E CONVENIENCIA LTDA');

// Descrições reais das duas notas: o portal da SEFAZ-PB não informa o GTIN.
const COCA_ATACADO = { ean: null, ncm: null, descricao: 'REF COCA COLA S ACUCAR LT 350ML', unidade: 'UN' };
const COCA_POSTO = { ean: null, ncm: null, descricao: 'COCA COLA ZERO LATA 350 ML', unidade: 'UN' };
const COCA_COMUM = { ean: null, ncm: null, descricao: 'COCA COLA LATA 350ML', unidade: 'UN' };

function nota(emitente, dataEmissao, itens) {
  const linhas = itens.map(([produto, valorUnitario]) => ({
    ...produto,
    quantidade: 1,
    valorUnitario,
    valorTotal: valorUnitario,
    valorTributos: 0
  }));
  return {
    chave: chave(emitente.cnpj),
    numero: String(numero),
    serie: '1',
    modelo: '65',
    dataEmissao,
    horaEmissao: '12:00:00',
    valorTotal: linhas.reduce((s, l) => s + l.valorTotal, 0),
    valorTributos: 0,
    emitente,
    origem: 'infosimples',
    itens: linhas
  };
}

function novoUsuario(email) {
  return Number(
    db.prepare('INSERT INTO usuario (nome, email, senha_hash) VALUES (?, ?, ?)').run(email, email, 'x').lastInsertRowid
  );
}

/* ------------------------------------------------------------------ GTIN */

test('GTIN: aceita EAN-8/13 válidos e tira zeros à esquerda', () => {
  assert.equal(normalizarGtin('7894900700046'), '7894900700046');
  assert.equal(normalizarGtin('07894900700046'), '7894900700046');
  assert.equal(normalizarGtin('96385074'), '96385074');
});

test('GTIN: código interno completado com zeros não vale, mesmo com dígito verificador válido', () => {
  assert.equal(normalizarGtin('0000000007379'), null); // caso real da Benfica Hortifrut
  assert.equal(normalizarGtin('11956'), null);
  assert.equal(normalizarGtin('SEM GTIN'), null);
  assert.equal(normalizarGtin('7894900700047'), null); // dígito errado
});

/* ------------------------------------------------------------ semelhança */

test('a Coca sem açúcar do atacado e a Coca Zero do posto são sugeridas como o mesmo produto', () => {
  const { pontuacao, comuns, medida } = semelhancaDescricoes(COCA_ATACADO.descricao, COCA_POSTO.descricao);
  assert.ok(pontuacao >= 0.5);
  assert.equal(medida, '350ML');
  assert.deepEqual(comuns.sort(), ['COCA', 'COLA', 'LATA', 'ZERO']);
});

test('versões ou medidas diferentes nunca são sugeridas', () => {
  assert.equal(semelhancaDescricoes('COCA COLA LATA 350ML', 'COCA COLA ZERO LATA 350ML').pontuacao, 0);
  assert.equal(semelhancaDescricoes('COCA COLA 1,5L', 'COCA COLA 2L').pontuacao, 0);
  assert.equal(semelhancaDescricoes('LEITE INTEGRAL 1L', 'LEITE DESNATADO 1L').pontuacao, 0);
  assert.equal(semelhancaDescricoes('COCA COLA 2L', 'REFRIG COCA COLA 2 LITROS').pontuacao >= 0.5, true);
});

/* ------------------------------------------------------------- vínculos */

test('vincular junta as compras, recalcula preços e vale para notas importadas depois', () => {
  const usuario = novoUsuario('vinculo@teste.dev');
  const notaAtacado = importarNota(usuario, nota(ATACADO, '2026-09-10', [[COCA_ATACADO, 3.85], [COCA_COMUM, 3.99]]));
  const notaPosto = importarNota(usuario, nota(POSTO, '2026-09-12', [[COCA_POSTO, 5.1]]));

  const idAtacado = db.prepare('SELECT id FROM produto WHERE descricao = ?').get(COCA_ATACADO.descricao).id;
  const idPosto = db.prepare('SELECT id FROM produto WHERE descricao = ?').get(COCA_POSTO.descricao).id;
  const idComum = db.prepare('SELECT id FROM produto WHERE descricao = ?').get(COCA_COMUM.descricao).id;

  const sugestoes = sugerirVinculos(usuario, idAtacado);
  assert.deepEqual(sugestoes.map((s) => s.id), [idPosto]); // a Coca comum não aparece
  assert.match(sugestoes[0].motivo, /350ML/);

  const detalhe = vincularProdutos(usuario, idAtacado, idPosto);
  assert.equal(detalhe.estatisticas.compras, 2);
  assert.deepEqual(detalhe.ofertas.map((o) => o.valorUnitario), [3.85, 5.1]);
  assert.deepEqual(detalhe.vinculados.map((v) => v.id), [idPosto]);
  assert.equal(detalharProduto(usuario, idPosto), null);
  assert.equal(sugerirVinculos(usuario, idAtacado).length, 0);

  // Nova compra no posto: o produto resolvido pela descrição entra no de destino.
  const nova = importarNota(usuario, nota(POSTO, '2026-09-14', [[COCA_POSTO, 5.5]]));
  const item = obterNota(usuario, nova).itens[0];
  assert.equal(item.produtoId, idAtacado);
  assert.equal(item.situacao, 'aumento'); // comparada com a compra anterior do mesmo produto
  assert.equal(detalharProduto(usuario, idAtacado).estatisticas.compras, 3);

  // Excluir as notas do posto não apaga a regra do vínculo.
  excluirNota(usuario, notaPosto);
  excluirNota(usuario, nova);
  assert.ok(db.prepare('SELECT 1 FROM produto WHERE id = ?').get(idPosto));
  assert.equal(detalharProduto(usuario, idAtacado).estatisticas.compras, 1);
  assert.ok(notaAtacado);
});

test('desvincular devolve as compras ao produto de origem', () => {
  const usuario = novoUsuario('desvincular@teste.dev');
  importarNota(usuario, nota(ATACADO, '2026-09-10', [[COCA_ATACADO, 3.85]]));
  importarNota(usuario, nota(POSTO, '2026-09-12', [[COCA_POSTO, 5.1]]));
  const idAtacado = db.prepare('SELECT id FROM produto WHERE descricao = ?').get(COCA_ATACADO.descricao).id;
  const idPosto = db.prepare('SELECT id FROM produto WHERE descricao = ?').get(COCA_POSTO.descricao).id;

  vincularProdutos(usuario, idAtacado, idPosto);
  const detalhe = desvincularProduto(usuario, idAtacado, idPosto);
  assert.equal(detalhe.estatisticas.compras, 1);
  assert.deepEqual(detalhe.vinculados, []);
  assert.equal(detalharProduto(usuario, idPosto).estatisticas.compras, 1);
  assert.equal(detalharProduto(usuario, idPosto).ofertas[0].valorUnitario, 5.1);
  assert.equal(desvincularProduto(usuario, idAtacado, idPosto), null);
});

test('o vínculo é de cada usuário e as sugestões só usam os produtos dele', () => {
  const ana = novoUsuario('ana@teste.dev');
  const bia = novoUsuario('bia@teste.dev');
  importarNota(ana, nota(ATACADO, '2026-09-10', [[COCA_ATACADO, 3.85]]));
  importarNota(ana, nota(POSTO, '2026-09-12', [[COCA_POSTO, 5.1]]));
  importarNota(bia, nota(POSTO, '2026-09-13', [[COCA_POSTO, 5.2]]));
  const idAtacado = db.prepare('SELECT id FROM produto WHERE descricao = ?').get(COCA_ATACADO.descricao).id;
  const idPosto = db.prepare('SELECT id FROM produto WHERE descricao = ?').get(COCA_POSTO.descricao).id;

  // Bia não comprou no atacado: não recebe a sugestão nem pode vincular.
  assert.deepEqual(sugerirVinculos(bia, idPosto), []);
  assert.throws(() => vincularProdutos(bia, idPosto, idAtacado), { status: 404 });

  vincularProdutos(ana, idAtacado, idPosto);
  assert.equal(detalharProduto(bia, idPosto).estatisticas.compras, 1);
  assert.equal(detalharProduto(bia, idAtacado), null);

  assert.deepEqual(
    exportarDados(ana).vinculosDeProdutos.map((v) => [v.produto, v.mesmoProdutoQue]),
    [[COCA_POSTO.descricao, COCA_ATACADO.descricao]]
  );
  assert.deepEqual(exportarDados(bia).vinculosDeProdutos, []);
});

test('não vincula um produto a ele mesmo', () => {
  const usuario = novoUsuario('mesmo@teste.dev');
  importarNota(usuario, nota(ATACADO, '2026-09-10', [[COCA_ATACADO, 3.85]]));
  const id = db.prepare('SELECT id FROM produto WHERE descricao = ?').get(COCA_ATACADO.descricao).id;
  assert.throws(() => vincularProdutos(usuario, id, id), { status: 422 });
});

test('excluir a conta remove os vínculos e os produtos que só eles mantinham', () => {
  const usuario = novoUsuario('apagar@teste.dev');
  const DESCRICAO_A = 'SUCO UVA INTEGRAL XPTO 1L';
  const DESCRICAO_B = 'SUCO DE UVA XPTO INTEGRAL 1 LT';
  importarNota(usuario, nota(ATACADO, '2026-09-10', [[{ ean: null, ncm: null, descricao: DESCRICAO_A, unidade: 'UN' }, 12]]));
  importarNota(usuario, nota(POSTO, '2026-09-12', [[{ ean: null, ncm: null, descricao: DESCRICAO_B, unidade: 'UN' }, 14]]));
  const a = db.prepare('SELECT id FROM produto WHERE descricao = ?').get(DESCRICAO_A).id;
  const b = db.prepare('SELECT id FROM produto WHERE descricao = ?').get(DESCRICAO_B).id;
  vincularProdutos(usuario, a, b);

  db.prepare('DELETE FROM usuario WHERE id = ?').run(usuario);
  db.prepare(
    `DELETE FROM produto WHERE id NOT IN (SELECT produto_id FROM item_nota)
       AND id NOT IN (SELECT produto_resolvido_id FROM item_nota WHERE produto_resolvido_id IS NOT NULL)
       AND id NOT IN (SELECT produto_origem_id FROM produto_vinculo)
       AND id NOT IN (SELECT produto_destino_id FROM produto_vinculo)`
  ).run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM produto_vinculo WHERE usuario_id = ?').get(usuario).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM produto WHERE id IN (?, ?)').get(a, b).n, 0);
});

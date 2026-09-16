import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Base isolada: cada arquivo de teste roda em processo próprio.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notafacil-metricas-')), 'teste.db');

const { db } = await import('../src/db/index.js');
const { calcularDigitoVerificador } = await import('../src/domain/chaveAcesso.js');
const { excluirNota, importarNota, listarNotas, mesesEntre, obterNota, resumoDoUsuario } = await import(
  '../src/services/notaService.js'
);
const { buscarProdutos, detalharProduto, produtosPorEmpresa, produtosRecorrentes } = await import(
  '../src/services/produtoService.js'
);

let numero = 0;
function chave(cnpj) {
  numero += 1;
  const base = '25' + '2609' + cnpj + '65' + '001' + String(numero).padStart(9, '0') + '1' + '10000001';
  return base + calcularDigitoVerificador(base);
}

const loja = (cnpj, nome) => ({ cnpj, razaoSocial: nome.toUpperCase(), nomeFantasia: nome, municipio: 'João Pessoa', uf: 'PB' });
const ATACADO = loja('11111111000191', 'Atacado');
const SUPERMERCADO = loja('22222222000191', 'Supermercado');
const MERCADINHO = loja('33333333000191', 'Mercadinho');

const LEITE = { ean: '7891000100103', ncm: '04021010', descricao: 'LEITE UHT 1L', unidade: 'UN' };
const ARROZ = { ean: '7896006716112', ncm: '10063021', descricao: 'ARROZ BRANCO 5KG', unidade: 'UN' };
const CAFE = { ean: '7896089011937', ncm: '09012100', descricao: 'CAFÉ TORRADO E MOÍDO 500G', unidade: 'UN' };

function nota(emitente, dataEmissao, itens, { horaEmissao = null, tributos = 0 } = {}) {
  const linhas = itens.map(([produto, quantidade, valorUnitario]) => ({
    ...produto,
    quantidade,
    valorUnitario,
    valorTotal: Number((quantidade * valorUnitario).toFixed(2)),
    valorTributos: 0
  }));
  return {
    chave: chave(emitente.cnpj),
    numero: String(numero),
    serie: '1',
    modelo: '65',
    dataEmissao,
    horaEmissao,
    valorTotal: Number(linhas.reduce((s, l) => s + l.valorTotal, 0).toFixed(2)),
    valorTributos: tributos,
    emitente,
    origem: 'xml',
    itens: linhas
  };
}

function novoUsuario(email) {
  return Number(
    db.prepare('INSERT INTO usuario (nome, email, senha_hash) VALUES (?, ?, ?)').run(email, email, 'x').lastInsertRowid
  );
}

const itemDe = (usuarioId, notaId) => obterNota(usuarioId, notaId).itens[0];

/* ------------------------------------------------- comparação cronológica */

test('uma compra posterior nunca é usada como "preço anterior"', () => {
  const u = novoUsuario('cronologia@teste');
  const antiga = importarNota(u, nota(ATACADO, '2026-09-01', [[LEITE, 1, 10]]));
  const nova = importarNota(u, nota(ATACADO, '2026-09-20', [[LEITE, 1, 12]]));

  const primeiro = itemDe(u, antiga);
  assert.equal(primeiro.situacao, 'novo');
  assert.equal(primeiro.precoAnterior, undefined);

  const segundo = itemDe(u, nova);
  assert.equal(segundo.situacao, 'aumento');
  assert.equal(segundo.precoAnterior, 10);
  assert.equal(segundo.variacaoPercentual, 20);
});

test('importar notas fora de ordem não muda a comparação de cada uma', () => {
  const u = novoUsuario('fora-de-ordem@teste');
  const nova = importarNota(u, nota(ATACADO, '2026-09-20', [[LEITE, 1, 12]]));
  const antiga = importarNota(u, nota(ATACADO, '2026-09-01', [[LEITE, 1, 10]]));

  assert.equal(itemDe(u, antiga).situacao, 'novo');
  assert.equal(itemDe(u, nova).precoAnterior, 10);
});

test('no mesmo dia, a hora de emissão define qual compra veio antes', () => {
  const u = novoUsuario('mesmo-dia@teste');
  // Registrada primeiro, mas emitida mais tarde.
  const tarde = importarNota(u, nota(SUPERMERCADO, '2026-09-10', [[LEITE, 1, 6]], { horaEmissao: '18:00:00' }));
  const manha = importarNota(u, nota(ATACADO, '2026-09-10', [[LEITE, 1, 5]], { horaEmissao: '09:30:00' }));

  assert.equal(itemDe(u, manha).situacao, 'novo');
  const item = itemDe(u, tarde);
  assert.equal(item.precoAnterior, 5);
  assert.equal(item.empresaAnterior, 'Atacado');
});

test('menor preço e economia possível consideram apenas compras anteriores', () => {
  const u = novoUsuario('economia@teste');
  importarNota(u, nota(ATACADO, '2026-09-01', [[LEITE, 1, 4]]));
  const meio = importarNota(u, nota(ATACADO, '2026-09-05', [[LEITE, 2, 5]]));
  importarNota(u, nota(ATACADO, '2026-09-09', [[LEITE, 1, 3]]));

  const item = itemDe(u, meio);
  assert.equal(item.menorPreco, 4); // o preço de 3,00 é de uma compra posterior
  assert.equal(item.economiaPossivel, 2); // (5 − 4) × 2
});

test('o preço médio da comparação é ponderado pela quantidade', () => {
  const u = novoUsuario('media-comparacao@teste');
  importarNota(u, nota(ATACADO, '2026-09-01', [[LEITE, 10, 1]]));
  importarNota(u, nota(ATACADO, '2026-09-02', [[LEITE, 1, 10]]));
  const atual = importarNota(u, nota(ATACADO, '2026-09-03', [[LEITE, 1, 2]]));

  assert.equal(itemDe(u, atual).precoMedio, 1.82); // (10 + 10) / 11
});

/* ------------------------------------------------------ produtos e médias */

test('recorrentes, busca e detalhe usam média ponderada e amplitude', () => {
  const u = novoUsuario('media@teste');
  importarNota(u, nota(ATACADO, '2026-09-01', [[ARROZ, 10, 1]]));
  importarNota(u, nota(SUPERMERCADO, '2026-09-02', [[ARROZ, 1, 10]]));

  const [recorrente] = produtosRecorrentes(u);
  assert.equal(recorrente.precoMedio, 1.82);
  assert.equal(recorrente.amplitudePercentual, 900); // (10 − 1) / 1
  assert.equal(recorrente.totalGasto, 20);

  const [buscado] = buscarProdutos(u, { termo: 'arroz' });
  assert.equal(buscado.precoMedio, 1.82);

  const { estatisticas } = detalharProduto(u, recorrente.id);
  assert.equal(estatisticas.compras, 2);
  assert.equal(estatisticas.precoMedio, 1.82);
  assert.equal(estatisticas.variacaoPercentual, 900); // da primeira à última compra
  assert.equal(estatisticas.amplitudePercentual, 900);
});

test('a busca por descrição ignora acentos e maiúsculas', () => {
  const u = novoUsuario('busca@teste');
  importarNota(u, nota(ATACADO, '2026-09-01', [[CAFE, 1, 18]]));

  assert.equal(buscarProdutos(u, { termo: 'cafe torrado' }).length, 1);
  assert.equal(buscarProdutos(u, { termo: 'CAFÉ' }).length, 1);
  assert.equal(buscarProdutos(u, { termo: 'feijão' }).length, 0);
});

/* ---------------------------------------------------------- isolamento */

test('preços por estabelecimento e detalhe do produto são exclusivos de cada usuário', () => {
  const a = novoUsuario('isolamento-a@teste');
  const b = novoUsuario('isolamento-b@teste');
  importarNota(a, nota(ATACADO, '2026-09-01', [[CAFE, 1, 20]]));
  importarNota(b, nota(MERCADINHO, '2026-09-25', [[CAFE, 1, 15]]));

  const produtoId = produtosRecorrentes(a, 1)[0].id;
  const { ofertas } = detalharProduto(a, produtoId);
  assert.deepEqual(ofertas.map((o) => o.empresa), ['Atacado']);

  const mercadinhoId = db.prepare('SELECT id FROM empresa WHERE cnpj = ?').get(MERCADINHO.cnpj).id;
  assert.equal(produtosPorEmpresa(a, mercadinhoId).length, 0);
  assert.equal(produtosPorEmpresa(b, mercadinhoId).length, 1);

  const outroUsuario = novoUsuario('isolamento-c@teste');
  assert.equal(detalharProduto(outroUsuario, produtoId), null);
});

test('a comparação de uma nota de outro usuário não é devolvida', () => {
  const a = novoUsuario('nota-a@teste');
  const b = novoUsuario('nota-b@teste');
  const notaDeA = importarNota(a, nota(ATACADO, '2026-09-01', [[LEITE, 1, 5]]));

  assert.equal(obterNota(b, notaDeA), null);
});

/* ----------------------------------------------------------- painel */

test('o resumo calcula ticket médio, percentual de tributos e meses sem compra', () => {
  const u = novoUsuario('resumo@teste');
  importarNota(u, nota(ATACADO, '2026-09-10', [[LEITE, 2, 5]], { tributos: 2 })); // 10,00
  importarNota(u, nota(ATACADO, '2026-11-05', [[LEITE, 1, 20]], { tributos: 1 })); // 20,00

  const resumo = resumoDoUsuario(u);
  assert.equal(resumo.totalNotas, 2);
  assert.equal(resumo.totalGasto, 30);
  assert.equal(resumo.ticketMedio, 15);
  assert.equal(resumo.percentualTributos, 10); // 3 / 30
  assert.deepEqual(resumo.gastoPorMes, [
    { mes: '2026-09', total: 10 },
    { mes: '2026-10', total: 0 },
    { mes: '2026-11', total: 20 }
  ]);
  assert.equal(resumo.maioresVariacoes[0].amplitudePercentual, 300); // (20 − 5) / 5
});

test('o resumo de um usuário sem notas não divide por zero', () => {
  const resumo = resumoDoUsuario(novoUsuario('vazio@teste'));
  assert.equal(resumo.ticketMedio, 0);
  assert.equal(resumo.percentualTributos, null);
  assert.deepEqual(resumo.gastoPorMes, []);
});

test('mesesEntre atravessa a virada de ano', () => {
  assert.deepEqual(mesesEntre('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('quantidade e totais do histórico somam todas as notas filtradas, não só as listadas', () => {
  const u = novoUsuario('listagem@teste');
  importarNota(u, nota(ATACADO, '2026-09-01', [[LEITE, 1, 5]], { tributos: 0.5 }));
  importarNota(u, nota(SUPERMERCADO, '2026-09-02', [[LEITE, 1, 7]], { tributos: 0.7 }));

  const todas = listarNotas(u);
  assert.equal(todas.quantidade, 2);
  assert.equal(todas.valorTotal, 12);
  assert.equal(todas.valorTributos, 1.2);

  const filtradas = listarNotas(u, { busca: 'Supermercado' });
  assert.equal(filtradas.quantidade, 1);
  assert.equal(filtradas.valorTotal, 7);
});

/* ---------------------------------------------------------- exclusão */

test('excluir uma nota recalcula o preço da loja e remove produtos sem uso', () => {
  const u = novoUsuario('exclusao@teste');
  const CHA = { ean: '7891000055120', ncm: '09024000', descricao: 'CHA MATE 250G', unidade: 'UN' };
  importarNota(u, nota(ATACADO, '2026-09-01', [[LEITE, 1, 5]]));
  const recente = importarNota(u, nota(ATACADO, '2026-09-15', [[LEITE, 1, 6], [CHA, 1, 9]]));

  const atacadoId = db.prepare('SELECT id FROM empresa WHERE cnpj = ?').get(ATACADO.cnpj).id;
  assert.equal(produtosPorEmpresa(u, atacadoId).find((p) => p.descricao === LEITE.descricao).valorUnitario, 6);

  assert.equal(excluirNota(u, recente), true);
  const precos = produtosPorEmpresa(u, atacadoId);
  assert.equal(precos.find((p) => p.descricao === LEITE.descricao).valorUnitario, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM produto WHERE ean = ?').get(CHA.ean).c, 0);
  assert.equal(excluirNota(u, recente), false);
});

/* ------------------------------------------------------- comparativo */

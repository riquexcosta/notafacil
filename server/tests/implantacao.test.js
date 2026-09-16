import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Base e cliente web isolados: cada arquivo de teste roda em processo próprio.
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'notafacil-implantacao-'));
const cliente = path.join(pasta, 'cliente');
fs.mkdirSync(path.join(cliente, 'assets'), { recursive: true });
fs.writeFileSync(path.join(cliente, 'index.html'), '<!doctype html><title>NotaFácil</title><div id="root"></div>');
fs.writeFileSync(path.join(cliente, 'assets', 'app.js'), 'console.log("ok");');

process.env.DB_PATH = path.join(pasta, 'teste.db');
process.env.CLIENTE_DIR = cliente;
process.env.NODE_ENV = 'test';
process.env.LIMITE_CADASTROS_POR_HORA = '3';

const { app } = await import('../src/index.js');
const { VERSAO_POLITICA } = await import('../src/lgpd/politica.js');
const { cadastroAberto, confiancaNoProxy, limiteDeCadastrosPorHora } = await import('../src/implantacao.js');
const { db } = await import('../src/db/index.js');
const { calcularDigitoVerificador } = await import('../src/domain/chaveAcesso.js');
const { CATALOGO_DEMONSTRACAO } = await import('../src/domain/nfe/catalogoDemonstracao.js');
const { importarNota, resumoDoUsuario } = await import('../src/services/notaService.js');
const { EMAIL_DEMONSTRACAO, restaurarContaDemonstracao } = await import('../src/seed.js');

let servidor;
let origem;

before(() => {
  servidor = app.listen(0);
  origem = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

const cadastro = (email) =>
  fetch(`${origem}/api/auth/cadastro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: 'Avaliador',
      email,
      senha: 'senhaforte1',
      aceitePolitica: true,
      consentimentoDadosSensiveis: true,
      versaoPolitica: VERSAO_POLITICA
    })
  });

test('o cadastro fica aberto por padrão e fecha com CADASTRO_ABERTO=false', () => {
  assert.equal(cadastroAberto({}), true);
  assert.equal(cadastroAberto({ CADASTRO_ABERTO: 'true' }), true);
  assert.equal(cadastroAberto({ CADASTRO_ABERTO: 'false' }), false);
  assert.equal(cadastroAberto({ CADASTRO_ABERTO: ' FALSE ' }), false);
});

test('com o cadastro fechado, a API recusa novas contas e informa o cliente', async () => {
  process.env.CADASTRO_ABERTO = 'false';
  try {
    const recusa = await cadastro('fechado@teste.dev');
    assert.equal(recusa.status, 403);
    assert.match((await recusa.json()).erro, /fechado/);

    const saude = await (await fetch(`${origem}/api/saude`)).json();
    assert.equal(saude.cadastroAberto, false);
  } finally {
    delete process.env.CADASTRO_ABERTO;
  }

  assert.equal((await cadastro('aberto@teste.dev')).status, 201);
  assert.equal((await (await fetch(`${origem}/api/saude`)).json()).cadastroAberto, true);
});

test('a confiança no proxy aceita número de saltos ou nome do Express', () => {
  assert.equal(confiancaNoProxy({}), false);
  assert.equal(confiancaNoProxy({ TRUST_PROXY: '1' }), 1);
  assert.equal(confiancaNoProxy({ TRUST_PROXY: 'loopback' }), 'loopback');
});

test('a API serve o cliente web e devolve o index.html nas rotas do React', async () => {
  const inicio = await fetch(`${origem}/`);
  assert.equal(inicio.status, 200);
  assert.match(await inicio.text(), /id="root"/);

  const rotaDoCliente = await fetch(`${origem}/notas/42`);
  assert.equal(rotaDoCliente.status, 200);
  assert.match(rotaDoCliente.headers.get('content-type'), /text\/html/);

  const arquivo = await fetch(`${origem}/assets/app.js`);
  assert.equal(arquivo.status, 200);
  assert.match(arquivo.headers.get('content-type'), /javascript/);
});

test('rota inexistente da API responde 404 em JSON, e não com o cliente web', async () => {
  const resposta = await fetch(`${origem}/api/nao-existe`);
  assert.equal(resposta.status, 404);
  assert.match(resposta.headers.get('content-type'), /application\/json/);
  assert.ok((await resposta.json()).erro);
});

test('restaurar a conta demo recria só ela e preserva as notas dos outros usuários', () => {
  const primeira = restaurarContaDemonstracao();
  assert.equal(primeira.notas, 41);
  assert.equal(primeira.itens, 207);

  // Outro usuário compra um produto e numa loja que a conta demo também usa.
  const outro = Number(
    db.prepare('INSERT INTO usuario (nome, email, senha_hash) VALUES (?, ?, ?)').run('Outro', 'outro@teste.dev', 'x')
      .lastInsertRowid
  );
  const [loja] = CATALOGO_DEMONSTRACAO.empresas;
  const [produto] = CATALOGO_DEMONSTRACAO.produtos;
  const base = '25' + '2609' + loja.cnpj + '65' + '001' + '000009999' + '1' + '99999999';
  importarNota(outro, {
    chave: base + calcularDigitoVerificador(base),
    numero: '9999',
    serie: '1',
    modelo: '65',
    dataEmissao: '2026-09-15',
    horaEmissao: '10:00:00',
    valorTotal: 12.5,
    valorTributos: 0,
    emitente: loja,
    origem: 'xml',
    itens: [{ ...produto, quantidade: 1, valorUnitario: 12.5, valorTotal: 12.5, valorTributos: 0 }]
  });

  const segunda = restaurarContaDemonstracao();
  assert.notEqual(segunda.usuarioId, primeira.usuarioId);
  assert.equal(segunda.notas, 41);
  assert.equal(segunda.itens, 207);
  // A semente volta ao início: os preços da demo são sempre os mesmos.
  assert.equal(resumoDoUsuario(segunda.usuarioId).totalGasto, 4311.21);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usuario WHERE email = ?').get(EMAIL_DEMONSTRACAO).n, 1);
  const doOutro = resumoDoUsuario(outro);
  assert.equal(doOutro.totalNotas, 1);
  assert.equal(doOutro.totalGasto, 12.5);
});

test('o mesmo IP cria no máximo LIMITE_CADASTROS_POR_HORA contas por hora', async () => {
  assert.equal(limiteDeCadastrosPorHora({}), 5);
  assert.equal(limiteDeCadastrosPorHora({ LIMITE_CADASTROS_POR_HORA: '20' }), 20);
  assert.equal(limiteDeCadastrosPorHora({ LIMITE_CADASTROS_POR_HORA: 'abc' }), 5);

  // Limite 3 neste arquivo; uma conta já foi criada no teste do cadastro aberto.
  assert.equal((await cadastro('segunda@teste.dev')).status, 201);
  assert.equal((await cadastro('terceira@teste.dev')).status, 201);

  const bloqueado = await cadastro('quarta@teste.dev');
  assert.equal(bloqueado.status, 429);
  assert.ok(Number(bloqueado.headers.get('retry-after')) > 0);
  assert.match((await bloqueado.json()).erro, /Muitas contas/);
});

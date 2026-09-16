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

const { app } = await import('../src/index.js');
const { VERSAO_POLITICA } = await import('../src/lgpd/politica.js');
const { cadastroAberto, confiancaNoProxy } = await import('../src/implantacao.js');

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

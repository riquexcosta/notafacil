import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notafacil-lgpd-')), 'teste.db');
process.env.NODE_ENV = 'test';

const { app } = await import('../src/index.js');
const { db } = await import('../src/db/index.js');
const { calcularDigitoVerificador } = await import('../src/domain/chaveAcesso.js');
const { VERSAO_POLITICA } = await import('../src/lgpd/politica.js');
const { criarLimitadorDeLogin, origensPermitidas, resolverSegredoJwt } = await import('../src/seguranca.js');

let servidor;
let base;

before(() => {
  servidor = app.listen(0);
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});
after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

async function chamar(metodo, rota, { token, corpo, tipo = 'application/json' } = {}) {
  const resposta = await fetch(base + rota, {
    method: metodo,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(corpo !== undefined && { 'Content-Type': tipo })
    },
    body: corpo === undefined ? undefined : tipo === 'application/json' ? JSON.stringify(corpo) : corpo
  });
  const texto = await resposta.text();
  return { status: resposta.status, cabecalhos: resposta.headers, dados: texto ? JSON.parse(texto) : null };
}

const cadastroValido = (email) => ({
  nome: 'Titular de Teste',
  email,
  senha: 'senhaforte1',
  aceitePolitica: true,
  consentimentoDadosSensiveis: true,
  versaoPolitica: VERSAO_POLITICA
});

async function criarConta(email) {
  const { status, dados } = await chamar('POST', '/auth/cadastro', { corpo: cadastroValido(email) });
  assert.equal(status, 201);
  return dados;
}

let sequencia = 0;
function xmlDeNota({ cnpj = '07526557000100', cpfConsumidor, preco = 5.99 } = {}) {
  sequencia += 1;
  const semDigito = '25' + '2609' + cnpj + '65' + '001' + String(sequencia).padStart(9, '0') + '1' + '10000001';
  const chave = semDigito + calcularDigitoVerificador(semDigito);
  const destinatario = cpfConsumidor ? `<dest><CPF>${cpfConsumidor}</CPF><xNome>CONSUMIDOR</xNome></dest>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe Id="NFe${chave}" versao="4.00">
  <ide><nNF>${sequencia}</nNF><serie>1</serie><mod>65</mod><dhEmi>2026-09-10T14:25:00-03:00</dhEmi></ide>
  <emit><CNPJ>${cnpj}</CNPJ><xNome>SUPERMERCADO TESTE LTDA</xNome><xFant>Teste</xFant>
    <enderEmit><xLgr>Av. Teste</xLgr><nro>10</nro><xMun>João Pessoa</xMun><UF>PB</UF></enderEmit></emit>
  ${destinatario}
  <det nItem="1"><prod><cEAN>7891000100103</cEAN><xProd>LEITE INTEGRAL UHT 1L</xProd>
    <NCM>04021010</NCM><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>${preco}</vUnCom><vProd>${preco}</vProd></prod>
    <imposto><vTotTrib>1.00</vTotTrib></imposto></det>
  <total><ICMSTot><vNF>${preco}</vNF><vTotTrib>1.00</vTotTrib></ICMSTot></total>
</infNFe></NFe></nfeProc>`;
}

/* ------------------------------------------------ política e consentimento */

test('a política de privacidade é pública e identifica controlador e versão', async () => {
  const { status, dados } = await chamar('GET', '/privacidade');
  assert.equal(status, 200);
  assert.equal(dados.versao, VERSAO_POLITICA);
  assert.equal(dados.controlador.nome, 'Henrique Gonsalves Costa');
  assert.ok(dados.secoes.length >= 8);
});

test('o cadastro exige aceite da política, consentimento específico e versão vigente', async () => {
  const semAceite = { ...cadastroValido('sem-aceite@teste.app'), aceitePolitica: false };
  assert.equal((await chamar('POST', '/auth/cadastro', { corpo: semAceite })).status, 422);

  const semConsentimento = { ...cadastroValido('sem-consentimento@teste.app') };
  delete semConsentimento.consentimentoDadosSensiveis;
  assert.equal((await chamar('POST', '/auth/cadastro', { corpo: semConsentimento })).status, 422);

  const versaoAntiga = { ...cadastroValido('versao-antiga@teste.app'), versaoPolitica: '0.9' };
  assert.equal((await chamar('POST', '/auth/cadastro', { corpo: versaoAntiga })).status, 422);

  const senhaCurta = { ...cadastroValido('senha-curta@teste.app'), senha: '1234567' };
  assert.equal((await chamar('POST', '/auth/cadastro', { corpo: senhaCurta })).status, 422);

  const conta = await criarConta('aceite@teste.app');
  assert.equal(conta.usuario.politicaVersao, VERSAO_POLITICA);
  assert.ok(conta.usuario.politicaAceitaEm);
  assert.equal(conta.usuario.politicaPendente, false);
  assert.equal(conta.usuario.senha_hash, undefined);
});

test('conta com política desatualizada fica pendente até aceitar a versão vigente', async () => {
  const { token, usuario } = await criarConta('pendente@teste.app');
  db.prepare("UPDATE usuario SET politica_versao = '0.9' WHERE id = ?").run(usuario.id);

  assert.equal((await chamar('GET', '/conta', { token })).dados.politicaPendente, true);

  const errada = await chamar('POST', '/conta/politica', {
    token,
    corpo: { versao: '0.9', consentimentoDadosSensiveis: true }
  });
  assert.equal(errada.status, 422);

  const aceite = await chamar('POST', '/conta/politica', {
    token,
    corpo: { versao: VERSAO_POLITICA, consentimentoDadosSensiveis: true }
  });
  assert.equal(aceite.status, 200);
  assert.equal(aceite.dados.politicaPendente, false);
});

/* ------------------------------------------------- direitos do titular */

test('a exportação traz todos os dados do titular, sem a senha e sem dados de terceiros', async () => {
  const titular = await criarConta('exporta@teste.app');
  const terceiro = await criarConta('terceiro@teste.app');
  await chamar('POST', '/notas/xml', { token: titular.token, corpo: xmlDeNota(), tipo: 'application/xml' });
  await chamar('POST', '/notas/xml', {
    token: terceiro.token,
    corpo: xmlDeNota({ cnpj: '47960950000121', preco: 4.19 }),
    tipo: 'application/xml'
  });

  const { status, cabecalhos, dados } = await chamar('GET', '/conta/exportacao', { token: titular.token });
  assert.equal(status, 200);
  assert.match(cabecalhos.get('content-disposition'), /attachment/);
  assert.equal(dados.conta.email, 'exporta@teste.app');
  assert.equal(dados.notas.length, 1);
  assert.equal(dados.notas[0].itens[0].descricao, 'LEITE INTEGRAL UHT 1L');
  assert.equal(dados.notas[0].horaEmissao, '14:25:00');
  assert.equal(dados.precosPorEstabelecimento.length, 1);

  const texto = JSON.stringify(dados);
  assert.ok(!texto.includes('senha'), 'a exportação não pode conter a senha nem o hash');
  assert.ok(!texto.includes('terceiro@teste.app'));
  assert.ok(!texto.includes('47960950000121'), 'a exportação não pode conter compras de outro usuário');
});

test('o CPF do consumidor presente no XML não é gravado', async () => {
  const { token } = await criarConta('cpf@teste.app');
  const cpf = '12345678909';
  const importacao = await chamar('POST', '/notas/xml', {
    token,
    corpo: xmlDeNota({ cpfConsumidor: cpf, cnpj: '33041260065290' }),
    tipo: 'application/xml'
  });
  assert.equal(importacao.status, 201);

  const exportacao = await chamar('GET', '/conta/exportacao', { token });
  assert.ok(!JSON.stringify(exportacao.dados).includes(cpf));

  const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  for (const { name } of tabelas) {
    const conteudo = JSON.stringify(db.prepare(`SELECT * FROM ${name}`).all());
    assert.ok(!conteudo.includes(cpf), `o CPF apareceu na tabela ${name}`);
  }
});

test('nome e e-mail podem ser corrigidos, mantendo o e-mail único', async () => {
  const { token } = await criarConta('corrige@teste.app');
  await criarConta('ocupado@teste.app');

  const ok = await chamar('PATCH', '/conta', { token, corpo: { nome: 'Nome Corrigido', email: 'novo@teste.app' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.dados.nome, 'Nome Corrigido');
  assert.equal(ok.dados.email, 'novo@teste.app');

  const conflito = await chamar('PATCH', '/conta', { token, corpo: { email: 'ocupado@teste.app' } });
  assert.equal(conflito.status, 409);
});

test('o titular exclui uma nota própria, mas não a de outro usuário', async () => {
  const dono = await criarConta('dono-nota@teste.app');
  const outro = await criarConta('outro-nota@teste.app');
  const { dados } = await chamar('POST', '/notas/xml', {
    token: dono.token,
    corpo: xmlDeNota({ cnpj: '61585865000151' }),
    tipo: 'application/xml'
  });

  assert.equal((await chamar('DELETE', `/notas/${dados.notaId}`, { token: outro.token })).status, 404);
  assert.equal((await chamar('DELETE', `/notas/${dados.notaId}`, { token: dono.token })).status, 204);
  assert.equal((await chamar('GET', `/notas/${dados.notaId}`, { token: dono.token })).status, 404);
});

test('excluir a conta exige a senha, apaga todos os dados e invalida a sessão', async () => {
  const { token, usuario } = await criarConta('exclui@teste.app');
  await chamar('POST', '/notas/xml', {
    token,
    corpo: xmlDeNota({ cnpj: '11222333000181' }),
    tipo: 'application/xml'
  });

  const senhaErrada = await chamar('DELETE', '/conta', { token, corpo: { senha: 'errada123' } });
  assert.equal(senhaErrada.status, 403);

  const exclusao = await chamar('DELETE', '/conta', { token, corpo: { senha: 'senhaforte1' } });
  assert.equal(exclusao.status, 204);

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM usuario WHERE id = ?').get(usuario.id).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM nota_fiscal WHERE usuario_id = ?').get(usuario.id).c, 0);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM preco_empresa_produto WHERE usuario_id = ?').get(usuario.id).c,
    0
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM empresa WHERE cnpj = ?').get('11222333000181').c, 0);
  assert.equal((await chamar('GET', '/conta', { token })).status, 401);
});

/* ------------------------------------------------ isolamento pelas rotas */

test('as rotas não expõem notas, produtos ou lojas de outro usuário', async () => {
  const a = await criarConta('rota-a@teste.app');
  const b = await criarConta('rota-b@teste.app');
  const { dados } = await chamar('POST', '/notas/xml', {
    token: b.token,
    corpo: xmlDeNota({ cnpj: '44555666000199', preco: 3.33 }),
    tipo: 'application/xml'
  });
  const produtoId = dados.nota.itens[0].produtoId;
  const empresaId = dados.nota.empresaId;

  assert.equal((await chamar('GET', `/notas/${dados.notaId}`, { token: a.token })).status, 404);
  assert.equal((await chamar('GET', `/notas/${dados.notaId}/comparacao`, { token: a.token })).status, 404);
  assert.equal((await chamar('GET', `/produtos/${produtoId}/historico`, { token: a.token })).status, 404);
  assert.deepEqual((await chamar('GET', `/empresas/${empresaId}/produtos`, { token: a.token })).dados, []);
  assert.equal((await chamar('GET', '/notas', { token: a.token })).dados.quantidade, 0);
});

/* ------------------------------------------------------------ segurança */

test('o login é bloqueado depois de 5 tentativas erradas', async () => {
  await criarConta('forca-bruta@teste.app');
  for (let i = 0; i < 5; i++) {
    const r = await chamar('POST', '/auth/login', { corpo: { email: 'forca-bruta@teste.app', senha: 'chute' } });
    assert.equal(r.status, 401);
  }
  const bloqueado = await chamar('POST', '/auth/login', {
    corpo: { email: 'forca-bruta@teste.app', senha: 'senhaforte1' }
  });
  assert.equal(bloqueado.status, 429);
  assert.ok(Number(bloqueado.cabecalhos.get('retry-after')) > 0);
});

test('o limitador libera novas tentativas quando a janela expira', () => {
  let agora = 0;
  const limitador = criarLimitadorDeLogin({ maximo: 2, janelaMs: 1000, agora: () => agora });
  limitador.registrarFalha('ip|email');
  limitador.registrarFalha('ip|email');
  assert.ok(limitador.segundosDeBloqueio('ip|email') > 0);
  agora = 1001;
  assert.equal(limitador.segundosDeBloqueio('ip|email'), 0);
});

test('em produção, a API não aceita rodar sem segredo de assinatura próprio', () => {
  assert.throws(() => resolverSegredoJwt({ NODE_ENV: 'production' }), /JWT_SECRET é obrigatório/);
  assert.equal(resolverSegredoJwt({ NODE_ENV: 'production', JWT_SECRET: 'segredo-longo' }), 'segredo-longo');
  assert.equal(resolverSegredoJwt({}), 'notafacil-desenvolvimento');
});

test('CORS aceita só as origens configuradas e a API envia cabeçalhos de segurança', async () => {
  assert.deepEqual(origensPermitidas({}), ['http://localhost:5173']);
  assert.deepEqual(origensPermitidas({ CORS_ORIGENS: 'https://a.app, https://b.app' }), [
    'https://a.app',
    'https://b.app'
  ]);

  const { cabecalhos } = await chamar('GET', '/saude');
  assert.equal(cabecalhos.get('x-content-type-options'), 'nosniff');
  assert.equal(cabecalhos.get('x-frame-options'), 'DENY');
  assert.equal(cabecalhos.get('x-powered-by'), null);
});

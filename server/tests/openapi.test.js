import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ESPECIFICACAO = JSON.parse(
  fs.readFileSync(new URL('../src/docs/openapi.json', import.meta.url), 'utf8')
);
const FONTE = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

/** Rotas declaradas no Express, com os parâmetros no formato do OpenAPI. */
function rotasDoServidor() {
  const rotas = new Set();
  for (const achado of FONTE.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
    rotas.add(`${achado[1]} ${achado[2].replace(/:(\w+)/g, '{$1}')}`);
  }
  return rotas;
}

function rotasDaEspecificacao() {
  const rotas = new Set();
  for (const [caminho, metodos] of Object.entries(ESPECIFICACAO.paths)) {
    for (const metodo of Object.keys(metodos)) rotas.add(`${metodo} ${caminho}`);
  }
  return rotas;
}

test('a especificação é um documento OpenAPI 3 válido em sua estrutura básica', () => {
  assert.match(ESPECIFICACAO.openapi, /^3\./);
  assert.equal(ESPECIFICACAO.info.title, 'NotaFácil API');
  assert.ok(ESPECIFICACAO.info.version);
  assert.ok(ESPECIFICACAO.components.securitySchemes.bearerAuth);
});

test('toda rota do servidor está documentada', () => {
  const naoDocumentadas = [...rotasDoServidor()].filter((r) => !rotasDaEspecificacao().has(r));
  assert.deepEqual(naoDocumentadas, []);
});

test('a especificação não documenta rota inexistente', () => {
  const inexistentes = [...rotasDaEspecificacao()].filter((r) => !rotasDoServidor().has(r));
  assert.deepEqual(inexistentes, []);
});

test('as rotas autenticadas exigem token e as públicas não', () => {
  const publicas = [
    '/api/saude',
    '/api/docs',
    '/api/openapi.json',
    '/api/privacidade',
    '/api/auth/cadastro',
    '/api/auth/login'
  ];
  for (const [caminho, metodos] of Object.entries(ESPECIFICACAO.paths)) {
    for (const operacao of Object.values(metodos)) {
      if (publicas.includes(caminho)) {
        assert.deepEqual(operacao.security, [], `${caminho} deveria ser pública`);
      } else {
        assert.equal(operacao.security, undefined, `${caminho} deveria herdar a exigência de token`);
        assert.ok(operacao.responses['401'], `${caminho} deveria documentar o 401`);
      }
    }
  }
});

test('toda referência interna aponta para um componente existente', () => {
  const texto = JSON.stringify(ESPECIFICACAO);
  for (const achado of texto.matchAll(/"#\/components\/(\w+)\/(\w+)"/g)) {
    assert.ok(
      ESPECIFICACAO.components[achado[1]]?.[achado[2]],
      `referência quebrada: ${achado[0]}`
    );
  }
});

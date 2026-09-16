import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';

import { entrar, exigirAutenticacao, registrar } from './auth.js';
import { extrairChave, interpretarChave, validarChave, formatarCnpj } from './domain/chaveAcesso.js';
import {
  CadeiaDeProvedores,
  ProvedorCatalogoLocal,
  ProvedorConsultaAssistida,
  ProvedorInfosimples,
  ProvedorSefaz,
  ProvedorXmlAutorizado
} from './domain/nfe/provedores.js';
import {
  compararComHistorico,
  excluirNota,
  garantirNotaInedita,
  importarNota,
  listarEmpresas,
  listarNotas,
  obterNota,
  resumoDoUsuario
} from './services/notaService.js';
import {
  buscarProdutos,
  detalharProduto,
  produtosPorEmpresa,
  produtosRecorrentes
} from './services/produtoService.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['application/xml', 'text/xml'], limit: '5mb' }));

// Composição das dependências: a SEFAZ é tentada primeiro; com token, a
// Infosimples consulta o portal; sem ela (ou em falha), a consulta passa a ser
// assistida (portal oficial + XML). O catálogo local de itens sintéticos só
// entra no modo de demonstração, que não faz chamadas pagas.
const modoDemo = process.env.NFE_MODO_DEMO === '1' || process.argv.includes('--demo');
const tokenInfosimples = process.env.INFOSIMPLES_TOKEN?.trim();
const provedorConsulta = new CadeiaDeProvedores(
  modoDemo
    ? [new ProvedorSefaz(), new ProvedorCatalogoLocal()]
    : [
        new ProvedorSefaz(),
        ...(tokenInfosimples ? [new ProvedorInfosimples({ token: tokenInfosimples })] : []),
        new ProvedorConsultaAssistida()
      ]
);
const provedorXml = new ProvedorXmlAutorizado();

const rota = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const idDaRota = (req) => z.coerce.number().int().positive().parse(req.params.id);

app.get('/api/saude', (_req, res) => res.json({ status: 'ok', versao: '1.0.0' }));

/* ----------------------------------------------------------- documentação */

const especificacao = JSON.parse(
  fs.readFileSync(new URL('./docs/openapi.json', import.meta.url), 'utf8')
);

// Swagger UI carregado por CDN: documenta a API sem acrescentar dependência.
const PAGINA_DOCS = `<!doctype html>
<html lang="pt-br">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NotaFácil API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({ url: './openapi.json', dom_id: '#swagger', docExpansion: 'list' });
    </script>
  </body>
</html>`;

app.get('/api/openapi.json', (_req, res) => res.json(especificacao));
app.get('/api/docs', (_req, res) => res.type('html').send(PAGINA_DOCS));

/* ----------------------------------------------------------- autenticação */

const esquemaCadastro = z.object({
  nome: z.string().min(2, 'Informe seu nome.'),
  email: z.string().email('E-mail inválido.'),
  senha: z.string().min(6, 'A senha deve ter ao menos 6 caracteres.')
});

app.post(
  '/api/auth/cadastro',
  rota((req, res) => res.status(201).json(registrar(esquemaCadastro.parse(req.body))))
);

app.post(
  '/api/auth/login',
  rota((req, res) =>
    res.json(entrar(z.object({ email: z.string().email(), senha: z.string() }).parse(req.body)))
  )
);

/* ------------------------------------------------------------------ notas */

app.post(
  '/api/notas/qrcode',
  exigirAutenticacao,
  rota(async (req, res) => {
    const { conteudo } = z.object({ conteudo: z.string().min(1) }).parse(req.body);

    const chave = extrairChave(conteudo);
    if (!chave) {
      return res.status(422).json({ erro: 'Não foi possível localizar uma chave de acesso no conteúdo lido.' });
    }
    if (!validarChave(chave)) {
      return res.status(422).json({ erro: 'Chave de acesso inválida: o dígito verificador não confere.' });
    }

    // Recusa a duplicidade antes da consulta: a Infosimples cobra por requisição.
    garantirNotaInedita(req.usuarioId, chave);
    const nota = await provedorConsulta.consultar(chave, { conteudoQr: conteudo });
    const notaId = importarNota(req.usuarioId, nota);

    res.status(201).json({
      notaId,
      chaveInterpretada: interpretarChave(chave),
      nota: obterNota(req.usuarioId, notaId)
    });
  })
);

app.post(
  '/api/notas/xml',
  exigirAutenticacao,
  rota(async (req, res) => {
    const conteudo = typeof req.body === 'string' ? req.body : req.body?.xml;
    if (!conteudo) return res.status(422).json({ erro: 'Envie o XML de autorização da nota.' });

    let nota;
    try {
      nota = await provedorXml.consultarPorXml(conteudo);
    } catch (erro) {
      return res.status(422).json({ erro: `Não foi possível ler o XML da nota: ${erro.message}` });
    }
    if (!validarChave(nota.chave)) {
      return res.status(422).json({ erro: 'A chave contida no XML é inválida.' });
    }

    const notaId = importarNota(req.usuarioId, nota);
    res.status(201).json({ notaId, nota: obterNota(req.usuarioId, notaId) });
  })
);

app.get(
  '/api/notas',
  exigirAutenticacao,
  rota((req, res) => res.json(listarNotas(req.usuarioId, req.query)))
);

app.get(
  '/api/notas/:id',
  exigirAutenticacao,
  rota((req, res) => {
    const nota = obterNota(req.usuarioId, idDaRota(req));
    if (!nota) return res.status(404).json({ erro: 'Nota não encontrada.' });
    res.json({ ...nota, cnpjFormatado: formatarCnpj(nota.cnpj) });
  })
);

app.delete(
  '/api/notas/:id',
  exigirAutenticacao,
  rota((req, res) => {
    if (!excluirNota(req.usuarioId, idDaRota(req))) {
      return res.status(404).json({ erro: 'Nota não encontrada.' });
    }
    res.status(204).end();
  })
);

app.get(
  '/api/notas/:id/comparacao',
  exigirAutenticacao,
  rota((req, res) => {
    const itens = compararComHistorico(req.usuarioId, idDaRota(req));
    if (!itens) return res.status(404).json({ erro: 'Nota não encontrada.' });
    res.json(itens);
  })
);

/* --------------------------------------------------------------- produtos */

app.get(
  '/api/produtos',
  exigirAutenticacao,
  rota((req, res) => res.json(buscarProdutos(req.usuarioId, req.query)))
);

app.get(
  '/api/produtos/recorrentes',
  exigirAutenticacao,
  rota((req, res) =>
    res.json(produtosRecorrentes(req.usuarioId, Number(req.query.minimo ?? 2)))
  )
);

app.get(
  '/api/produtos/:id/historico',
  exigirAutenticacao,
  rota((req, res) => {
    const detalhe = detalharProduto(req.usuarioId, idDaRota(req));
    if (!detalhe) return res.status(404).json({ erro: 'Produto não encontrado no seu histórico.' });
    res.json(detalhe);
  })
);

/* --------------------------------------------------------------- empresas */

app.get(
  '/api/empresas',
  exigirAutenticacao,
  rota((req, res) => res.json(listarEmpresas(req.usuarioId)))
);

app.get(
  '/api/empresas/:id/produtos',
  exigirAutenticacao,
  rota((req, res) => res.json(produtosPorEmpresa(req.usuarioId, idDaRota(req))))
);

/* ------------------------------------------------------------- relatórios */

app.get(
  '/api/relatorios/resumo',
  exigirAutenticacao,
  rota((req, res) => res.json(resumoDoUsuario(req.usuarioId)))
);

/* ----------------------------------------------------- tratamento de erro */

app.use((erro, _req, res, _next) => {
  if (erro instanceof z.ZodError) {
    return res.status(422).json({ erro: erro.issues[0]?.message ?? 'Dados inválidos.' });
  }
  const status = erro.status ?? 500;
  if (status === 500) console.error(erro);
  res.status(status).json({
    erro: erro.message ?? 'Erro interno do servidor.',
    ...(erro.codigo && { codigo: erro.codigo }),
    ...(erro.urlConsulta !== undefined && { urlConsulta: erro.urlConsulta })
  });
});

const PORTA = Number(process.env.PORT ?? 3333);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORTA, () =>
    console.log(
      `NotaFácil API ouvindo em http://localhost:${PORTA}` +
        (modoDemo
          ? ' (modo demonstração: consulta por chave usa o catálogo local)'
          : tokenInfosimples
            ? ' (consulta de NFC-e via Infosimples ativa)'
            : '')
    )
  );
}

export { app };

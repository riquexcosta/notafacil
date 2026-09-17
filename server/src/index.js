import fs from 'node:fs';
import path from 'node:path';
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
import { criarGravadorDeAmostras } from './domain/nfe/amostrasInfosimples.js';
import { cadastroAberto, confiancaNoProxy, limiteDeCadastrosPorHora, pastaDoCliente } from './implantacao.js';
import { POLITICA, VERSAO_POLITICA } from './lgpd/politica.js';
import { cabecalhosDeSeguranca, criarLimitadorDeLogin, origensPermitidas } from './seguranca.js';
import { compararEstabelecimentos } from './services/comparativoService.js';
import { desvincularProduto, sugerirVinculos, vincularProdutos } from './services/vinculoService.js';
import {
  aceitarPolitica,
  atualizarConta,
  excluirConta,
  exportarDados,
  obterConta
} from './services/contaService.js';
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
app.disable('x-powered-by');
app.set('trust proxy', confiancaNoProxy());
app.use(cabecalhosDeSeguranca);
app.use(cors({ origin: origensPermitidas() }));
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
        ...(tokenInfosimples
          ? [new ProvedorInfosimples({ token: tokenInfosimples, aoResponder: criarGravadorDeAmostras() })]
          : []),
        new ProvedorConsultaAssistida()
      ]
);
const provedorXml = new ProvedorXmlAutorizado();

const rota = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const idDaRota = (req) => z.coerce.number().int().positive().parse(req.params.id);

app.get('/api/saude', (_req, res) =>
  res.json({ status: 'ok', versao: '1.0.0', cadastroAberto: cadastroAberto() })
);

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

/* -------------------------------------------------------------- privacidade */

app.get('/api/privacidade', (_req, res) => res.json(POLITICA));

/* ----------------------------------------------------------- autenticação */

const esquemaCadastro = z.object({
  nome: z.string().trim().min(2, 'Informe seu nome.'),
  email: z.string().email('E-mail inválido.'),
  senha: z.string().min(8, 'A senha deve ter ao menos 8 caracteres.'),
  aceitePolitica: z.literal(true, { message: 'É preciso aceitar a política de privacidade.' }),
  consentimentoDadosSensiveis: z.literal(true, {
    message: 'É preciso consentir com o tratamento de compras que possam revelar dados de saúde.'
  }),
  versaoPolitica: z.literal(VERSAO_POLITICA, {
    message: `A versão vigente da política é ${VERSAO_POLITICA}. Recarregue a página e leia a política atual.`
  })
});

// Conta as contas criadas por IP na última hora (reaproveita o limitador do login).
const limitadorDeCadastro = criarLimitadorDeLogin({ maximo: limiteDeCadastrosPorHora(), janelaMs: 60 * 60 * 1000 });

app.post(
  '/api/auth/cadastro',
  rota((req, res) => {
    if (!cadastroAberto()) {
      return res.status(403).json({ erro: 'O cadastro de novas contas está fechado nesta instalação.' });
    }
    const espera = limitadorDeCadastro.segundosDeBloqueio(req.ip);
    if (espera > 0) {
      res.set('Retry-After', String(espera));
      return res
        .status(429)
        .json({ erro: `Muitas contas criadas a partir desta rede. Tente novamente em ${Math.ceil(espera / 60)} minuto(s).` });
    }
    const conta = registrar(esquemaCadastro.parse(req.body));
    limitadorDeCadastro.registrarFalha(req.ip);
    res.status(201).json(conta);
  })
);

const limitadorDeLogin = criarLimitadorDeLogin();

app.post(
  '/api/auth/login',
  rota((req, res) => {
    const credenciais = z.object({ email: z.string().email(), senha: z.string() }).parse(req.body);
    const chave = `${req.ip}|${credenciais.email.toLowerCase()}`;

    const espera = limitadorDeLogin.segundosDeBloqueio(chave);
    if (espera > 0) {
      res.set('Retry-After', String(espera));
      return res
        .status(429)
        .json({ erro: `Muitas tentativas de login. Tente novamente em ${Math.ceil(espera / 60)} minuto(s).` });
    }

    try {
      const sessao = entrar(credenciais);
      limitadorDeLogin.limpar(chave);
      res.json(sessao);
    } catch (erro) {
      if (erro.status === 401) limitadorDeLogin.registrarFalha(chave);
      throw erro;
    }
  })
);

/* ------------------------------------------------------------------ conta */

app.get(
  '/api/conta',
  exigirAutenticacao,
  rota((req, res) => res.json(obterConta(req.usuarioId)))
);

app.patch(
  '/api/conta',
  exigirAutenticacao,
  rota((req, res) => {
    const dados = z
      .object({
        nome: z.string().trim().min(2, 'Informe seu nome.').optional(),
        email: z.string().email('E-mail inválido.').optional()
      })
      .refine((d) => d.nome || d.email, { message: 'Informe o nome ou o e-mail.' })
      .parse(req.body);
    res.json(atualizarConta(req.usuarioId, dados));
  })
);

app.delete(
  '/api/conta',
  exigirAutenticacao,
  rota((req, res) => {
    const { senha } = z.object({ senha: z.string().min(1, 'Informe sua senha.') }).parse(req.body ?? {});
    if (!excluirConta(req.usuarioId, senha)) {
      return res.status(403).json({ erro: 'Senha incorreta. A conta não foi excluída.' });
    }
    res.status(204).end();
  })
);

app.get(
  '/api/conta/exportacao',
  exigirAutenticacao,
  rota((req, res) => {
    const nome = `notafacil-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
    res.set('Content-Disposition', `attachment; filename="${nome}"`);
    res.json(exportarDados(req.usuarioId));
  })
);

app.post(
  '/api/conta/politica',
  exigirAutenticacao,
  rota((req, res) => {
    const { versao } = z
      .object({
        versao: z.string(),
        consentimentoDadosSensiveis: z.literal(true, {
          message: 'É preciso consentir com o tratamento de compras que possam revelar dados de saúde.'
        })
      })
      .parse(req.body);
    res.json(aceitarPolitica(req.usuarioId, versao));
  })
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

app.get(
  '/api/produtos/:id/sugestoes-vinculo',
  exigirAutenticacao,
  rota((req, res) => {
    const sugestoes = sugerirVinculos(req.usuarioId, idDaRota(req));
    if (!sugestoes) return res.status(404).json({ erro: 'Produto não encontrado no seu histórico.' });
    res.json(sugestoes);
  })
);

app.post(
  '/api/produtos/:id/vinculos',
  exigirAutenticacao,
  rota((req, res) => {
    const { produtoId } = z
      .object({ produtoId: z.coerce.number().int().positive('Informe o produto a vincular.') })
      .parse(req.body ?? {});
    res.json(vincularProdutos(req.usuarioId, idDaRota(req), produtoId));
  })
);

app.delete(
  '/api/produtos/:id/vinculos/:origemId',
  exigirAutenticacao,
  rota((req, res) => {
    const origemId = z.coerce.number().int().positive().parse(req.params.origemId);
    const detalhe = desvincularProduto(req.usuarioId, idDaRota(req), origemId);
    if (!detalhe) return res.status(404).json({ erro: 'Vínculo não encontrado.' });
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

/* ----------------------------------------------------------- comparativo */

app.get(
  '/api/comparativo/estabelecimentos',
  exigirAutenticacao,
  rota((req, res) => {
    const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use datas no formato AAAA-MM-DD.').optional();
    const filtros = z
      .object({
        dataInicio: data,
        dataFim: data,
        empresas: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0) : undefined))
      })
      .parse(req.query);
    res.json(compararEstabelecimentos(req.usuarioId, filtros));
  })
);

/* ------------------------------------------------------------- relatórios */

app.get(
  '/api/relatorios/resumo',
  exigirAutenticacao,
  rota((req, res) => res.json(resumoDoUsuario(req.usuarioId)))
);

/* ------------------------------------------------------------ cliente web */

// Em produção, a API serve o build do cliente na mesma origem. Rotas que não
// começam por /api devolvem o index.html para o roteamento do React.
const CLIENTE = pastaDoCliente();
if (fs.existsSync(path.join(CLIENTE, 'index.html'))) {
  app.use(express.static(CLIENTE, { index: false }));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(CLIENTE, 'index.html')));
}

app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

/* ----------------------------------------------------- tratamento de erro */

app.use((erro, _req, res, _next) => {
  if (erro instanceof z.ZodError) {
    return res.status(422).json({ erro: erro.issues[0]?.message ?? 'Dados inválidos.' });
  }
  const status = erro.status ?? 500;
  if (status === 500) console.error(erro);
  res.status(status).json({
    erro: status === 500 ? 'Erro interno do servidor.' : erro.message,
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

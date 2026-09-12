import express from 'express';
import cors from 'cors';
import { z } from 'zod';

import { entrar, exigirAutenticacao, registrar } from './auth.js';
import { extrairChave, interpretarChave, validarChave, formatarCnpj } from './domain/chaveAcesso.js';
import {
  CadeiaDeProvedores,
  ProvedorCatalogoLocal,
  ProvedorSefaz,
  ProvedorXmlAutorizado
} from './domain/nfe/provedores.js';
import {
  compararComHistorico,
  importarNota,
  listarNotas,
  obterNota
} from './services/notaService.js';
import { produtosRecorrentes } from './services/produtoService.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['application/xml', 'text/xml'], limit: '5mb' }));

// Composição das dependências: a SEFAZ é tentada primeiro e, indisponível,
// a cadeia recai sobre o catálogo local.
const provedorConsulta = new CadeiaDeProvedores([new ProvedorSefaz(), new ProvedorCatalogoLocal()]);
const provedorXml = new ProvedorXmlAutorizado();

const rota = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.get('/api/saude', (_req, res) => res.json({ status: 'ok', versao: '1.0.0' }));

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

    const nota = await provedorConsulta.consultar(chave);
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

    const nota = await provedorXml.consultarPorXml(conteudo);
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
    const nota = obterNota(req.usuarioId, Number(req.params.id));
    if (!nota) return res.status(404).json({ erro: 'Nota não encontrada.' });
    res.json({ ...nota, cnpjFormatado: formatarCnpj(nota.cnpj) });
  })
);

app.get(
  '/api/notas/:id/comparacao',
  exigirAutenticacao,
  rota((req, res) => res.json(compararComHistorico(req.usuarioId, Number(req.params.id))))
);

/* --------------------------------------------------------------- produtos */

app.get(
  '/api/produtos/recorrentes',
  exigirAutenticacao,
  rota((req, res) =>
    res.json(produtosRecorrentes(req.usuarioId, Number(req.query.minimo ?? 2)))
  )
);

/* ----------------------------------------------------- tratamento de erro */

app.use((erro, _req, res, _next) => {
  if (erro instanceof z.ZodError) {
    return res.status(422).json({ erro: erro.issues[0]?.message ?? 'Dados inválidos.' });
  }
  const status = erro.status ?? 500;
  if (status === 500) console.error(erro);
  res.status(status).json({ erro: erro.message ?? 'Erro interno do servidor.' });
});

const PORTA = Number(process.env.PORT ?? 3333);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORTA, () => console.log(`NotaFácil API ouvindo em http://localhost:${PORTA}`));
}

export { app };

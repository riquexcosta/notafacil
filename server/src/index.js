import express from 'express';
import cors from 'cors';
import { z } from 'zod';

import { entrar, exigirAutenticacao, registrar } from './auth.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

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

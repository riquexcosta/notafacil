import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db/index.js';

const SEGREDO = process.env.JWT_SECRET ?? 'notafacil-desenvolvimento';
const EXPIRACAO = '7d';

export function registrar({ nome, email, senha }) {
  const existente = db.prepare('SELECT id FROM usuario WHERE email = ?').get(email.toLowerCase());
  if (existente) {
    const erro = new Error('Já existe uma conta com este e-mail.');
    erro.status = 409;
    throw erro;
  }

  const info = db
    .prepare('INSERT INTO usuario (nome, email, senha_hash) VALUES (?, ?, ?)')
    .run(nome, email.toLowerCase(), bcrypt.hashSync(senha, 10));

  return autenticarPorId(Number(info.lastInsertRowid));
}

export function entrar({ email, senha }) {
  const usuario = db.prepare('SELECT * FROM usuario WHERE email = ?').get(email.toLowerCase());
  if (!usuario || !bcrypt.compareSync(senha, usuario.senha_hash)) {
    const erro = new Error('E-mail ou senha inválidos.');
    erro.status = 401;
    throw erro;
  }
  return autenticarPorId(usuario.id);
}

function autenticarPorId(id) {
  const usuario = db.prepare('SELECT id, nome, email FROM usuario WHERE id = ?').get(id);
  const token = jwt.sign({ sub: usuario.id }, SEGREDO, { expiresIn: EXPIRACAO });
  return { token, usuario };
}

/** Middleware: exige um Bearer token válido e injeta req.usuarioId. */
export function exigirAutenticacao(req, res, next) {
  const cabecalho = req.headers.authorization ?? '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;

  if (!token) return res.status(401).json({ erro: 'Autenticação obrigatória.' });

  try {
    const payload = jwt.verify(token, SEGREDO);
    req.usuarioId = Number(payload.sub);
    next();
  } catch {
    res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  }
}

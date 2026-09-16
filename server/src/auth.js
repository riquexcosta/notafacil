import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db/index.js';
import { VERSAO_POLITICA } from './lgpd/politica.js';
import { resolverSegredoJwt } from './seguranca.js';

const SEGREDO = resolverSegredoJwt();
export const EXPIRACAO_SESSAO = '24h';

/** Dados da conta expostos ao cliente: nunca inclui o hash da senha. */
export function dadosPublicosDaConta(id) {
  const usuario = db
    .prepare(
      `SELECT id, nome, email, criado_em AS criadoEm,
              politica_versao AS politicaVersao, politica_aceita_em AS politicaAceitaEm
         FROM usuario WHERE id = ?`
    )
    .get(id);
  if (!usuario) return null;
  return { ...usuario, politicaPendente: usuario.politicaVersao !== VERSAO_POLITICA };
}

function autenticarPorId(id) {
  const token = jwt.sign({ sub: id }, SEGREDO, { expiresIn: EXPIRACAO_SESSAO });
  return { token, usuario: dadosPublicosDaConta(id) };
}

/**
 * Cria a conta registrando o aceite da política vigente. O aceite é validado na
 * rota: sem ele, o cadastro é recusado.
 */
export function registrar({ nome, email, senha }) {
  const existente = db.prepare('SELECT id FROM usuario WHERE email = ?').get(email.toLowerCase());
  if (existente) {
    const erro = new Error('Já existe uma conta com este e-mail.');
    erro.status = 409;
    throw erro;
  }

  const info = db
    .prepare(
      `INSERT INTO usuario (nome, email, senha_hash, politica_versao, politica_aceita_em)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(nome, email.toLowerCase(), bcrypt.hashSync(senha, 10), VERSAO_POLITICA, new Date().toISOString());

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

/** Confere a senha atual do usuário, usada para confirmar ações irreversíveis. */
export function senhaConfere(usuarioId, senha) {
  const usuario = db.prepare('SELECT senha_hash FROM usuario WHERE id = ?').get(usuarioId);
  return Boolean(usuario) && bcrypt.compareSync(senha, usuario.senha_hash);
}

/**
 * Middleware: exige um Bearer token válido de uma conta que ainda existe e
 * injeta req.usuarioId. Depois da exclusão da conta, o token deixa de valer.
 */
export function exigirAutenticacao(req, res, next) {
  const cabecalho = req.headers.authorization ?? '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;

  if (!token) return res.status(401).json({ erro: 'Autenticação obrigatória.' });

  try {
    const payload = jwt.verify(token, SEGREDO);
    const id = Number(payload.sub);
    if (!db.prepare('SELECT 1 FROM usuario WHERE id = ?').get(id)) {
      return res.status(401).json({ erro: 'Sessão inválida. Entre novamente.' });
    }
    req.usuarioId = id;
    next();
  } catch {
    res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  }
}

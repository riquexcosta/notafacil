import { db } from '../db/index.js';

/**
 * Normaliza a descrição para uso como chave de fallback.
 * O nome do produto na NF-e é campo livre do emitente: acentos, abreviações e
 * espaçamento variam entre estabelecimentos, então só é usado quando o EAN
 * está ausente ("SEM GTIN").
 */
export function normalizarDescricao(descricao) {
  return String(descricao ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolve a identidade do produto na base.
 * Ordem de precedência: EAN (GTIN) → NCM + descrição normalizada → novo registro.
 */
export function resolverProduto(item) {
  if (item.ean) {
    const existente = db.prepare('SELECT * FROM produto WHERE ean = ?').get(item.ean);
    if (existente) {
      if (!existente.ncm && item.ncm) {
        db.prepare('UPDATE produto SET ncm = ? WHERE id = ?').run(item.ncm, existente.id);
      }
      return existente.id;
    }
  } else if (item.ncm) {
    const candidatos = db.prepare('SELECT * FROM produto WHERE ncm = ? AND ean IS NULL').all(item.ncm);
    const alvo = normalizarDescricao(item.descricao);
    const achado = candidatos.find((c) => normalizarDescricao(c.descricao) === alvo);
    if (achado) return achado.id;
  }

  const info = db
    .prepare('INSERT INTO produto (ean, ncm, descricao, unidade) VALUES (?, ?, ?, ?)')
    .run(item.ean ?? null, item.ncm ?? null, item.descricao, item.unidade ?? 'UN');
  return Number(info.lastInsertRowid);
}

export function resolverEmpresa(emitente) {
  const existente = db.prepare('SELECT * FROM empresa WHERE cnpj = ?').get(emitente.cnpj);
  if (existente) return existente.id;

  const info = db
    .prepare(
      `INSERT INTO empresa (cnpj, razao_social, nome_fantasia, logradouro, municipio, uf)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      emitente.cnpj,
      emitente.razaoSocial,
      emitente.nomeFantasia ?? null,
      emitente.logradouro ?? null,
      emitente.municipio ?? null,
      emitente.uf ?? null
    );
  return Number(info.lastInsertRowid);
}

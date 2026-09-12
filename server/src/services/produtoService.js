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

/** Série histórica de preços pagos pelo usuário para um produto. */
export function historicoDoProduto(usuarioId, produtoId) {
  return db
    .prepare(
      `SELECT n.data_emissao AS dataEmissao,
              n.chave_acesso AS chave,
              e.nome_fantasia AS empresa,
              e.cnpj          AS cnpj,
              i.valor_unitario AS valorUnitario,
              i.quantidade     AS quantidade
         FROM item_nota i
         JOIN nota_fiscal n ON n.id = i.nota_id
         JOIN empresa e     ON e.id = n.empresa_id
        WHERE n.usuario_id = ? AND i.produto_id = ?
        ORDER BY n.data_emissao ASC`
    )
    .all(usuarioId, produtoId);
}

/** Produtos que aparecem em duas ou mais notas do usuário. */
export function produtosRecorrentes(usuarioId, minimoOcorrencias = 2) {
  return db
    .prepare(
      `SELECT p.id, p.descricao, p.ean, p.ncm, p.unidade,
              COUNT(DISTINCT n.id)     AS ocorrencias,
              MIN(i.valor_unitario)    AS menorPreco,
              MAX(i.valor_unitario)    AS maiorPreco,
              ROUND(AVG(i.valor_unitario), 2) AS precoMedio,
              ROUND(SUM(i.valor_total), 2)    AS totalGasto,
              MAX(n.data_emissao)      AS ultimaCompra
         FROM item_nota i
         JOIN nota_fiscal n ON n.id = i.nota_id
         JOIN produto p     ON p.id = i.produto_id
        WHERE n.usuario_id = ?
        GROUP BY p.id
       HAVING ocorrencias >= ?
        ORDER BY ocorrencias DESC, totalGasto DESC`
    )
    .all(usuarioId, minimoOcorrencias)
    .map((linha) => ({
      ...linha,
      variacaoPercentual:
        linha.menorPreco > 0
          ? Number((((linha.maiorPreco - linha.menorPreco) / linha.menorPreco) * 100).toFixed(1))
          : 0
    }));
}

export function buscarProdutos(usuarioId, { ean, ncm, termo } = {}) {
  const condicoes = ['n.usuario_id = ?'];
  const parametros = [usuarioId];

  if (ean) {
    condicoes.push('p.ean = ?');
    parametros.push(ean);
  }
  if (ncm) {
    condicoes.push('p.ncm LIKE ?');
    parametros.push(`${ncm}%`);
  }
  if (termo) {
    condicoes.push('p.descricao LIKE ?');
    parametros.push(`%${termo.toUpperCase()}%`);
  }

  return db
    .prepare(
      `SELECT p.id, p.descricao, p.ean, p.ncm, p.unidade,
              COUNT(DISTINCT n.id)            AS ocorrencias,
              ROUND(AVG(i.valor_unitario), 2) AS precoMedio,
              MIN(i.valor_unitario)           AS menorPreco,
              MAX(i.valor_unitario)           AS maiorPreco,
              MAX(n.data_emissao)             AS ultimaCompra
         FROM produto p
         JOIN item_nota i   ON i.produto_id = p.id
         JOIN nota_fiscal n ON n.id = i.nota_id
        WHERE ${condicoes.join(' AND ')}
        GROUP BY p.id
        ORDER BY ocorrencias DESC, p.descricao ASC
        LIMIT 100`
    )
    .all(...parametros);
}

/** Preços mais recentes praticados por um estabelecimento. */
export function produtosPorEmpresa(empresaId) {
  return db
    .prepare(
      `SELECT p.id, p.descricao, p.ean, p.ncm, p.unidade,
              pep.valor_unitario  AS valorUnitario,
              pep.data_referencia AS dataReferencia
         FROM preco_empresa_produto pep
         JOIN produto p ON p.id = pep.produto_id
        WHERE pep.empresa_id = ?
        ORDER BY pep.data_referencia DESC, p.descricao ASC`
    )
    .all(empresaId);
}

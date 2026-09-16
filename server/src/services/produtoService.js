import { db } from '../db/index.js';

const arredondar = (valor, casas = 2) => Number(Number(valor).toFixed(casas));

/** Variação entre o maior e o menor valor, relativa ao menor, em %. */
export const amplitudePercentual = (menor, maior) =>
  menor > 0 ? arredondar(((maior - menor) / menor) * 100, 1) : 0;

/**
 * Normaliza a descrição para uso como chave de fallback.
 * O nome do produto na NF-e é campo livre do emitente: acentos, abreviações e
 * espaçamento variam entre estabelecimentos, então só é usado quando o EAN
 * está ausente ("SEM GTIN").
 */
export function normalizarDescricao(descricao) {
  return String(descricao ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolve a identidade do produto na base.
 * Ordem de precedência: EAN (GTIN) → NCM + descrição normalizada → descrição
 * normalizada (quando a fonte não informa o NCM, como a consulta ao portal) →
 * novo registro.
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
  } else {
    const candidatos = item.ncm
      ? db.prepare('SELECT * FROM produto WHERE ncm = ? AND ean IS NULL').all(item.ncm)
      : db.prepare('SELECT * FROM produto WHERE ncm IS NULL AND ean IS NULL').all();
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

/** Série histórica de preços pagos pelo usuário para um produto, em ordem cronológica. */
export function historicoDoProduto(usuarioId, produtoId) {
  return db
    .prepare(
      `SELECT n.id             AS notaId,
              n.data_emissao   AS dataEmissao,
              n.hora_emissao   AS horaEmissao,
              n.chave_acesso   AS chave,
              e.id             AS empresaId,
              COALESCE(e.nome_fantasia, e.razao_social) AS empresa,
              e.cnpj           AS cnpj,
              i.valor_unitario AS valorUnitario,
              i.quantidade     AS quantidade,
              i.valor_total    AS valorTotal
         FROM item_nota i
         JOIN nota_fiscal n ON n.id = i.nota_id
         JOIN empresa e     ON e.id = n.empresa_id
        WHERE n.usuario_id = ? AND i.produto_id = ?
        ORDER BY n.data_emissao ASC, COALESCE(n.hora_emissao, '') ASC, n.id ASC, i.id ASC`
    )
    .all(usuarioId, produtoId);
}

/**
 * Histórico, estatísticas e preço por estabelecimento de um produto, só com as
 * compras do usuário. Devolve null quando o usuário nunca comprou o produto, para
 * que a existência de itens comprados por outros usuários não seja revelada.
 *
 * Fórmulas:
 *   compras              = número de notas com o produto
 *   preço médio          = Σ valor total / Σ quantidade   (ponderado pela quantidade)
 *   variação no período  = (preço da última compra − preço da primeira) / preço da primeira × 100
 *   amplitude            = (maior preço unitário − menor) / menor × 100
 *   oferta por loja      = preço unitário da compra mais recente do usuário naquela loja
 */
export function detalharProduto(usuarioId, produtoId) {
  const historico = historicoDoProduto(usuarioId, produtoId);
  if (historico.length === 0) return null;

  const produto = db
    .prepare('SELECT id, ean, ncm, descricao, unidade FROM produto WHERE id = ?')
    .get(produtoId);

  const precos = historico.map((h) => h.valorUnitario);
  const menorPreco = Math.min(...precos);
  const maiorPreco = Math.max(...precos);
  const quantidade = historico.reduce((s, h) => s + h.quantidade, 0);
  const valorTotal = historico.reduce((s, h) => s + h.valorTotal, 0);
  const primeira = historico[0].valorUnitario;
  const ultima = historico[historico.length - 1].valorUnitario;

  const ofertas = db
    .prepare(
      `SELECT e.id, e.nome_fantasia AS empresa, e.razao_social AS razaoSocial, e.municipio, e.uf,
              pep.valor_unitario AS valorUnitario, pep.data_referencia AS dataReferencia
         FROM preco_empresa_produto pep
         JOIN empresa e ON e.id = pep.empresa_id
        WHERE pep.usuario_id = ? AND pep.produto_id = ?
        ORDER BY pep.valor_unitario ASC, e.id ASC`
    )
    .all(usuarioId, produtoId);

  return {
    produto,
    historico,
    ofertas,
    estatisticas: {
      compras: new Set(historico.map((h) => h.notaId)).size,
      menorPreco,
      maiorPreco,
      precoMedio: quantidade > 0 ? arredondar(valorTotal / quantidade) : arredondar(primeira),
      variacaoPercentual: primeira > 0 ? arredondar(((ultima - primeira) / primeira) * 100, 1) : 0,
      amplitudePercentual: amplitudePercentual(menorPreco, maiorPreco)
    }
  };
}

/** Linha de agregação por produto usada nas listagens. */
const AGREGADOS_DO_PRODUTO = `
  COUNT(DISTINCT n.id)                                      AS ocorrencias,
  MIN(i.valor_unitario)                                     AS menorPreco,
  MAX(i.valor_unitario)                                     AS maiorPreco,
  ROUND(SUM(i.valor_total) / NULLIF(SUM(i.quantidade), 0), 2) AS precoMedio,
  ROUND(SUM(i.valor_total), 2)                              AS totalGasto,
  MAX(n.data_emissao)                                       AS ultimaCompra`;

/** Produtos que aparecem em `minimoOcorrencias` ou mais notas do usuário. */
export function produtosRecorrentes(usuarioId, minimoOcorrencias = 2) {
  return db
    .prepare(
      `SELECT p.id, p.descricao, p.ean, p.ncm, p.unidade, ${AGREGADOS_DO_PRODUTO}
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
      amplitudePercentual: amplitudePercentual(linha.menorPreco, linha.maiorPreco)
    }));
}

export const LIMITE_BUSCA_PRODUTOS = 100;

/**
 * Busca produtos já comprados pelo usuário. A descrição é comparada depois de
 * normalizada (sem acentos, em caixa alta), então "café" encontra "CAFE TORRADO".
 */
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

  const encontrados = db
    .prepare(
      `SELECT p.id, p.descricao, p.ean, p.ncm, p.unidade, ${AGREGADOS_DO_PRODUTO}
         FROM produto p
         JOIN item_nota i   ON i.produto_id = p.id
         JOIN nota_fiscal n ON n.id = i.nota_id
        WHERE ${condicoes.join(' AND ')}
        GROUP BY p.id
        ORDER BY ocorrencias DESC, p.descricao ASC`
    )
    .all(...parametros);

  const alvo = normalizarDescricao(termo);
  return (alvo ? encontrados.filter((p) => normalizarDescricao(p.descricao).includes(alvo)) : encontrados)
    .slice(0, LIMITE_BUSCA_PRODUTOS);
}

/** Preços mais recentes pagos pelo usuário em um estabelecimento. */
export function produtosPorEmpresa(usuarioId, empresaId) {
  return db
    .prepare(
      `SELECT p.id, p.descricao, p.ean, p.ncm, p.unidade,
              pep.valor_unitario  AS valorUnitario,
              pep.data_referencia AS dataReferencia
         FROM preco_empresa_produto pep
         JOIN produto p ON p.id = pep.produto_id
        WHERE pep.usuario_id = ? AND pep.empresa_id = ?
        ORDER BY pep.data_referencia DESC, p.descricao ASC`
    )
    .all(usuarioId, empresaId);
}

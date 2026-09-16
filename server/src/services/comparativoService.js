import { db } from '../db/index.js';
import { amplitudePercentual } from './produtoService.js';

const arredondar = (valor, casas = 2) => Number(Number(valor).toFixed(casas));

/**
 * Compara os preços que o usuário pagou pelo mesmo produto em estabelecimentos
 * diferentes, dentro de um período.
 *
 * Fórmulas:
 *   preço na loja        = preço unitário da compra mais recente do produto naquela loja, no período
 *   produto comparado    = produto com preço em 2 ou mais lojas
 *   lojas consideradas   = lojas com preço em pelo menos um produto comparado
 *   amplitude            = (maior preço − menor) / menor × 100
 *   cesta comum          = produtos com preço em TODAS as lojas consideradas
 *   custo da cesta       = Σ preço na loja de uma unidade de cada produto da cesta
 *                          (para itens vendidos por quilo, o preço do quilo)
 *   economia da cesta    = custo na loja mais cara − custo na mais barata
 *   economia percentual  = economia / custo na loja mais cara × 100
 *
 * @param {number} usuarioId
 * @param {{ dataInicio?: string, dataFim?: string, empresas?: number[] }} filtros
 */
export function compararEstabelecimentos(usuarioId, { dataInicio, dataFim, empresas } = {}) {
  const precos = db
    .prepare(
      `SELECT produtoId, empresaId, valorUnitario, dataEmissao, notaId
         FROM (SELECT i.produto_id AS produtoId, n.empresa_id AS empresaId,
                      i.valor_unitario AS valorUnitario, n.data_emissao AS dataEmissao, n.id AS notaId,
                      ROW_NUMBER() OVER (
                        PARTITION BY i.produto_id, n.empresa_id
                        ORDER BY n.data_emissao DESC, COALESCE(n.hora_emissao, '') DESC, n.id DESC, i.id DESC
                      ) AS ordem
                 FROM item_nota i
                 JOIN nota_fiscal n ON n.id = i.nota_id
                WHERE n.usuario_id = @usuarioId
                  AND (@dataInicio IS NULL OR n.data_emissao >= @dataInicio)
                  AND (@dataFim IS NULL OR n.data_emissao <= @dataFim))
        WHERE ordem = 1`
    )
    .all({ usuarioId, dataInicio: dataInicio || null, dataFim: dataFim || null })
    .filter((p) => !empresas?.length || empresas.includes(p.empresaId));

  const porProduto = new Map();
  for (const p of precos) {
    if (!porProduto.has(p.produtoId)) porProduto.set(p.produtoId, []);
    porProduto.get(p.produtoId).push(p);
  }

  const descricoes = new Map(
    porProduto.size
      ? db
          .prepare(
            `SELECT id, descricao, ean, unidade FROM produto
              WHERE id IN (${[...porProduto.keys()].map(() => '?').join(', ')})`
          )
          .all(...porProduto.keys())
          .map((p) => [p.id, p])
      : []
  );

  const produtos = [...porProduto.entries()]
    .filter(([, linhas]) => linhas.length >= 2)
    .map(([produtoId, linhas]) => {
      const valores = linhas.map((l) => l.valorUnitario);
      const menorPreco = Math.min(...valores);
      const maiorPreco = Math.max(...valores);
      const { descricao, ean, unidade } = descricoes.get(produtoId);
      return {
        produtoId,
        descricao,
        ean,
        unidade,
        precos: Object.fromEntries(
          linhas.map((l) => [l.empresaId, { valorUnitario: l.valorUnitario, dataEmissao: l.dataEmissao, notaId: l.notaId }])
        ),
        lojasComPreco: linhas.length,
        menorPreco,
        maiorPreco,
        empresasMaisBaratas: linhas.filter((l) => l.valorUnitario === menorPreco).map((l) => l.empresaId),
        diferenca: arredondar(maiorPreco - menorPreco),
        amplitudePercentual: amplitudePercentual(menorPreco, maiorPreco)
      };
    })
    .sort((a, b) => b.amplitudePercentual - a.amplitudePercentual || a.descricao.localeCompare(b.descricao));

  // Lojas sem nenhum produto em comum com outra loja não entram: não há o que comparar nelas.
  const idsLojas = [...new Set(produtos.flatMap((p) => Object.keys(p.precos).map(Number)))];
  const lojas = idsLojas.length
    ? db
        .prepare(
          `SELECT id, COALESCE(nome_fantasia, razao_social) AS nome, cnpj, municipio, uf
             FROM empresa WHERE id IN (${idsLojas.map(() => '?').join(', ')})
            ORDER BY nome`
        )
        .all(...idsLojas)
    : [];

  const menorPrecoPorLoja = Object.fromEntries(
    lojas.map((l) => [l.id, produtos.filter((p) => p.empresasMaisBaratas.includes(l.id)).length])
  );

  let cesta = null;
  if (lojas.length >= 2) {
    const comuns = produtos.filter((p) => p.lojasComPreco === lojas.length);
    if (comuns.length) {
      const custos = lojas
        .map((l) => ({
          empresaId: l.id,
          total: arredondar(comuns.reduce((s, p) => s + p.precos[l.id].valorUnitario, 0))
        }))
        .sort((a, b) => a.total - b.total || a.empresaId - b.empresaId);
      const maisBarata = custos[0];
      const maisCara = custos[custos.length - 1];
      const economia = arredondar(maisCara.total - maisBarata.total);
      cesta = {
        produtos: comuns.map((p) => p.produtoId),
        custoPorLoja: custos,
        empresaMaisBarata: maisBarata.empresaId,
        empresaMaisCara: maisCara.empresaId,
        economia,
        economiaPercentual: maisCara.total > 0 ? arredondar((economia / maisCara.total) * 100, 1) : 0
      };
    }
  }

  return {
    periodo: { dataInicio: dataInicio || null, dataFim: dataFim || null },
    estabelecimentos: lojas.map((l) => ({ ...l, produtosComMenorPreco: menorPrecoPorLoja[l.id] })),
    produtos,
    cesta
  };
}

/**
 * Vínculo manual entre produtos.
 *
 * Sem código de barras na nota, o sistema identifica o produto pela descrição,
 * que é campo livre do emitente: a mesma lata aparece como "REF COCA COLA S
 * ACUCAR LT 350ML" em uma loja e "COCA COLA ZERO LATA 350 ML" em outra. Juntar
 * esses produtos automaticamente arriscaria misturar itens diferentes, então o
 * sistema só sugere candidatos e o usuário confirma.
 *
 * O vínculo é do usuário: move as compras dele do produto de origem para o de
 * destino, vale para as notas importadas depois e não altera os dados de outros
 * usuários. As sugestões consideram apenas produtos que o próprio usuário comprou.
 */
import { db } from '../db/index.js';
import { recalcularPreco } from './notaService.js';
import { detalharProduto, normalizarDescricao } from './produtoService.js';

/** Abreviações comuns nas descrições dos cupons. */
const ABREVIACOES = {
  REF: 'REFRIGERANTE',
  REFRI: 'REFRIGERANTE',
  REFRIG: 'REFRIGERANTE',
  LT: 'LATA',
  LTA: 'LATA',
  GARR: 'GARRAFA',
  GF: 'GARRAFA',
  PCT: 'PACOTE',
  PC: 'PACOTE',
  CX: 'CAIXA',
  EMB: 'EMBALAGEM',
  TRAD: 'TRADICIONAL',
  INT: 'INTEGRAL',
  DESN: 'DESNATADO',
  CHOC: 'CHOCOLATE',
  MORANG: 'MORANGO'
};

/** Palavras que não ajudam a distinguir produtos. */
const IRRELEVANTES = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'COM', 'C', 'E', 'A', 'O', 'EM', 'P', 'PARA', 'UN', 'UND']);

/**
 * Palavras que definem uma versão diferente do mesmo item: Coca-Cola e Coca-Cola
 * Zero não são o mesmo produto. Candidatos que diferem nessas palavras são descartados.
 */
const VARIANTES = new Set(['ZERO', 'DIET', 'LIGHT', 'INTEGRAL', 'DESNATADO', 'SEMIDESNATADO', 'LACTOSE']);

const UNIDADES = { ML: ['ML', 1], L: ['ML', 1000], LT: ['ML', 1000], LITRO: ['ML', 1000], LITROS: ['ML', 1000], G: ['G', 1], GR: ['G', 1], KG: ['G', 1000], UN: ['UN', 1], UND: ['UN', 1] };

/**
 * Assinatura de comparação de uma descrição: medida normalizada (350ML, 2000ML,
 * 1000G) e o conjunto de palavras, com abreviações expandidas e "sem açúcar"
 * tratado como "zero".
 */
export function assinaturaDescricao(descricao) {
  let texto = ` ${normalizarDescricao(descricao)} `
    .replace(/ S ACUCAR | SEM ACUCAR | ZERO ACUCAR | S ACUC /g, ' ZERO ')
    .replace(/ ZERO LACTOSE | SEM LACTOSE | S LACTOSE /g, ' LACTOSE ');

  let medida = null;
  // "1,5L" chega normalizado como "1 5L": só litros e quilos aceitam a parte decimal.
  texto = texto.replace(/ (\d+)(?: (\d{1,3})(?=\s?(?:L|LT|LITROS?|KG)\b))? ?(ML|LITROS?|LT|L|KG|GR|G|UND|UN)\b/g, (trecho, inteiro, decimal, unidade) => {
    const [base, fator] = UNIDADES[unidade];
    const valor = Number(decimal ? `${inteiro}.${decimal}` : inteiro) * fator;
    medida ??= `${Number(valor.toFixed(3))}${base}`;
    return ' ';
  });

  const palavras = new Set(
    texto
      .split(' ')
      .filter(Boolean)
      .map((p) => ABREVIACOES[p] ?? p)
      .filter((p) => !IRRELEVANTES.has(p) && !/^\d+$/.test(p))
  );
  return { medida, palavras };
}

/**
 * Semelhança entre duas descrições, de 0 a 1: zero quando as medidas ou as
 * variantes (zero, diet, integral...) diferem; caso contrário, a proporção de
 * palavras em comum (índice de Jaccard).
 */
export function semelhancaDescricoes(a, b) {
  const x = assinaturaDescricao(a);
  const y = assinaturaDescricao(b);
  if (x.medida && y.medida && x.medida !== y.medida) return { pontuacao: 0 };
  for (const variante of VARIANTES) if (x.palavras.has(variante) !== y.palavras.has(variante)) return { pontuacao: 0 };

  const comuns = [...x.palavras].filter((p) => y.palavras.has(p));
  const uniao = new Set([...x.palavras, ...y.palavras]).size;
  return {
    pontuacao: uniao ? Number((comuns.length / uniao).toFixed(2)) : 0,
    comuns,
    medida: x.medida && x.medida === y.medida ? x.medida : null
  };
}

const PONTUACAO_MINIMA = 0.5;

/** Produtos que aparecem nas notas do usuário (o de destino dos vínculos já incluso). */
const produtosDoUsuario = (usuarioId) =>
  db
    .prepare(
      `SELECT p.id, p.descricao, p.ean, p.unidade,
              COUNT(DISTINCT n.id) AS compras,
              MAX(n.data_emissao)  AS ultimaCompra,
              GROUP_CONCAT(DISTINCT COALESCE(e.nome_fantasia, e.razao_social)) AS estabelecimentos
         FROM item_nota i
         JOIN nota_fiscal n ON n.id = i.nota_id
         JOIN empresa e     ON e.id = n.empresa_id
         JOIN produto p     ON p.id = i.produto_id
        WHERE n.usuario_id = ?
        GROUP BY p.id`
    )
    .all(usuarioId);

/**
 * Candidatos a mesmo produto, entre os que o usuário comprou. Devolve null quando o
 * usuário não comprou o produto informado.
 */
export function sugerirVinculos(usuarioId, produtoId) {
  const produtos = produtosDoUsuario(usuarioId);
  const alvo = produtos.find((p) => p.id === produtoId);
  if (!alvo) return null;

  return produtos
    .filter((p) => p.id !== produtoId && !(p.ean && alvo.ean && p.ean !== alvo.ean))
    .map((p) => ({ ...p, estabelecimentos: p.estabelecimentos?.split(',') ?? [], ...semelhancaDescricoes(alvo.descricao, p.descricao) }))
    .filter((p) => p.pontuacao >= PONTUACAO_MINIMA)
    .sort((a, b) => b.pontuacao - a.pontuacao || b.compras - a.compras)
    .slice(0, 5)
    .map(({ comuns, medida, ...p }) => ({
      ...p,
      motivo: [medida && `mesma medida (${medida})`, `palavras em comum: ${comuns.join(', ')}`].filter(Boolean).join('; ')
    }));
}

function recalcularPrecosDoUsuario(usuarioId, produtoIds) {
  const lojas = db.prepare(
    `SELECT DISTINCT n.empresa_id AS id FROM item_nota i JOIN nota_fiscal n ON n.id = i.nota_id
      WHERE n.usuario_id = ? AND (i.produto_id = ? OR i.produto_resolvido_id = ?)`
  );
  for (const produtoId of produtoIds) {
    db.prepare('DELETE FROM preco_empresa_produto WHERE usuario_id = ? AND produto_id = ?').run(usuarioId, produtoId);
    for (const loja of lojas.all(usuarioId, produtoId, produtoId)) recalcularPreco(usuarioId, loja.id, produtoId);
  }
}

function naoEncontrado(mensagem) {
  const erro = new Error(mensagem);
  erro.status = 404;
  return erro;
}

/**
 * Registra que `origemId` é o mesmo produto que `destinoId`, para o usuário: as
 * compras do produto de origem passam para o de destino, e os vínculos que
 * apontavam para a origem passam a apontar para o destino.
 */
export const vincularProdutos = db.transaction((usuarioId, destinoId, origemId) => {
  if (destinoId === origemId) {
    const erro = new Error('Escolha um produto diferente para vincular.');
    erro.status = 422;
    throw erro;
  }
  const comprados = new Set(produtosDoUsuario(usuarioId).map((p) => p.id));
  if (!comprados.has(destinoId) || !comprados.has(origemId)) {
    throw naoEncontrado('Produto não encontrado no seu histórico.');
  }

  db.prepare(
    'UPDATE produto_vinculo SET produto_destino_id = ? WHERE usuario_id = ? AND produto_destino_id = ?'
  ).run(destinoId, usuarioId, origemId);
  db.prepare(
    `INSERT INTO produto_vinculo (usuario_id, produto_origem_id, produto_destino_id) VALUES (?, ?, ?)
     ON CONFLICT(usuario_id, produto_origem_id) DO UPDATE SET produto_destino_id = excluded.produto_destino_id`
  ).run(usuarioId, origemId, destinoId);
  db.prepare(
    `UPDATE item_nota SET produto_id = ?
      WHERE produto_id = ? AND nota_id IN (SELECT id FROM nota_fiscal WHERE usuario_id = ?)`
  ).run(destinoId, origemId, usuarioId);

  recalcularPrecosDoUsuario(usuarioId, [origemId, destinoId]);
  return detalharProduto(usuarioId, destinoId);
});

/**
 * Desfaz o vínculo: as compras que foram identificadas como o produto de origem
 * voltam a ele. Devolve null quando o vínculo não existe.
 */
export const desvincularProduto = db.transaction((usuarioId, destinoId, origemId) => {
  const removido = db
    .prepare('DELETE FROM produto_vinculo WHERE usuario_id = ? AND produto_origem_id = ? AND produto_destino_id = ?')
    .run(usuarioId, origemId, destinoId);
  if (removido.changes === 0) return null;

  db.prepare(
    `UPDATE item_nota SET produto_id = produto_resolvido_id
      WHERE produto_id = ? AND produto_resolvido_id = ?
        AND nota_id IN (SELECT id FROM nota_fiscal WHERE usuario_id = ?)`
  ).run(destinoId, origemId, usuarioId);

  recalcularPrecosDoUsuario(usuarioId, [origemId, destinoId]);
  return detalharProduto(usuarioId, destinoId);
});

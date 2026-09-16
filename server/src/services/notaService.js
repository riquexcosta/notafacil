import { db } from '../db/index.js';
import { resolverEmpresa, resolverProduto, historicoDoProduto } from './produtoService.js';

const arredondar = (valor, casas = 2) => Number(Number(valor).toFixed(casas));

/** Referência cronológica gravada com o preço: data e, quando conhecida, a hora. */
export const referenciaDaNota = (dataEmissao, horaEmissao) =>
  horaEmissao ? `${dataEmissao}T${horaEmissao}` : dataEmissao;

/**
 * Compara cada item de uma nota com as compras do mesmo produto feitas pelo
 * usuário ANTES dela. A ordem cronológica usa a data, a hora de emissão (quando
 * a fonte informa) e, como desempate, a ordem de registro. Compras posteriores
 * nunca entram na comparação, então importar notas fora de ordem não altera o
 * resultado de cada uma.
 *
 * Fórmulas, sobre as compras anteriores do produto:
 *   variação percentual = (preço atual − preço da compra anterior mais recente) / preço anterior × 100
 *   situação            = aumento se variação > 1; redução se < −1; estável caso contrário
 *   preço médio         = Σ valor total / Σ quantidade   (média ponderada pela quantidade)
 *   economia possível   = max(0, (preço atual − menor preço anterior) × quantidade atual)
 *
 * Devolve null quando a nota não pertence ao usuário.
 */
export function compararComHistorico(usuarioId, notaId) {
  const nota = db
    .prepare('SELECT id, data_emissao, hora_emissao FROM nota_fiscal WHERE id = ? AND usuario_id = ?')
    .get(notaId, usuarioId);
  if (!nota) return null;

  const itens = db
    .prepare(
      `SELECT i.id, i.produto_id AS produtoId, i.quantidade, i.valor_unitario AS valorUnitario,
              i.valor_total AS valorTotal, p.descricao, p.ean, p.ncm, p.unidade
         FROM item_nota i
         JOIN produto p ON p.id = i.produto_id
        WHERE i.nota_id = ?
        ORDER BY i.id`
    )
    .all(notaId);

  const consultaHistorico = db.prepare(
    `SELECT i.valor_unitario AS valorUnitario,
            i.valor_total    AS valorTotal,
            i.quantidade     AS quantidade,
            n.data_emissao   AS dataEmissao,
            COALESCE(e.nome_fantasia, e.razao_social) AS empresa
       FROM item_nota i
       JOIN nota_fiscal n ON n.id = i.nota_id
       JOIN empresa e     ON e.id = n.empresa_id
      WHERE n.usuario_id = @usuarioId
        AND i.produto_id = @produtoId
        AND (n.data_emissao < @data
             OR (n.data_emissao = @data
                 AND (COALESCE(n.hora_emissao, '') < @hora
                      OR (COALESCE(n.hora_emissao, '') = @hora AND n.id < @notaId))))
      ORDER BY n.data_emissao DESC, COALESCE(n.hora_emissao, '') DESC, n.id DESC, i.id DESC`
  );

  return itens.map((item) => {
    const historico = consultaHistorico.all({
      usuarioId,
      produtoId: item.produtoId,
      data: nota.data_emissao,
      hora: nota.hora_emissao ?? '',
      notaId
    });

    if (historico.length === 0) {
      return { ...item, situacao: 'novo', comparacoes: 0 };
    }

    const anterior = historico[0];
    const menorPreco = Math.min(...historico.map((h) => h.valorUnitario));
    const quantidadeTotal = historico.reduce((s, h) => s + h.quantidade, 0);
    const valorTotal = historico.reduce((s, h) => s + h.valorTotal, 0);
    const variacao = ((item.valorUnitario - anterior.valorUnitario) / anterior.valorUnitario) * 100;

    let situacao = 'estavel';
    if (variacao > 1) situacao = 'aumento';
    else if (variacao < -1) situacao = 'reducao';

    return {
      ...item,
      situacao,
      comparacoes: historico.length,
      precoAnterior: anterior.valorUnitario,
      empresaAnterior: anterior.empresa,
      dataAnterior: anterior.dataEmissao,
      menorPreco,
      precoMedio: quantidadeTotal > 0 ? arredondar(valorTotal / quantidadeTotal) : anterior.valorUnitario,
      variacaoPercentual: arredondar(variacao, 1),
      economiaPossivel: arredondar(Math.max(0, (item.valorUnitario - menorPreco) * item.quantidade))
    };
  });
}

/**
 * Recusa a chave já importada pelo usuário. Chamada também antes da consulta ao
 * provedor, que pode ser paga por requisição.
 */
export function garantirNotaInedita(usuarioId, chave) {
  const jaImportada = db
    .prepare('SELECT id FROM nota_fiscal WHERE usuario_id = ? AND chave_acesso = ?')
    .get(usuarioId, chave);

  if (jaImportada) {
    const erro = new Error('Esta nota fiscal já consta no seu histórico.');
    erro.status = 409;
    erro.notaId = jaImportada.id;
    throw erro;
  }
}

/**
 * Persiste uma nota normalizada. Toda a gravação ocorre em uma única transação:
 * empresa, produtos, nota, itens e o preço por estabelecimento do usuário.
 */
export const importarNota = db.transaction((usuarioId, nota) => {
  garantirNotaInedita(usuarioId, nota.chave);

  const empresaId = resolverEmpresa(nota.emitente);
  const horaEmissao = nota.horaEmissao ?? null;

  const info = db
    .prepare(
      `INSERT INTO nota_fiscal
         (usuario_id, empresa_id, chave_acesso, numero, serie, modelo,
          data_emissao, hora_emissao, valor_total, valor_tributos, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      usuarioId,
      empresaId,
      nota.chave,
      nota.numero,
      nota.serie,
      nota.modelo,
      nota.dataEmissao,
      horaEmissao,
      nota.valorTotal,
      nota.valorTributos,
      nota.origem ?? 'qrcode'
    );

  const notaId = Number(info.lastInsertRowid);

  const inserirItem = db.prepare(
    `INSERT INTO item_nota (nota_id, produto_id, quantidade, valor_unitario, valor_total, valor_tributos)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  // Mantém o preço mais recente do usuário em cada estabelecimento: só substitui
  // a referência gravada se esta nota for igual ou mais nova.
  const upsertPreco = db.prepare(
    `INSERT INTO preco_empresa_produto (usuario_id, empresa_id, produto_id, valor_unitario, data_referencia)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(usuario_id, empresa_id, produto_id) DO UPDATE SET
       valor_unitario  = excluded.valor_unitario,
       data_referencia = excluded.data_referencia
     WHERE excluded.data_referencia >= preco_empresa_produto.data_referencia`
  );

  const referencia = referenciaDaNota(nota.dataEmissao, horaEmissao);

  for (const item of nota.itens) {
    const produtoId = resolverProduto(item);
    inserirItem.run(
      notaId,
      produtoId,
      item.quantidade,
      item.valorUnitario,
      item.valorTotal,
      item.valorTributos ?? 0
    );
    upsertPreco.run(usuarioId, empresaId, produtoId, item.valorUnitario, referencia);
  }

  return notaId;
});

/** Recalcula o preço mais recente de um produto em um estabelecimento, para um usuário. */
function recalcularPreco(usuarioId, empresaId, produtoId) {
  db.prepare(
    'DELETE FROM preco_empresa_produto WHERE usuario_id = ? AND empresa_id = ? AND produto_id = ?'
  ).run(usuarioId, empresaId, produtoId);

  db.prepare(
    `INSERT INTO preco_empresa_produto (usuario_id, empresa_id, produto_id, valor_unitario, data_referencia)
     SELECT n.usuario_id, n.empresa_id, i.produto_id, i.valor_unitario,
            n.data_emissao || COALESCE('T' || n.hora_emissao, '')
       FROM item_nota i
       JOIN nota_fiscal n ON n.id = i.nota_id
      WHERE n.usuario_id = ? AND n.empresa_id = ? AND i.produto_id = ?
      ORDER BY n.data_emissao DESC, COALESCE(n.hora_emissao, '') DESC, n.id DESC, i.id DESC
      LIMIT 1`
  ).run(usuarioId, empresaId, produtoId);
}

/**
 * Remove produtos e estabelecimentos que não aparecem em nenhuma nota. Aplica a
 * minimização de dados da LGPD depois de exclusões: nada fica guardado sem uso.
 */
export function removerRegistrosOrfaos() {
  db.prepare('DELETE FROM produto WHERE id NOT IN (SELECT produto_id FROM item_nota)').run();
  db.prepare('DELETE FROM empresa WHERE id NOT IN (SELECT empresa_id FROM nota_fiscal)').run();
}

/**
 * Exclui uma nota do usuário, com seus itens, e recalcula os preços por
 * estabelecimento afetados. Devolve false quando a nota não pertence ao usuário.
 */
export const excluirNota = db.transaction((usuarioId, notaId) => {
  const nota = db
    .prepare('SELECT id, empresa_id FROM nota_fiscal WHERE id = ? AND usuario_id = ?')
    .get(notaId, usuarioId);
  if (!nota) return false;

  const produtos = db
    .prepare('SELECT DISTINCT produto_id AS id FROM item_nota WHERE nota_id = ?')
    .all(notaId)
    .map((p) => p.id);

  db.prepare('DELETE FROM nota_fiscal WHERE id = ?').run(notaId);
  for (const produtoId of produtos) recalcularPreco(usuarioId, nota.empresa_id, produtoId);
  removerRegistrosOrfaos();
  return true;
});

/** Monta as condições dos filtros do histórico de notas. */
function filtrosDeNotas(usuarioId, { chave, dataInicio, dataFim, empresaId, busca } = {}) {
  const condicoes = ['n.usuario_id = ?'];
  const parametros = [usuarioId];

  if (chave) {
    condicoes.push('n.chave_acesso LIKE ?');
    parametros.push(`%${chave}%`);
  }
  if (dataInicio) {
    condicoes.push('n.data_emissao >= ?');
    parametros.push(dataInicio);
  }
  if (dataFim) {
    condicoes.push('n.data_emissao <= ?');
    parametros.push(dataFim);
  }
  if (empresaId) {
    condicoes.push('n.empresa_id = ?');
    parametros.push(empresaId);
  }
  if (busca) {
    condicoes.push('(e.razao_social LIKE ? OR e.nome_fantasia LIKE ? OR e.cnpj LIKE ?)');
    parametros.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  return { onde: condicoes.join(' AND '), parametros };
}

export const LIMITE_LISTAGEM_NOTAS = 200;

/**
 * Lista as notas do usuário. Quantidade e totais são calculados sobre TODAS as
 * notas que atendem aos filtros; só a lista exibida é limitada.
 */
export function listarNotas(usuarioId, filtros = {}) {
  const { onde, parametros } = filtrosDeNotas(usuarioId, filtros);

  const totais = db
    .prepare(
      `SELECT COUNT(*) AS quantidade,
              COALESCE(SUM(n.valor_total), 0)    AS valorTotal,
              COALESCE(SUM(n.valor_tributos), 0) AS valorTributos
         FROM nota_fiscal n
         JOIN empresa e ON e.id = n.empresa_id
        WHERE ${onde}`
    )
    .get(...parametros);

  const notas = db
    .prepare(
      `SELECT n.id, n.chave_acesso AS chave, n.numero, n.serie, n.modelo,
              n.data_emissao AS dataEmissao, n.hora_emissao AS horaEmissao,
              n.valor_total AS valorTotal, n.valor_tributos AS valorTributos, n.origem,
              e.id AS empresaId, e.razao_social AS razaoSocial,
              e.nome_fantasia AS nomeFantasia, e.cnpj, e.municipio, e.uf,
              (SELECT COUNT(*) FROM item_nota i WHERE i.nota_id = n.id) AS totalItens
         FROM nota_fiscal n
         JOIN empresa e ON e.id = n.empresa_id
        WHERE ${onde}
        ORDER BY n.data_emissao DESC, COALESCE(n.hora_emissao, '') DESC, n.id DESC
        LIMIT ${LIMITE_LISTAGEM_NOTAS}`
    )
    .all(...parametros);

  return {
    quantidade: totais.quantidade,
    valorTotal: arredondar(totais.valorTotal),
    valorTributos: arredondar(totais.valorTributos),
    limite: LIMITE_LISTAGEM_NOTAS,
    notas
  };
}

/** Participação dos tributos no valor pago, em %. Null quando não há valor pago. */
export const percentualTributos = (tributos, total) =>
  total > 0 ? arredondar((tributos / total) * 100, 1) : null;

export function obterNota(usuarioId, notaId) {
  const nota = db
    .prepare(
      `SELECT n.id, n.chave_acesso AS chave, n.numero, n.serie, n.modelo,
              n.data_emissao AS dataEmissao, n.hora_emissao AS horaEmissao,
              n.valor_total AS valorTotal, n.valor_tributos AS valorTributos, n.origem,
              e.id AS empresaId, e.razao_social AS razaoSocial, e.nome_fantasia AS nomeFantasia,
              e.cnpj, e.logradouro, e.municipio, e.uf
         FROM nota_fiscal n
         JOIN empresa e ON e.id = n.empresa_id
        WHERE n.usuario_id = ? AND n.id = ?`
    )
    .get(usuarioId, notaId);

  if (!nota) return null;

  nota.percentualTributos = percentualTributos(nota.valorTributos, nota.valorTotal);
  nota.itens = compararComHistorico(usuarioId, notaId);
  return nota;
}

/** Lista os meses AAAA-MM de `inicio` a `fim`, inclusive. */
export function mesesEntre(inicio, fim) {
  const meses = [];
  let [ano, mes] = inicio.split('-').map(Number);
  const [anoFim, mesFim] = fim.split('-').map(Number);
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    meses.push(`${ano}-${String(mes).padStart(2, '0')}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return meses;
}

/**
 * Indicadores do painel. Fórmulas:
 *   total gasto             = Σ valor total das notas
 *   tributos (%)            = Σ tributos / Σ valor total × 100
 *   ticket médio            = total gasto / número de notas
 *   gasto por mês           = Σ valor total das notas do mês, com zero nos meses sem compra
 *   amplitude de um produto = (maior preço unitário − menor) / menor × 100, entre 2+ notas
 */
export function resumoDoUsuario(usuarioId) {
  const totais = db
    .prepare(
      `SELECT COUNT(*)                         AS totalNotas,
              COALESCE(SUM(valor_total), 0)    AS totalGasto,
              COALESCE(SUM(valor_tributos), 0) AS totalTributos,
              MIN(data_emissao)                AS primeiraCompra,
              MAX(data_emissao)                AS ultimaCompra
         FROM nota_fiscal WHERE usuario_id = ?`
    )
    .get(usuarioId);

  const totalEstabelecimentos = db
    .prepare('SELECT COUNT(DISTINCT empresa_id) AS total FROM nota_fiscal WHERE usuario_id = ?')
    .get(usuarioId).total;

  const totalProdutos = db
    .prepare(
      `SELECT COUNT(DISTINCT i.produto_id) AS total
         FROM item_nota i JOIN nota_fiscal n ON n.id = i.nota_id
        WHERE n.usuario_id = ?`
    )
    .get(usuarioId).total;

  const somaPorMes = new Map(
    db
      .prepare(
        `SELECT substr(data_emissao, 1, 7) AS mes, SUM(valor_total) AS total
           FROM nota_fiscal WHERE usuario_id = ?
          GROUP BY mes`
      )
      .all(usuarioId)
      .map((m) => [m.mes, m.total])
  );

  const gastoPorMes = totais.totalNotas
    ? mesesEntre(totais.primeiraCompra.slice(0, 7), totais.ultimaCompra.slice(0, 7)).map((mes) => ({
        mes,
        total: arredondar(somaPorMes.get(mes) ?? 0)
      }))
    : [];

  const maioresVariacoes = db
    .prepare(
      `SELECT p.id, p.descricao, p.unidade,
              MIN(i.valor_unitario) AS menorPreco,
              MAX(i.valor_unitario) AS maiorPreco,
              COUNT(DISTINCT n.id)  AS ocorrencias
         FROM item_nota i
         JOIN nota_fiscal n ON n.id = i.nota_id
         JOIN produto p     ON p.id = i.produto_id
        WHERE n.usuario_id = ?
        GROUP BY p.id
       HAVING ocorrencias >= 2 AND menorPreco > 0
        ORDER BY (maiorPreco - menorPreco) / menorPreco DESC, p.descricao
        LIMIT 5`
    )
    .all(usuarioId)
    .map((l) => ({
      ...l,
      amplitudePercentual: arredondar(((l.maiorPreco - l.menorPreco) / l.menorPreco) * 100, 1)
    }));

  return {
    ...totais,
    totalGasto: arredondar(totais.totalGasto),
    totalTributos: arredondar(totais.totalTributos),
    percentualTributos: percentualTributos(totais.totalTributos, totais.totalGasto),
    ticketMedio: totais.totalNotas ? arredondar(totais.totalGasto / totais.totalNotas) : 0,
    totalEstabelecimentos,
    totalProdutos,
    gastoPorMes,
    maioresVariacoes
  };
}

export function listarEmpresas(usuarioId) {
  return db
    .prepare(
      `SELECT e.id, e.cnpj, e.razao_social AS razaoSocial, e.nome_fantasia AS nomeFantasia,
              e.municipio, e.uf,
              COUNT(n.id)                    AS totalNotas,
              ROUND(SUM(n.valor_total), 2)   AS totalGasto,
              MAX(n.data_emissao)            AS ultimaCompra
         FROM empresa e
         JOIN nota_fiscal n ON n.empresa_id = e.id
        WHERE n.usuario_id = ?
        GROUP BY e.id
        ORDER BY totalGasto DESC`
    )
    .all(usuarioId);
}

export { historicoDoProduto };

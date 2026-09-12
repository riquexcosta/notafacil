import { db } from '../db/index.js';
import { resolverEmpresa, resolverProduto, historicoDoProduto } from './produtoService.js';

/**
 * Compara cada item de uma nota recém-importada com o histórico de compras do
 * usuário, desconsiderando a própria nota. Para cada item devolve o último
 * preço pago, o menor preço já registrado e a variação percentual.
 */
export function compararComHistorico(usuarioId, notaId) {
  const itens = db
    .prepare(
      `SELECT i.id, i.produto_id AS produtoId, i.quantidade, i.valor_unitario AS valorUnitario,
              i.valor_total AS valorTotal, p.descricao, p.ean, p.ncm, p.unidade
         FROM item_nota i
         JOIN produto p ON p.id = i.produto_id
        WHERE i.nota_id = ?`
    )
    .all(notaId);

  const consultaHistorico = db.prepare(
    `SELECT i.valor_unitario AS valorUnitario,
            n.data_emissao   AS dataEmissao,
            e.nome_fantasia  AS empresa
       FROM item_nota i
       JOIN nota_fiscal n ON n.id = i.nota_id
       JOIN empresa e     ON e.id = n.empresa_id
      WHERE n.usuario_id = ? AND i.produto_id = ? AND n.id <> ?
      ORDER BY n.data_emissao DESC`
  );

  return itens.map((item) => {
    const historico = consultaHistorico.all(usuarioId, item.produtoId, notaId);

    if (historico.length === 0) {
      return { ...item, situacao: 'novo', comparacoes: 0 };
    }

    const precos = historico.map((h) => h.valorUnitario);
    const anterior = historico[0];
    const menorPreco = Math.min(...precos);
    const precoMedio = precos.reduce((s, v) => s + v, 0) / precos.length;
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
      precoMedio: Number(precoMedio.toFixed(2)),
      variacaoPercentual: Number(variacao.toFixed(1)),
      // Quanto teria sido economizado pagando o menor preço já registrado.
      // Zero quando a compra atual já é a mais barata da série.
      economiaPossivel: Number(
        Math.max(0, (item.valorUnitario - menorPreco) * item.quantidade).toFixed(2)
      )
    };
  });
}

/**
 * Persiste uma nota normalizada e devolve a comparação de preços.
 * Toda a gravação ocorre em uma única transação: empresa, produtos, nota,
 * itens e a tabela de preços por estabelecimento.
 */
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

export const importarNota = db.transaction((usuarioId, nota) => {
  garantirNotaInedita(usuarioId, nota.chave);

  const empresaId = resolverEmpresa(nota.emitente);

  const info = db
    .prepare(
      `INSERT INTO nota_fiscal
         (usuario_id, empresa_id, chave_acesso, numero, serie, modelo,
          data_emissao, valor_total, valor_tributos, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      usuarioId,
      empresaId,
      nota.chave,
      nota.numero,
      nota.serie,
      nota.modelo,
      nota.dataEmissao,
      nota.valorTotal,
      nota.valorTributos,
      nota.origem ?? 'qrcode'
    );

  const notaId = Number(info.lastInsertRowid);

  const inserirItem = db.prepare(
    `INSERT INTO item_nota (nota_id, produto_id, quantidade, valor_unitario, valor_total, valor_tributos)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  // Mantém o preço mais recente por estabelecimento: insere ou atualiza apenas
  // se a nota for mais nova que a referência já gravada.
  const upsertPreco = db.prepare(
    `INSERT INTO preco_empresa_produto (empresa_id, produto_id, valor_unitario, data_referencia)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(empresa_id, produto_id) DO UPDATE SET
       valor_unitario  = excluded.valor_unitario,
       data_referencia = excluded.data_referencia
     WHERE excluded.data_referencia >= preco_empresa_produto.data_referencia`
  );

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
    upsertPreco.run(empresaId, produtoId, item.valorUnitario, nota.dataEmissao);
  }

  return notaId;
});

export function listarNotas(usuarioId, { chave, dataInicio, dataFim, empresaId, busca } = {}) {
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

  return db
    .prepare(
      `SELECT n.id, n.chave_acesso AS chave, n.numero, n.serie, n.modelo,
              n.data_emissao AS dataEmissao, n.valor_total AS valorTotal,
              n.valor_tributos AS valorTributos, n.origem,
              e.id AS empresaId, e.razao_social AS razaoSocial,
              e.nome_fantasia AS nomeFantasia, e.cnpj, e.municipio, e.uf,
              (SELECT COUNT(*) FROM item_nota i WHERE i.nota_id = n.id) AS totalItens
         FROM nota_fiscal n
         JOIN empresa e ON e.id = n.empresa_id
        WHERE ${condicoes.join(' AND ')}
        ORDER BY n.data_emissao DESC, n.id DESC
        LIMIT 200`
    )
    .all(...parametros);
}

export function obterNota(usuarioId, notaId) {
  const nota = db
    .prepare(
      `SELECT n.id, n.chave_acesso AS chave, n.numero, n.serie, n.modelo,
              n.data_emissao AS dataEmissao, n.valor_total AS valorTotal,
              n.valor_tributos AS valorTributos, n.origem,
              e.id AS empresaId, e.razao_social AS razaoSocial, e.nome_fantasia AS nomeFantasia,
              e.cnpj, e.logradouro, e.municipio, e.uf
         FROM nota_fiscal n
         JOIN empresa e ON e.id = n.empresa_id
        WHERE n.usuario_id = ? AND n.id = ?`
    )
    .get(usuarioId, notaId);

  if (!nota) return null;

  nota.itens = compararComHistorico(usuarioId, notaId);
  return nota;
}

/** Indicadores agregados exibidos no painel inicial. */
export function resumoDoUsuario(usuarioId) {
  const totais = db
    .prepare(
      `SELECT COUNT(*)                       AS totalNotas,
              COALESCE(SUM(valor_total), 0)  AS totalGasto,
              COALESCE(SUM(valor_tributos), 0) AS totalTributos,
              MIN(data_emissao)              AS primeiraCompra,
              MAX(data_emissao)              AS ultimaCompra
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

  const gastoPorMes = db
    .prepare(
      `SELECT substr(data_emissao, 1, 7) AS mes, ROUND(SUM(valor_total), 2) AS total
         FROM nota_fiscal WHERE usuario_id = ?
        GROUP BY mes ORDER BY mes ASC`
    )
    .all(usuarioId);

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
        ORDER BY (maiorPreco - menorPreco) / menorPreco DESC
        LIMIT 5`
    )
    .all(usuarioId)
    .map((l) => ({
      ...l,
      variacaoPercentual: Number((((l.maiorPreco - l.menorPreco) / l.menorPreco) * 100).toFixed(1))
    }));

  return {
    ...totais,
    totalGasto: Number(totais.totalGasto.toFixed(2)),
    totalTributos: Number(totais.totalTributos.toFixed(2)),
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

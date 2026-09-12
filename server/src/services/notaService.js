import { db } from '../db/index.js';
import { resolverEmpresa, resolverProduto } from './produtoService.js';

/**
 * Persiste uma nota normalizada e devolve a comparação de preços.
 * Toda a gravação ocorre em uma única transação: empresa, produtos, nota,
 * itens e a tabela de preços por estabelecimento.
 */
export const importarNota = db.transaction((usuarioId, nota) => {
  const jaImportada = db
    .prepare('SELECT id FROM nota_fiscal WHERE usuario_id = ? AND chave_acesso = ?')
    .get(usuarioId, nota.chave);

  if (jaImportada) {
    const erro = new Error('Esta nota fiscal já consta no seu histórico.');
    erro.status = 409;
    erro.notaId = jaImportada.id;
    throw erro;
  }

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

  nota.itens = db
    .prepare(
      `SELECT i.id, i.produto_id AS produtoId, i.quantidade, i.valor_unitario AS valorUnitario,
              i.valor_total AS valorTotal, p.descricao, p.ean, p.ncm, p.unidade
         FROM item_nota i
         JOIN produto p ON p.id = i.produto_id
        WHERE i.nota_id = ?`
    )
    .all(notaId);
  return nota;
}

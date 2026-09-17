import { db } from '../db/index.js';
import { dadosPublicosDaConta, senhaConfere } from '../auth.js';
import { POLITICA, VERSAO_POLITICA } from '../lgpd/politica.js';
import { removerRegistrosOrfaos } from './notaService.js';

/** Direitos do titular (art. 18 da LGPD): acesso, correção, portabilidade e eliminação. */

export function obterConta(usuarioId) {
  const conta = dadosPublicosDaConta(usuarioId);
  return conta && { ...conta, politicaVersaoAtual: VERSAO_POLITICA };
}

/** Corrige nome e e-mail. O e-mail continua único entre as contas. */
export function atualizarConta(usuarioId, { nome, email }) {
  if (email) {
    const outro = db
      .prepare('SELECT id FROM usuario WHERE email = ? AND id <> ?')
      .get(email.toLowerCase(), usuarioId);
    if (outro) {
      const erro = new Error('Já existe uma conta com este e-mail.');
      erro.status = 409;
      throw erro;
    }
  }
  db.prepare('UPDATE usuario SET nome = COALESCE(?, nome), email = COALESCE(?, email) WHERE id = ?').run(
    nome ?? null,
    email ? email.toLowerCase() : null,
    usuarioId
  );
  return obterConta(usuarioId);
}

/** Registra o aceite da versão vigente da política. */
export function aceitarPolitica(usuarioId, versao) {
  if (versao !== VERSAO_POLITICA) {
    const erro = new Error(`A versão vigente da política é ${VERSAO_POLITICA}.`);
    erro.status = 422;
    throw erro;
  }
  db.prepare('UPDATE usuario SET politica_versao = ?, politica_aceita_em = ? WHERE id = ?').run(
    VERSAO_POLITICA,
    new Date().toISOString(),
    usuarioId
  );
  return obterConta(usuarioId);
}

/**
 * Portabilidade e acesso: todos os dados pessoais do usuário, em formato
 * estruturado. O hash da senha não é exportado.
 */
export function exportarDados(usuarioId) {
  const notas = db
    .prepare(
      `SELECT n.id, n.chave_acesso AS chave, n.numero, n.serie, n.modelo,
              n.data_emissao AS dataEmissao, n.hora_emissao AS horaEmissao,
              n.valor_total AS valorTotal, n.valor_tributos AS valorTributos, n.origem,
              n.criado_em AS registradaEm,
              e.cnpj, e.razao_social AS razaoSocial, e.nome_fantasia AS nomeFantasia,
              e.logradouro, e.municipio, e.uf
         FROM nota_fiscal n
         JOIN empresa e ON e.id = n.empresa_id
        WHERE n.usuario_id = ?
        ORDER BY n.data_emissao, COALESCE(n.hora_emissao, ''), n.id`
    )
    .all(usuarioId);

  const itensDaNota = db.prepare(
    `SELECT p.descricao, p.ean, p.ncm, p.unidade, i.quantidade, i.valor_unitario AS valorUnitario,
            i.valor_total AS valorTotal, i.valor_tributos AS valorTributos
       FROM item_nota i JOIN produto p ON p.id = i.produto_id
      WHERE i.nota_id = ? ORDER BY i.id`
  );

  const precos = db
    .prepare(
      `SELECT e.cnpj, COALESCE(e.nome_fantasia, e.razao_social) AS estabelecimento,
              p.descricao, p.ean, pep.valor_unitario AS valorUnitario, pep.data_referencia AS dataReferencia
         FROM preco_empresa_produto pep
         JOIN empresa e ON e.id = pep.empresa_id
         JOIN produto p ON p.id = pep.produto_id
        WHERE pep.usuario_id = ?
        ORDER BY estabelecimento, p.descricao`
    )
    .all(usuarioId);

  const vinculos = db
    .prepare(
      `SELECT o.descricao AS produto, o.ean, d.descricao AS mesmoProdutoQue, v.criado_em AS vinculadoEm
         FROM produto_vinculo v
         JOIN produto o ON o.id = v.produto_origem_id
         JOIN produto d ON d.id = v.produto_destino_id
        WHERE v.usuario_id = ?
        ORDER BY d.descricao, o.descricao`
    )
    .all(usuarioId);

  const conta = dadosPublicosDaConta(usuarioId);
  return {
    geradoEm: new Date().toISOString(),
    controlador: POLITICA.controlador,
    conta: {
      nome: conta.nome,
      email: conta.email,
      criadoEm: conta.criadoEm,
      politicaVersao: conta.politicaVersao,
      politicaAceitaEm: conta.politicaAceitaEm
    },
    notas: notas.map(({ id, ...nota }) => ({ ...nota, itens: itensDaNota.all(id) })),
    precosPorEstabelecimento: precos,
    vinculosDeProdutos: vinculos
  };
}

/**
 * Eliminação: apaga a conta e, em cascata, notas, itens e preços do usuário.
 * Exige a senha atual. Devolve false quando a senha não confere.
 */
export const excluirConta = db.transaction((usuarioId, senha) => {
  if (!senhaConfere(usuarioId, senha)) return false;
  db.prepare('DELETE FROM usuario WHERE id = ?').run(usuarioId);
  removerRegistrosOrfaos();
  return true;
});

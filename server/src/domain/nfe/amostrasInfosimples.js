/**
 * Gravação opcional das respostas da Infosimples, usada para conferir o formato
 * de UFs novas. Só grava com INFOSIMPLES_AMOSTRAS_DIR definido, e sem os dados
 * do consumidor e da conta consultante.
 */
import fs from 'node:fs';
import path from 'node:path';

const CAMPOS_PESSOAIS = new Set(['consumidor', 'destinatario', 'header']);

/** Cópia da resposta sem consumidor, destinatário e cabeçalho da conta, em qualquer nível. */
export function anonimizarResposta(valor) {
  if (Array.isArray(valor)) return valor.map(anonimizarResposta);
  if (!valor || typeof valor !== 'object') return valor;
  return Object.fromEntries(
    Object.entries(valor)
      .filter(([campo]) => !CAMPOS_PESSOAIS.has(campo))
      .map(([campo, conteudo]) => [campo, anonimizarResposta(conteudo)])
  );
}

/** Devolve o gravador para o provedor, ou undefined quando a gravação está desligada. */
export function criarGravadorDeAmostras(diretorio = process.env.INFOSIMPLES_AMOSTRAS_DIR?.trim()) {
  if (!diretorio) return undefined;
  return (servico, chave, resposta) => {
    try {
      fs.mkdirSync(diretorio, { recursive: true });
      const nome = `${servico.replaceAll('/', '_')}-${chave}-code${resposta?.code}.json`;
      fs.writeFileSync(path.join(diretorio, nome), JSON.stringify(anonimizarResposta(resposta), null, 2));
    } catch (erro) {
      console.warn(`[infosimples] não foi possível gravar a amostra: ${erro.message}`);
    }
  };
}

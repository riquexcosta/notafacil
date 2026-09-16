/**
 * Gravação opcional das respostas da Infosimples, usada para conferir o formato
 * de UFs novas. Só grava com INFOSIMPLES_AMOSTRAS_DIR definido, e sem os dados
 * do consumidor, do emitente pessoa física, da conta consultante, dados de
 * cobrança e links de acesso aos arquivos da consulta.
 */
import fs from 'node:fs';
import path from 'node:path';

const CAMPOS_RETIRADOS = new Set([
  'consumidor',
  'destinatario',
  'header',
  'cobranca',
  'info_adicionais',
  'site_receipt',
  'site_receipts',
  'url_html',
  'url_xml'
]);

const digitos = (v) => String(v ?? '').replace(/\D/g, '');
/** Emitente, produtor ou similar identificado por CPF e sem CNPJ. */
const ehPessoaFisica = (objeto) => digitos(objeto.cpf || objeto.normalizado_cpf) && !digitos(objeto.cnpj || objeto.normalizado_cnpj);

/** Cópia da resposta sem dados pessoais, de cobrança e links de acesso, em qualquer nível. */
export function anonimizarResposta(valor) {
  if (Array.isArray(valor)) return valor.map(anonimizarResposta);
  if (!valor || typeof valor !== 'object') return valor;
  if (ehPessoaFisica(valor)) return { pessoa_fisica: true };
  return Object.fromEntries(
    Object.entries(valor)
      .filter(([campo]) => !CAMPOS_RETIRADOS.has(campo))
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

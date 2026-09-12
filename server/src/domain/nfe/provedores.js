import { interpretarChave } from '../chaveAcesso.js';
import { CATALOGO_DEMONSTRACAO } from './catalogoDemonstracao.js';

/**
 * Porta (interface) de obtenção de documentos fiscais.
 *
 *   consultar(chave) -> Promise<NotaFiscalNormalizada>
 *
 * A aplicação depende apenas deste contrato. As implementações concretas
 * (XML autorizado, web service da SEFAZ, catálogo local) são intercambiáveis,
 * o que permite trocar a fonte dos dados sem alterar os casos de uso.
 */

/**
 * ProvedorSefaz — adaptador previsto para o web service de distribuição de
 * documentos fiscais (NFeDistribuicaoDFe). A consulta exige certificado digital
 * A1/A3 do destinatário, requisito fora do escopo deste MVP; a classe permanece
 * como ponto de extensão e sinaliza explicitamente a indisponibilidade.
 */
export class ProvedorSefaz {
  get nome() {
    return 'sefaz';
  }

  async consultar() {
    const erro = new Error(
      'Consulta à SEFAZ indisponível: exige certificado digital do destinatário.'
    );
    erro.codigo = 'PROVEDOR_INDISPONIVEL';
    throw erro;
  }
}

/**
 * ProvedorCatalogoLocal — implementação de contingência usada em demonstração e
 * em testes. A partir da chave de acesso (que já carrega CNPJ, data, série e
 * número reais) monta a nota com itens de um catálogo local determinístico,
 * derivado do código numérico da própria chave. Os dados dos itens são
 * sintéticos e a nota é marcada com `origem: 'demo'`.
 */
export class ProvedorCatalogoLocal {
  constructor(catalogo = CATALOGO_DEMONSTRACAO) {
    this.catalogo = catalogo;
  }

  get nome() {
    return 'catalogo-local';
  }

  async consultar(chave) {
    const meta = interpretarChave(chave);
    const emitente =
      this.catalogo.empresas.find((e) => e.cnpj === meta.cnpjEmitente) ??
      this.catalogo.empresas[Number(meta.codigoNumerico) % this.catalogo.empresas.length];

    const semente = Number(meta.codigoNumerico);
    const quantidadeItens = 3 + (semente % 4);
    const itens = [];

    for (let i = 0; i < quantidadeItens; i++) {
      const base = this.catalogo.produtos[(semente + i * 7) % this.catalogo.produtos.length];
      // Variação de preço determinística de -12% a +12% em torno do preço de referência
      const desvio = (((semente + i * 31) % 25) - 12) / 100;
      const valorUnitario = Number((base.precoReferencia * (1 + desvio)).toFixed(2));
      const quantidade = base.unidade === 'KG' ? Number((0.4 + ((semente + i) % 12) / 10).toFixed(3)) : 1 + ((semente + i) % 3);
      const valorTotal = Number((valorUnitario * quantidade).toFixed(2));

      itens.push({
        ean: base.ean,
        ncm: base.ncm,
        descricao: base.descricao,
        unidade: base.unidade,
        quantidade,
        valorUnitario,
        valorTotal,
        valorTributos: Number((valorTotal * base.cargaTributaria).toFixed(2))
      });
    }

    const valorTotal = Number(itens.reduce((s, i) => s + i.valorTotal, 0).toFixed(2));
    const valorTributos = Number(itens.reduce((s, i) => s + i.valorTributos, 0).toFixed(2));
    const dia = String(1 + (semente % 28)).padStart(2, '0');

    return {
      chave,
      numero: meta.numero,
      serie: meta.serie,
      modelo: meta.modelo,
      dataEmissao: `${meta.anoMesEmissao}-${dia}`,
      valorTotal,
      valorTributos,
      emitente,
      origem: 'demo',
      itens
    };
  }
}

/**
 * Encadeia provedores: usa o primeiro que responder. Permite ligar a SEFAZ no
 * futuro sem tocar nos casos de uso — basta colocá-la à frente da cadeia.
 */
export class CadeiaDeProvedores {
  constructor(provedores) {
    this.provedores = provedores;
  }

  get nome() {
    return 'cadeia';
  }

  async consultar(chave) {
    let ultimoErro;
    for (const provedor of this.provedores) {
      try {
        return await provedor.consultar(chave);
      } catch (erro) {
        if (erro.codigo !== 'PROVEDOR_INDISPONIVEL') throw erro;
        ultimoErro = erro;
      }
    }
    throw ultimoErro ?? new Error('Nenhum provedor conseguiu atender à consulta.');
  }
}

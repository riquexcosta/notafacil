import { XMLParser } from 'fast-xml-parser';
import { interpretarChave, somenteDigitos } from '../chaveAcesso.js';
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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true
});

const numero = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** Normaliza um GTIN: a SEFAZ usa "SEM GTIN" quando o produto não possui código. */
function normalizarEan(valor) {
  const d = somenteDigitos(valor);
  return d.length >= 8 ? d : null;
}

/**
 * ProvedorXmlAutorizado — lê o XML de autorização da NF-e/NFC-e.
 * É o caminho de maior fidelidade: os dados vêm do próprio documento fiscal.
 */
export class ProvedorXmlAutorizado {
  get nome() {
    return 'xml';
  }

  async consultarPorXml(conteudoXml) {
    const raiz = parser.parse(conteudoXml);
    const nfeProc = raiz.nfeProc ?? raiz;
    const nfe = nfeProc.NFe ?? nfeProc.nfe;
    if (!nfe) throw new Error('XML não contém um elemento <NFe>.');

    const inf = nfe.infNFe ?? nfe.infnfe;
    const ide = inf.ide ?? {};
    const emit = inf.emit ?? {};
    const ender = emit.enderEmit ?? {};
    const total = inf.total?.ICMSTot ?? {};

    const chave = somenteDigitos(inf['@_Id'] ?? '');

    const itens = lista(inf.det).map((det) => {
      const prod = det.prod ?? {};
      const valorTotal = numero(prod.vProd);
      const quantidade = numero(prod.qCom) || 1;
      return {
        ean: normalizarEan(prod.cEAN ?? prod.cEANTrib),
        ncm: prod.NCM ? String(prod.NCM) : null,
        descricao: String(prod.xProd ?? 'Produto sem descrição'),
        unidade: prod.uCom ? String(prod.uCom) : 'UN',
        quantidade,
        valorUnitario: numero(prod.vUnCom) || valorTotal / quantidade,
        valorTotal,
        valorTributos: numero(det.imposto?.vTotTrib)
      };
    });

    return {
      chave,
      numero: String(ide.nNF ?? ''),
      serie: String(ide.serie ?? ''),
      modelo: String(ide.mod ?? ''),
      dataEmissao: String(ide.dhEmi ?? ide.dEmi ?? '').slice(0, 10),
      valorTotal: numero(total.vNF),
      valorTributos: numero(total.vTotTrib),
      emitente: {
        cnpj: somenteDigitos(emit.CNPJ),
        razaoSocial: String(emit.xNome ?? 'Emitente não identificado'),
        nomeFantasia: emit.xFant ? String(emit.xFant) : null,
        logradouro: [ender.xLgr, ender.nro].filter(Boolean).join(', ') || null,
        municipio: ender.xMun ? String(ender.xMun) : null,
        uf: ender.UF ? String(ender.UF) : null
      },
      origem: 'xml',
      itens
    };
  }
}

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

import { XMLParser } from 'fast-xml-parser';
import { interpretarChave, somenteDigitos } from '../chaveAcesso.js';
import { CATALOGO_DEMONSTRACAO } from './catalogoDemonstracao.js';

/**
 * Porta (interface) de obtenção de documentos fiscais.
 *
 *   consultar(chave, { conteudoQr }?) -> Promise<NotaFiscalNormalizada>
 *
 * A aplicação depende apenas deste contrato. As implementações concretas
 * (XML autorizado, web service da SEFAZ, consulta assistida, catálogo local)
 * são intercambiáveis, o que permite trocar a fonte dos dados sem alterar os
 * casos de uso.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true
});

const numero = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** Hora HH:MM:SS a partir de "HH:MM", "HH:MM:SS" ou de um carimbo ISO; null se ausente. */
function horaDe(valor) {
  const achado = String(valor ?? '').match(/(?:^|T)(\d{2}):(\d{2})(?::(\d{2}))?/);
  return achado ? `${achado[1]}:${achado[2]}:${achado[3] ?? '00'}` : null;
}

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
    if (!inf) throw new Error('XML não contém o grupo <infNFe>.');
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
      horaEmissao: ide.dhEmi ? horaDe(String(ide.dhEmi)) : null,
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

function indisponivel(mensagem) {
  const erro = new Error(mensagem);
  erro.codigo = 'PROVEDOR_INDISPONIVEL';
  return erro;
}

/** Devolve o código só se for um GTIN (EAN-8/12/13/14) com dígito verificador válido. */
function gtinValido(codigo) {
  const d = String(codigo ?? '').trim();
  if (!/^(\d{8}|\d{12,14})$/.test(d)) return null;
  let soma = 0;
  for (let i = d.length - 2, peso = 3; i >= 0; i--, peso = 4 - peso) soma += Number(d[i]) * peso;
  return (10 - (soma % 10)) % 10 === Number(d[d.length - 1]) ? d : null;
}

/** Aceita data ISO (AAAA-MM-DD…) ou brasileira (DD/MM/AAAA). */
function dataIso(valor) {
  const v = String(valor ?? '');
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

const SERVICOS_INFOSIMPLES = { PB: 'sefaz/pb/nfce' };

/**
 * ProvedorInfosimples — consulta a NFC-e pela API da Infosimples, que acessa o
 * portal da SEFAZ e devolve a nota em JSON. Serviço pago por consulta: só entra
 * na cadeia quando há token configurado. O portal não informa NCM nem tributos
 * por item, e o código do produto nem sempre é um GTIN.
 */
export class ProvedorInfosimples {
  constructor({ token, servicos = SERVICOS_INFOSIMPLES, fetch = globalThis.fetch, timeoutSegundos = 120, registrar = console.warn } = {}) {
    this.token = token;
    this.servicos = servicos;
    this.fetch = fetch;
    this.timeoutSegundos = timeoutSegundos;
    this.registrar = registrar;
  }

  get nome() {
    return 'infosimples';
  }

  async consultar(chave) {
    const meta = interpretarChave(chave);
    const servico = meta.modelo === '65' ? this.servicos[meta.uf] : undefined;
    if (!servico) throw indisponivel(`Infosimples: sem serviço de NFC-e para ${meta.uf ?? 'esta UF'}.`);

    let resposta;
    try {
      const http = await this.fetch(`https://api.infosimples.com/api/v2/consultas/${servico}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: this.token, timeout: String(this.timeoutSegundos), nfce: chave }),
        signal: AbortSignal.timeout((this.timeoutSegundos + 15) * 1000)
      });
      resposta = await http.json();
    } catch (erro) {
      this.registrar(`[infosimples] falha na chamada: ${erro.message}`);
      throw indisponivel(`Infosimples indisponível: ${erro.message}`);
    }

    const dados = resposta?.code === 200 ? resposta.data?.[0] : null;
    if (!dados) {
      const motivo = [resposta?.code_message, ...(resposta?.errors ?? [])].filter(Boolean).join(' ');
      this.registrar(`[infosimples] code ${resposta?.code}: ${motivo}`);
      throw indisponivel(`Infosimples respondeu ${resposta?.code}: ${motivo}`);
    }
    if (dados.cancelada) {
      const erro = new Error('A SEFAZ informa que esta nota fiscal foi cancelada.');
      erro.status = 422;
      throw erro;
    }

    const info = dados.informacoes_nota ?? {};
    const dataEmissao = dataIso(info.data_emissao) ?? dataIso(info.data_autorizacao);
    if (!dataEmissao) throw indisponivel('Infosimples: resposta sem data de emissão.');

    const emitente = dados.emitente ?? {};
    return {
      chave,
      numero: String(info.numero ?? meta.numero),
      serie: String(info.serie ?? meta.serie),
      modelo: meta.modelo,
      dataEmissao,
      horaEmissao: horaDe(info.hora_emissao),
      valorTotal: numero(dados.normalizado_valor_a_pagar ?? dados.normalizado_valor_total),
      valorTributos: numero(dados.normalizado_tributos_totais),
      emitente: {
        cnpj: somenteDigitos(emitente.cnpj) || meta.cnpjEmitente,
        razaoSocial: String(emitente.nome_razao_social || 'Emitente não identificado').trim(),
        nomeFantasia: null,
        logradouro: emitente.endereco || null,
        municipio: null,
        uf: meta.uf
      },
      origem: 'infosimples',
      itens: lista(dados.produtos).map((p) => {
        const quantidade = numero(p.normalizado_quantidade) || 1;
        const valorTotal = numero(p.normalizado_valor_total_produto);
        return {
          ean: gtinValido(p.codigo),
          ncm: null,
          descricao: String(p.nome ?? 'Produto sem descrição').trim(),
          unidade: p.unidade ? String(p.unidade) : 'UN',
          quantidade,
          valorUnitario: numero(p.normalizado_valor_unitario) || Number((valorTotal / quantidade).toFixed(2)),
          valorTotal,
          valorTributos: 0
        };
      })
    };
  }
}

/**
 * Portais oficiais de consulta da NFC-e por UF, usados quando só a chave foi
 * informada. Na SEFAZ-PB a URL apenas preenche a chave: a exibição da nota
 * exige reCAPTCHA, por isso a consulta não pode ser automatizada no servidor.
 */
const PORTAIS_CONSULTA = {
  PB: (chave) => `https://www.sefaz.pb.gov.br/nfce?p=${chave}`
};

/** Aceita a URL lida do QR Code apenas se apontar para um portal oficial (.gov.br). */
function urlOficial(conteudo) {
  try {
    const url = new URL(String(conteudo ?? '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.hostname.endsWith('.gov.br') ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * ProvedorConsultaAssistida — os portais estaduais protegem a exibição da nota
 * com verificação humana, então o sistema não obtém os itens sozinho. Devolve
 * o endereço da consulta oficial para o consumidor abrir e orienta a importação
 * do XML autorizado, que é o caminho de dados reais.
 */
export class ProvedorConsultaAssistida {
  constructor(portais = PORTAIS_CONSULTA) {
    this.portais = portais;
  }

  get nome() {
    return 'consulta-assistida';
  }

  async consultar(chave, { conteudoQr } = {}) {
    const { uf } = interpretarChave(chave);
    const urlConsulta = urlOficial(conteudoQr) ?? this.portais[uf]?.(chave) ?? null;

    const erro = new Error(
      urlConsulta
        ? `A consulta automática não está disponível: o portal da SEFAZ-${uf} exige verificação humana. ` +
          'Consulte a nota no portal oficial e importe o XML autorizado.'
        : `Não há consulta disponível para notas emitidas em ${uf ?? 'esta UF'}. Importe o XML autorizado da nota.`
    );
    erro.codigo = 'CONSULTA_ASSISTIDA';
    erro.status = 422;
    erro.urlConsulta = urlConsulta;
    throw erro;
  }
}

/**
 * ProvedorCatalogoLocal — usado somente no modo de demonstração e em testes.
 * A partir da chave de acesso (que já carrega CNPJ, data, série e número reais)
 * monta a nota com itens de um catálogo local determinístico, derivado do
 * código numérico da própria chave. Os dados dos itens são sintéticos e a nota
 * é marcada com `origem: 'demo'`.
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

  async consultar(chave, contexto) {
    let ultimoErro;
    for (const provedor of this.provedores) {
      try {
        return await provedor.consultar(chave, contexto);
      } catch (erro) {
        if (erro.codigo !== 'PROVEDOR_INDISPONIVEL') throw erro;
        ultimoErro = erro;
      }
    }
    throw ultimoErro ?? new Error('Nenhum provedor conseguiu atender à consulta.');
  }
}

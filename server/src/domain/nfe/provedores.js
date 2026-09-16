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
  const achado = String(valor ?? '').match(/(?:^|[T\s])(\d{2}):(\d{2})(?::(\d{2}))?/);
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

/**
 * Serviços de NFC-e da Infosimples por UF, em ordem de preferência. As versões
 * "completa" vêm primeiro porque trazem GTIN e NCM, que melhoram a identidade do
 * produto. Os caminhos seguem o nome das páginas de cada serviço; um caminho
 * inexistente devolve o código 602, que não é cobrado, e o provedor tenta o
 * próximo. A versão SVRS do RS não entra: exige login e certificado digital.
 */
export const SERVICOS_INFOSIMPLES = {
  AC: ['sefaz/ac/nfce'],
  AL: ['sefaz/al/nfce'],
  AM: ['sefaz/am/nfce-completa', 'sefaz/am/nfce'],
  AP: ['sefaz/ap/nfce'],
  BA: ['sefaz/ba/nfce-completa', 'sefaz/ba/nfce'],
  CE: ['sefaz/ce/nfce'],
  DF: ['sefaz/df/nfce'],
  ES: ['sefaz/es/nfce'],
  GO: ['sefaz/go/nfce-completa', 'sefaz/go/nfce'],
  MA: ['sefaz/ma/nfce'],
  MG: ['sefaz/mg/nfce-resumida', 'sefaz/mg/nfce'],
  MS: ['sefaz/ms/nfce'],
  MT: ['sefaz/mt/nfce'],
  PA: ['sefaz/pa/nfce'],
  PB: ['sefaz/pb/nfce'],
  PE: ['sefaz/pe/nfce'],
  PI: ['sefaz/pi/nfce'],
  PR: ['sefaz/pr/nfce'],
  RJ: ['sefaz/rj/nfce-completa', 'sefaz/rj/nfce-resumida', 'sefaz/rj/nfce'],
  RN: ['sefaz/rn/nfce-resumida', 'sefaz/rn/nfce'],
  RO: ['sefaz/ro/nfce-completa', 'sefaz/ro/nfce-resumida', 'sefaz/ro/nfce'],
  RR: ['sefaz/rr/nfce'],
  RS: ['sefaz/rs/nfce-resumida', 'sefaz/rs/nfce'],
  SC: ['sefaz/sc/nfce'],
  SE: ['sefaz/se/nfce'],
  SP: ['sefaz/sp/nfce'],
  TO: ['sefaz/to/nfce']
};

/** Códigos que a Infosimples não cobra e que indicam serviço errado ou não liberado para o token. */
const CODIGOS_TENTAR_PROXIMO = new Set([602, 603]);

/** Número a partir de valor numérico ou texto brasileiro ("1.234,56", "R$ 5,99"). */
function numeroBr(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (valor === undefined || valor === null || typeof valor === 'object') return 0;
  let bruto = String(valor).replace(/[^\d,.-]/g, '');
  if (bruto.includes(',')) bruto = bruto.replace(/\./g, '').replace(',', '.');
  const n = Number(bruto);
  return Number.isFinite(n) ? n : 0;
}

const primeiro = (v) => (Array.isArray(v) ? (v[0] ?? {}) : (v ?? {}));
const texto = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const ncmValido = (v) => (/^\d{8}$/.test(somenteDigitos(v)) ? somenteDigitos(v) : null);
/** "3550308 - SAO PAULO" ou "SAO PAULO" → "SAO PAULO". */
const nomeMunicipio = (v) => texto(String(v ?? '').replace(/^\d+\s*-\s*/, ''));

function recusarCancelada(cancelada) {
  if (!cancelada) return;
  const erro = new Error('A SEFAZ informa que esta nota fiscal foi cancelada.');
  erro.status = 422;
  throw erro;
}

function item({ ean, ncm, descricao, unidade, quantidade, valorUnitario, valorTotal, valorTributos = 0 }) {
  const qtd = quantidade || 1;
  return {
    ean,
    ncm,
    descricao: texto(descricao) ?? 'Produto sem descrição',
    unidade: texto(unidade) ?? 'UN',
    quantidade: qtd,
    valorUnitario: valorUnitario || Number((valorTotal / qtd).toFixed(2)),
    valorTotal,
    valorTributos
  };
}

/** Formato resumido (PB, PE, SC e outras): informacoes_nota, emitente e produtos. */
function converterResumida(dados, meta) {
  recusarCancelada(dados.cancelada === true);
  const info = dados.informacoes_nota ?? {};
  const emitente = dados.emitente ?? {};
  return {
    dataEmissao: dataIso(info.data_emissao) ?? dataIso(info.data_autorizacao),
    horaEmissao: horaDe(info.hora_emissao),
    numero: info.numero,
    serie: info.serie,
    valorTotal: numeroBr(dados.normalizado_valor_a_pagar ?? dados.normalizado_valor_total ?? dados.valor_pago),
    valorTributos: numeroBr(dados.normalizado_tributos_totais),
    emitente: {
      cnpj: somenteDigitos(emitente.cnpj),
      razaoSocial: texto(emitente.nome_razao_social),
      nomeFantasia: null,
      logradouro: texto(emitente.endereco),
      municipio: null,
      uf: meta.uf
    },
    itens: lista(dados.produtos).map((p) =>
      item({
        ean: gtinValido(p.codigo),
        ncm: null,
        descricao: p.nome,
        unidade: p.unidade,
        quantidade: numeroBr(p.normalizado_quantidade ?? p.quantidade),
        valorUnitario: numeroBr(p.normalizado_valor_unitario ?? p.valor_unitario),
        valorTotal: numeroBr(
          p.normalizado_valor_total_produto ?? p.normalizado_valor_total_do_produto ?? p.valor_total_produto
        )
      })
    )
  };
}

/** Formato completo (SP, CE e versões "completa"): nfe, emitente, totais e produtos com GTIN e NCM. */
function converterCompleta(dados, meta) {
  const nfe = primeiro(dados.nfe);
  const emitente = primeiro(dados.emitente);
  const totais = primeiro(dados.totais);
  recusarCancelada(/cancel/i.test(String(nfe.situacao ?? '')));
  const itens = lista(dados.produtos).map((p) =>
    item({
      ean: gtinValido(p.ean_comercial) ?? gtinValido(p.ean_tributavel) ?? gtinValido(p.codigo),
      ncm: ncmValido(p.ncm),
      descricao: p.descricao,
      unidade: p.unidade_comercial ?? p.unidade,
      quantidade: numeroBr(p.quantidade_comercial ?? p.qtd ?? p.quantidade_tributavel),
      valorUnitario: numeroBr(p.valor_unitario_comercial),
      valorTotal: numeroBr(p.normalizado_valor ?? p.valor),
      valorTributos: numeroBr(p.normalizado_tributos ?? p.tributos)
    })
  );
  return {
    dataEmissao: dataIso(nfe.data_emissao),
    horaEmissao: horaDe(nfe.data_emissao),
    numero: nfe.numero ?? dados.numero,
    serie: nfe.serie,
    valorTotal:
      numeroBr(totais.normalizado_valor_nfe ?? totais.valor_nfe ?? nfe.normalizado_valor_total ?? nfe.valor_total) ||
      Number(itens.reduce((s, i) => s + i.valorTotal, 0).toFixed(2)),
    valorTributos: numeroBr(totais.normalizado_valor_tributos ?? totais.valor_tributos),
    emitente: {
      cnpj: somenteDigitos(emitente.normalizado_cnpj ?? emitente.cnpj),
      razaoSocial: texto(emitente.nome),
      nomeFantasia: texto(emitente.nome_fantasia),
      logradouro: texto(emitente.endereco),
      municipio: nomeMunicipio(emitente.normalizado_municipio ?? emitente.municipio),
      uf: texto(emitente.uf) ?? meta.uf
    },
    itens
  };
}

/** Formato de MG (nfce-resumida): nfce, emitente, produtos_servicos e valores. */
function converterMg(dados, meta) {
  const nfce = primeiro(dados.nfce);
  const emitente = primeiro(dados.emitente);
  const valores = primeiro(dados.valores);
  recusarCancelada(/cancel/i.test(String(dados.situacao_atual ?? '')));
  const itens = lista(dados.produtos_servicos).map((p) =>
    item({
      ean: null,
      ncm: null,
      descricao: p.descricao,
      unidade: p.unidade_comercial,
      quantidade: numeroBr(p.quantidade),
      valorUnitario: numeroBr(p.normalizado_valor_unitario ?? p.valor_unitario),
      valorTotal: numeroBr(p.normalizado_valor ?? p.valor)
    })
  );
  return {
    dataEmissao: dataIso(nfce.normalizado_datahora_emissao) ?? dataIso(nfce.data_emissao),
    horaEmissao: horaDe(nfce.normalizado_datahora_emissao) ?? horaDe(nfce.data_emissao),
    numero: nfce.numero,
    serie: nfce.serie,
    valorTotal:
      numeroBr(valores.normalizado_valor_total_servico ?? valores.valor_total_servico) ||
      Number(itens.reduce((s, i) => s + i.valorTotal, 0).toFixed(2)),
    valorTributos: 0,
    emitente: {
      cnpj: somenteDigitos(emitente.normalizado_cnpj ?? emitente.cnpj),
      razaoSocial: texto(emitente.razao_social),
      nomeFantasia: null,
      logradouro: null,
      municipio: null,
      uf: texto(emitente.uf) ?? meta.uf
    },
    itens
  };
}

/** Reconhece o formato pela estrutura: os serviços estaduais não seguem um esquema único. */
export function converterRespostaInfosimples(dados, chave, meta = interpretarChave(chave)) {
  const conversor = dados.produtos_servicos
    ? converterMg
    : dados.informacoes_nota
      ? converterResumida
      : dados.nfe || dados.totais
        ? converterCompleta
        : null;
  if (!conversor) {
    throw indisponivel(`Infosimples: formato de resposta desconhecido (${Object.keys(dados).join(', ')}).`);
  }

  const nota = conversor(dados, meta);
  if (!nota.dataEmissao) throw indisponivel('Infosimples: resposta sem data de emissão.');
  if (!nota.itens.length) throw indisponivel('Infosimples: resposta sem produtos.');
  return {
    chave,
    numero: String(nota.numero ?? meta.numero),
    serie: String(nota.serie ?? meta.serie),
    modelo: meta.modelo,
    dataEmissao: nota.dataEmissao,
    horaEmissao: nota.horaEmissao,
    valorTotal: nota.valorTotal,
    valorTributos: nota.valorTributos,
    emitente: {
      ...nota.emitente,
      cnpj: nota.emitente.cnpj || meta.cnpjEmitente,
      razaoSocial: nota.emitente.razaoSocial ?? 'Emitente não identificado'
    },
    origem: 'infosimples',
    itens: nota.itens
  };
}

/**
 * ProvedorInfosimples — consulta a NFC-e pela API da Infosimples, que acessa o
 * portal da SEFAZ de cada UF e devolve a nota em JSON. Serviço pago por
 * consulta: só entra na cadeia quando há token configurado.
 */
export class ProvedorInfosimples {
  constructor({
    token,
    servicos = SERVICOS_INFOSIMPLES,
    fetch = globalThis.fetch,
    timeoutSegundos = 120,
    registrar = console.warn,
    aoResponder
  } = {}) {
    this.token = token;
    this.aoResponder = aoResponder;
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
    const candidatos = meta.modelo === '65' ? lista(this.servicos[meta.uf]) : [];
    if (!candidatos.length) throw indisponivel(`Infosimples: sem serviço de NFC-e para ${meta.uf ?? 'esta UF'}.`);

    for (const servico of candidatos) {
      const resposta = await this.chamar(servico, chave);
      this.aoResponder?.(servico, chave, resposta);
      if (resposta?.code === 200 && resposta.data?.[0]) {
        return converterRespostaInfosimples(resposta.data[0], chave, meta);
      }

      const motivo = [resposta?.code_message, ...(resposta?.errors ?? [])].filter(Boolean).join(' ');
      this.registrar(`[infosimples] ${servico}: code ${resposta?.code} ${motivo}`);
      // Serviço inexistente ou não liberado para o token não é cobrado: tenta o próximo.
      if (CODIGOS_TENTAR_PROXIMO.has(resposta?.code) && resposta?.header?.billable !== true) continue;
      throw indisponivel(`Infosimples respondeu ${resposta?.code}: ${motivo}`);
    }
    throw indisponivel(`Infosimples: nenhum serviço de NFC-e disponível para ${meta.uf}.`);
  }

  async chamar(servico, chave) {
    try {
      const http = await this.fetch(`https://api.infosimples.com/api/v2/consultas/${servico}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: this.token, timeout: String(this.timeoutSegundos), nfce: chave }),
        signal: AbortSignal.timeout((this.timeoutSegundos + 15) * 1000)
      });
      return await http.json();
    } catch (erro) {
      this.registrar(`[infosimples] falha na chamada: ${erro.message}`);
      throw indisponivel(`Infosimples indisponível: ${erro.message}`);
    }
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
        ? `A consulta automática não retornou esta nota. Abra a consulta oficial da SEFAZ-${uf}, que pode exigir ` +
          'verificação humana, e importe o XML autorizado.'
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

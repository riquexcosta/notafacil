const CHAVE_SESSAO = 'notafacil.sessao';

export function lerSessao() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_SESSAO)) ?? null;
  } catch {
    return null;
  }
}

export function gravarSessao(sessao) {
  localStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao));
}

export function encerrarSessao() {
  localStorage.removeItem(CHAVE_SESSAO);
}

async function requisitar(caminho, opcoes = {}) {
  const sessao = lerSessao();
  const cabecalhos = { ...(opcoes.headers ?? {}) };

  if (sessao?.token) cabecalhos.Authorization = `Bearer ${sessao.token}`;
  if (opcoes.body && !cabecalhos['Content-Type']) cabecalhos['Content-Type'] = 'application/json';

  const resposta = await fetch(`/api${caminho}`, { ...opcoes, headers: cabecalhos });
  const texto = await resposta.text();
  const dados = texto ? JSON.parse(texto) : null;

  if (!resposta.ok) {
    const erro = new Error(dados?.erro ?? 'Falha na comunicação com o servidor.');
    erro.status = resposta.status;
    erro.dados = dados;
    throw erro;
  }
  return dados;
}

const comQuery = (caminho, params = {}) => {
  const limpos = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const query = new URLSearchParams(limpos).toString();
  return query ? `${caminho}?${query}` : caminho;
};

const json = (metodo, corpo) => ({ method: metodo, body: JSON.stringify(corpo) });

export const api = {
  cadastrar: (dados) => requisitar('/auth/cadastro', json('POST', dados)),
  entrar: (dados) => requisitar('/auth/login', json('POST', dados)),

  lerQrCode: (conteudo) => requisitar('/notas/qrcode', json('POST', { conteudo })),
  enviarXml: (xml) =>
    requisitar('/notas/xml', { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: xml }),

  listarNotas: (filtros) => requisitar(comQuery('/notas', filtros)),
  obterNota: (id) => requisitar(`/notas/${id}`),
  excluirNota: (id) => requisitar(`/notas/${id}`, { method: 'DELETE' }),

  buscarProdutos: (filtros) => requisitar(comQuery('/produtos', filtros)),
  produtosRecorrentes: () => requisitar('/produtos/recorrentes'),
  historicoProduto: (id) => requisitar(`/produtos/${id}/historico`),

  listarEmpresas: () => requisitar('/empresas'),
  produtosDaEmpresa: (id) => requisitar(`/empresas/${id}/produtos`),

  resumo: () => requisitar('/relatorios/resumo')
};

export const moeda = (valor) =>
  (valor ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const percentual = (valor, casas = 1) =>
  valor === null || valor === undefined
    ? '—'
    : `${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

export const dataBr = (iso) => {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
};

export const mesBr = (iso) => {
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [ano, mes] = String(iso).split('-');
  return `${nomes[Number(mes) - 1]}/${String(ano).slice(2)}`;
};

export const mascararChave = (chave) => String(chave ?? '').replace(/(.{4})/g, '$1 ').trim();

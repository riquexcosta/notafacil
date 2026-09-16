import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { calcularDigitoVerificador } from '../src/domain/chaveAcesso.js';
import {
  CadeiaDeProvedores,
  converterRespostaInfosimples,
  ProvedorConsultaAssistida,
  ProvedorInfosimples,
  SERVICOS_INFOSIMPLES
} from '../src/domain/nfe/provedores.js';
import { anonimizarResposta } from '../src/domain/nfe/amostrasInfosimples.js';

// Resposta real do serviço sefaz/pb/nfce, sem os dados da conta consultante.
const AMOSTRA = JSON.parse(
  fs.readFileSync(new URL('./fixtures/infosimples-pb-nfce.json', import.meta.url), 'utf8')
);
const CHAVE = AMOSTRA.data[0].informacoes_nota.chave_acesso;

function criarProvedor(resposta = AMOSTRA) {
  const chamadas = [];
  const fetch = async (url, opcoes) => {
    chamadas.push({ url, corpo: Object.fromEntries(opcoes.body) });
    if (resposta instanceof Error) throw resposta;
    return { json: async () => structuredClone(resposta) };
  };
  const provedor = new ProvedorInfosimples({ token: 'token-de-teste', fetch, registrar: () => {} });
  return { provedor, chamadas };
}

function comDados(alteracao) {
  const resposta = structuredClone(AMOSTRA);
  alteracao(resposta.data[0]);
  return resposta;
}

test('envia o token e a chave ao serviço SEFAZ/PB/NFC-e', async () => {
  const { provedor, chamadas } = criarProvedor();
  await provedor.consultar(CHAVE);
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].url, /\/api\/v2\/consultas\/sefaz\/pb\/nfce$/);
  assert.equal(chamadas[0].corpo.token, 'token-de-teste');
  assert.equal(chamadas[0].corpo.nfce, CHAVE);
});

test('converte a resposta da Infosimples na nota normalizada', async () => {
  const nota = await criarProvedor().provedor.consultar(CHAVE);
  assert.equal(nota.origem, 'infosimples');
  assert.equal(nota.numero, '898');
  assert.equal(nota.serie, '1');
  assert.equal(nota.modelo, '65');
  assert.equal(nota.dataEmissao, '2026-09-10');
  assert.equal(nota.valorTotal, 17.9);
  assert.equal(nota.valorTributos, 8.34);
  assert.equal(nota.emitente.cnpj, '64587757000106');
  assert.equal(nota.emitente.razaoSocial, 'leal material');
  assert.equal(nota.emitente.uf, 'PB');
  assert.equal(nota.itens.length, 2);
  assert.deepEqual(
    nota.itens.map((i) => [i.descricao, i.quantidade, i.valorUnitario, i.valorTotal]),
    [
      ['ESTILETE 18MM', 1, 11.9, 11.9],
      ['PARAFUSO JOMARCA 3,5X25', 20, 0.3, 6]
    ]
  );
});

test('usa o código do produto como EAN apenas quando é um GTIN válido', async () => {
  const nota = await criarProvedor().provedor.consultar(CHAVE);
  assert.equal(nota.itens[0].ean, null); // "CFOP5102"
  assert.equal(nota.itens[1].ean, '7892183539308');

  const digitoErrado = comDados((d) => (d.produtos[1].codigo = '7892183539309'));
  const outra = await criarProvedor(digitoErrado).provedor.consultar(CHAVE);
  assert.equal(outra.itens[1].ean, null);
});

test('aceita a data de emissão no formato brasileiro', async () => {
  const resposta = comDados((d) => (d.informacoes_nota.data_emissao = '10/09/2026'));
  const nota = await criarProvedor(resposta).provedor.consultar(CHAVE);
  assert.equal(nota.dataEmissao, '2026-09-10');
});

test('resposta sem sucesso deixa a cadeia seguir para a consulta assistida', async () => {
  const { provedor } = criarProvedor({ code: 612, code_message: 'Nenhum dado encontrado.', errors: [], data: [] });
  const cadeia = new CadeiaDeProvedores([provedor, new ProvedorConsultaAssistida()]);
  await assert.rejects(cadeia.consultar(CHAVE), { codigo: 'CONSULTA_ASSISTIDA' });
});

test('falha de rede também recai na consulta assistida', async () => {
  const { provedor } = criarProvedor(new Error('fetch failed'));
  const cadeia = new CadeiaDeProvedores([provedor, new ProvedorConsultaAssistida()]);
  await assert.rejects(cadeia.consultar(CHAVE), { codigo: 'CONSULTA_ASSISTIDA' });
});

test('modelo sem serviço (NFS-e/outros) não gera chamada paga', async () => {
  const base = '35' + '2603' + '07526557000100' + '57' + '001' + '000000001' + '1' + '10000001';
  const { provedor, chamadas } = criarProvedor();
  await assert.rejects(provedor.consultar(base + calcularDigitoVerificador(base)), {
    codigo: 'PROVEDOR_INDISPONIVEL'
  });
  assert.equal(chamadas.length, 0);
});

test('nota cancelada é recusada', async () => {
  const resposta = comDados((d) => (d.cancelada = true));
  await assert.rejects(criarProvedor(resposta).provedor.consultar(CHAVE), (erro) => {
    assert.equal(erro.status, 422);
    assert.match(erro.message, /cancelada/);
    return true;
  });
});

/* --------------------------------------------------------- outras UFs */

function chaveDe(uf, cnpj = '07526557000100') {
  const base = uf + '2609' + cnpj + '65' + '001' + '000001234' + '1' + '10000001';
  return base + calcularDigitoVerificador(base);
}
const CHAVE_SP = chaveDe('35');
const CHAVE_MG = chaveDe('31');

test('há serviço de NFC-e para todas as 27 UFs, sem exigir login ou certificado', () => {
  assert.equal(Object.keys(SERVICOS_INFOSIMPLES).length, 27);
  for (const [uf, servicos] of Object.entries(SERVICOS_INFOSIMPLES)) {
    assert.ok(servicos.length > 0, uf);
    assert.ok(servicos.every((s) => s.startsWith(`sefaz/${uf.toLowerCase()}/`) && !s.includes('svrs')), uf);
  }
});

test('serviço inexistente (602, não cobrado) faz o provedor tentar o próximo caminho', async () => {
  const urls = [];
  const respostas = [
    { code: 602, code_message: 'O serviço informado na URL não é válido.', header: { billable: false }, data: [] },
    AMOSTRA
  ];
  const fetch = async (url) => {
    urls.push(url);
    return { json: async () => structuredClone(respostas.shift()) };
  };
  const provedor = new ProvedorInfosimples({
    token: 't',
    fetch,
    registrar: () => {},
    servicos: { PB: ['sefaz/pb/nfce-completa', 'sefaz/pb/nfce'] }
  });
  const nota = await provedor.consultar(CHAVE);
  assert.equal(nota.itens.length, 2);
  assert.deepEqual(
    urls.map((u) => u.split('/consultas/')[1]),
    ['sefaz/pb/nfce-completa', 'sefaz/pb/nfce']
  );
});

test('erro cobrado não repete a consulta em outro caminho', async () => {
  let chamadas = 0;
  const fetch = async () => {
    chamadas++;
    return { json: async () => ({ code: 612, code_message: 'Nenhum dado.', header: { billable: true }, data: [] }) };
  };
  const provedor = new ProvedorInfosimples({
    token: 't',
    fetch,
    registrar: () => {},
    servicos: { PB: ['sefaz/pb/nfce-completa', 'sefaz/pb/nfce'] }
  });
  await assert.rejects(provedor.consultar(CHAVE), { codigo: 'PROVEDOR_INDISPONIVEL' });
  assert.equal(chamadas, 1);
});

test('converte o formato completo (SP) com GTIN, NCM, município e textos brasileiros', () => {
  const dados = {
    chave_acesso: CHAVE_SP,
    nfe: { numero: '1234', serie: '1', data_emissao: '12/09/2026 10:15:32-03:00', situacao: 'Autorizada', valor_total: '25,48' },
    emitente: {
      cnpj: '07.526.557/0001-00',
      nome: 'SUPERMERCADO PAULISTA LTDA',
      nome_fantasia: 'Mercado Paulista',
      endereco: 'RUA AUGUSTA, 100',
      municipio: '3550308 - SAO PAULO',
      uf: 'SP'
    },
    totais: { valor_nfe: '25,48', normalizado_valor_nfe: 25.48, valor_tributos: '6,12', normalizado_valor_tributos: 6.12 },
    produtos: [
      {
        descricao: 'CAFE PILAO 500G',
        codigo: '1020',
        ean_comercial: '7896089011937',
        ncm: '09012100',
        quantidade_comercial: '2,0000',
        unidade_comercial: 'UN',
        valor_unitario_comercial: '12,7400',
        valor: '25,48',
        normalizado_valor: 25.48
      }
    ]
  };
  const nota = converterRespostaInfosimples(dados, CHAVE_SP);
  assert.equal(nota.dataEmissao, '2026-09-12');
  assert.equal(nota.horaEmissao, '10:15:32');
  assert.equal(nota.valorTotal, 25.48);
  assert.equal(nota.valorTributos, 6.12);
  assert.deepEqual(
    [nota.emitente.cnpj, nota.emitente.nomeFantasia, nota.emitente.municipio, nota.emitente.uf],
    ['07526557000100', 'Mercado Paulista', 'SAO PAULO', 'SP']
  );
  assert.deepEqual(nota.itens[0], {
    ean: '7896089011937',
    ncm: '09012100',
    descricao: 'CAFE PILAO 500G',
    unidade: 'UN',
    quantidade: 2,
    valorUnitario: 12.74,
    valorTotal: 25.48,
    valorTributos: 0
  });
});

test('nota cancelada no formato completo é recusada', () => {
  assert.throws(
    () =>
      converterRespostaInfosimples({ nfe: { situacao: 'Cancelada', data_emissao: '12/09/2026' }, produtos: [{}] }, CHAVE_SP),
    { status: 422 }
  );
});

test('converte o formato de MG (produtos_servicos) com total pela soma quando falta', () => {
  const dados = {
    nfce: {
      numero: '55',
      serie: '2',
      data_emissao: '13/09/2026 18:40:00',
      normalizado_datahora_emissao: '2026-09-13T18:40:00-03:00'
    },
    emitente: { cnpj: '07526557000100', razao_social: 'SUPERMERCADO MINEIRO LTDA', uf: 'MG' },
    produtos_servicos: [
      { descricao: 'PAO DE QUEIJO 1KG', quantidade: '1,0000', unidade_comercial: 'KG', normalizado_valor_unitario: 24.9, normalizado_valor: 24.9 },
      { descricao: 'LEITE 1L', quantidade: '3', unidade_comercial: 'UN', valor_unitario: '4,99', valor: '14,97' }
    ],
    situacao_atual: 'Autorizada'
  };
  const nota = converterRespostaInfosimples(dados, CHAVE_MG);
  assert.equal(nota.dataEmissao, '2026-09-13');
  assert.equal(nota.horaEmissao, '18:40:00');
  assert.equal(nota.valorTotal, 39.87);
  assert.equal(nota.emitente.razaoSocial, 'SUPERMERCADO MINEIRO LTDA');
  assert.deepEqual(
    nota.itens.map((i) => [i.descricao, i.quantidade, i.valorUnitario, i.valorTotal]),
    [
      ['PAO DE QUEIJO 1KG', 1, 24.9, 24.9],
      ['LEITE 1L', 3, 4.99, 14.97]
    ]
  );
});

test('formato resumido aceita o total do item com o nome usado em GO, PR e outras UFs', () => {
  const dados = structuredClone(AMOSTRA.data[0]);
  for (const p of dados.produtos) {
    p.normalizado_valor_total_do_produto = p.normalizado_valor_total_produto;
    delete p.normalizado_valor_total_produto;
  }
  const nota = converterRespostaInfosimples(dados, CHAVE);
  assert.deepEqual(nota.itens.map((i) => i.valorTotal), [11.9, 6]);
});

test('formato desconhecido cai na consulta assistida em vez de gravar nota vazia', () => {
  assert.throws(() => converterRespostaInfosimples({ outra_coisa: 1 }, CHAVE), { codigo: 'PROVEDOR_INDISPONIVEL' });
});

test('a amostra gravada não guarda consumidor, destinatário nem os dados da conta', () => {
  const resposta = {
    code: 200,
    header: { client: 'conta consultante', ip: '10.0.0.1' },
    data: [
      {
        consumidor: { cpf: '123.456.789-09', nome: 'Fulano' },
        nfe: { destinatario: { cpf: '12345678909' }, numero: '1' },
        produtos: [{ descricao: 'CAFE' }]
      }
    ]
  };
  const anonima = anonimizarResposta(resposta);
  assert.equal(JSON.stringify(anonima).includes('123'), false);
  assert.equal(JSON.stringify(anonima).includes('conta consultante'), false);
  assert.deepEqual(anonima.data[0], { nfe: { numero: '1' }, produtos: [{ descricao: 'CAFE' }] });
  assert.equal(resposta.data[0].consumidor.nome, 'Fulano'); // não altera o original
});

test('o provedor entrega cada resposta ao gravador de amostras, quando configurado', async () => {
  const recebidas = [];
  const fetch = async () => ({ json: async () => structuredClone(AMOSTRA) });
  const provedor = new ProvedorInfosimples({
    token: 't',
    fetch,
    registrar: () => {},
    aoResponder: (servico, chave, resposta) => recebidas.push([servico, chave, resposta.code])
  });
  await provedor.consultar(CHAVE);
  assert.deepEqual(recebidas, [['sefaz/pb/nfce', CHAVE, 200]]);
});

test('NF-e de modelo 55 usa o serviço unificado sefaz/nfe com o parâmetro nfe', async () => {
  const base = '25' + '2608' + '05457026000187' + '55' + '001' + '000795396' + '1' + '20904187';
  const chaveNfe = base + calcularDigitoVerificador(base);
  const chamadas = [];
  const fetch = async (url, opcoes) => {
    chamadas.push({ url, corpo: Object.fromEntries(opcoes.body) });
    return {
      json: async () => ({
        code: 200,
        data: [
          {
            nfe: { numero: '795396', serie: '1', data_emissao: '20/08/2026 09:12:00-03:00', situacao: 'Autorizada' },
            emitente: { cnpj: '05.457.026/0001-87', nome: 'LOJA ONLINE LTDA', municipio: 'JOAO PESSOA', uf: 'PB' },
            totais: { normalizado_valor_nfe: 199.9, normalizado_valor_tributos: 45.1 },
            produtos: [
              { descricao: 'FONE BLUETOOTH', ean_comercial: 'SEM GTIN', ncm: '85183000', quantidade_comercial: '1,0000', valor_unitario_comercial: '199,90', normalizado_valor: 199.9 }
            ]
          }
        ]
      })
    };
  };
  const provedor = new ProvedorInfosimples({ token: 't', fetch, registrar: () => {} });
  const nota = await provedor.consultar(chaveNfe);
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].url, /\/consultas\/sefaz\/nfe$/);
  assert.equal(chamadas[0].corpo.nfe, chaveNfe);
  assert.equal(chamadas[0].corpo.nfce, undefined);
  assert.equal(nota.modelo, '55');
  assert.equal(nota.valorTotal, 199.9);
  assert.deepEqual([nota.itens[0].ean, nota.itens[0].ncm, nota.itens[0].valorTotal], [null, '85183000', 199.9]);
});

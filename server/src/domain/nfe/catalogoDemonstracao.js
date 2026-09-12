/**
 * Catálogo local usado pelo ProvedorCatalogoLocal.
 * Os NCM seguem a Nomenclatura Comum do Mercosul; os EAN são fictícios
 * (prefixo 789 reservado ao Brasil) e servem apenas à demonstração.
 */

export const CATALOGO_DEMONSTRACAO = {
  empresas: [
    {
      cnpj: '07526557000100',
      razaoSocial: 'SUPERMERCADO BOM PRECO LTDA',
      nomeFantasia: 'Bom Preço Manaíra',
      logradouro: 'Av. Governador Flávio Ribeiro Coutinho, 220',
      municipio: 'João Pessoa',
      uf: 'PB'
    },
    {
      cnpj: '47960950000121',
      razaoSocial: 'REDE ATACADO NORDESTE S/A',
      nomeFantasia: 'Atacadão Epitácio',
      logradouro: 'Av. Epitácio Pessoa, 1750',
      municipio: 'João Pessoa',
      uf: 'PB'
    },
    {
      cnpj: '33041260065290',
      razaoSocial: 'MERCADINHO TAMBAU COMERCIO DE ALIMENTOS LTDA',
      nomeFantasia: 'Mercadinho Tambaú',
      logradouro: 'Av. Almirante Tamandaré, 310',
      municipio: 'João Pessoa',
      uf: 'PB'
    },
    {
      cnpj: '61585865000151',
      razaoSocial: 'DROGARIA VIDA FARMA LTDA',
      nomeFantasia: 'Vida Farma Bessa',
      logradouro: 'Rua Bancário Sérgio Guerra, 45',
      municipio: 'João Pessoa',
      uf: 'PB'
    }
  ],

  produtos: [
    { ean: '7891000100103', ncm: '04021010', descricao: 'LEITE INTEGRAL UHT 1L', unidade: 'UN', precoReferencia: 5.49, cargaTributaria: 0.18 },
    { ean: '7896005800010', ncm: '10063021', descricao: 'ARROZ BRANCO TIPO 1 5KG', unidade: 'UN', precoReferencia: 27.9, cargaTributaria: 0.12 },
    { ean: '7891910000197', ncm: '07133399', descricao: 'FEIJAO CARIOCA 1KG', unidade: 'UN', precoReferencia: 8.75, cargaTributaria: 0.12 },
    { ean: '7896102500110', ncm: '15071000', descricao: 'OLEO DE SOJA 900ML', unidade: 'UN', precoReferencia: 7.29, cargaTributaria: 0.18 },
    { ean: '7891149101023', ncm: '09011110', descricao: 'CAFE TORRADO E MOIDO 500G', unidade: 'UN', precoReferencia: 21.9, cargaTributaria: 0.18 },
    { ean: '7891000053508', ncm: '17019900', descricao: 'ACUCAR REFINADO 1KG', unidade: 'UN', precoReferencia: 4.65, cargaTributaria: 0.12 },
    { ean: '7896036098127', ncm: '19023000', descricao: 'MACARRAO ESPAGUETE 500G', unidade: 'UN', precoReferencia: 4.19, cargaTributaria: 0.12 },
    { ean: '7894900011517', ncm: '22021000', descricao: 'REFRIGERANTE COLA 2L', unidade: 'UN', precoReferencia: 9.99, cargaTributaria: 0.35 },
    { ean: '7891991010924', ncm: '22011000', descricao: 'AGUA MINERAL SEM GAS 1,5L', unidade: 'UN', precoReferencia: 2.99, cargaTributaria: 0.18 },
    { ean: '7896098900307', ncm: '02013000', descricao: 'PATINHO BOVINO RESFRIADO', unidade: 'KG', precoReferencia: 42.9, cargaTributaria: 0.12 },
    { ean: '7891000315507', ncm: '04061010', descricao: 'QUEIJO MUSSARELA FATIADO', unidade: 'KG', precoReferencia: 44.5, cargaTributaria: 0.18 },
    { ean: '7896656800119', ncm: '07019000', descricao: 'BATATA INGLESA LAVADA', unidade: 'KG', precoReferencia: 6.49, cargaTributaria: 0.0 },
    { ean: '7896004400204', ncm: '08030000', descricao: 'BANANA PRATA', unidade: 'KG', precoReferencia: 7.19, cargaTributaria: 0.0 },
    { ean: '7891008113709', ncm: '18063100', descricao: 'CHOCOLATE AO LEITE 90G', unidade: 'UN', precoReferencia: 8.49, cargaTributaria: 0.35 },
    { ean: '7891024132005', ncm: '34012010', descricao: 'SABAO EM PO 1,6KG', unidade: 'UN', precoReferencia: 18.9, cargaTributaria: 0.25 },
    { ean: '7896098100158', ncm: '48181000', descricao: 'PAPEL HIGIENICO FOLHA DUPLA 12UN', unidade: 'UN', precoReferencia: 24.9, cargaTributaria: 0.25 },
    { ean: '7891058014100', ncm: '30049099', descricao: 'DIPIRONA SODICA 500MG 20CP', unidade: 'UN', precoReferencia: 12.4, cargaTributaria: 0.09 },
    { ean: '7896112108108', ncm: '33051000', descricao: 'SHAMPOO ANTICASPA 400ML', unidade: 'UN', precoReferencia: 19.9, cargaTributaria: 0.25 },
    { ean: '7891000244401', ncm: '19011010', descricao: 'CEREAL INFANTIL 400G', unidade: 'UN', precoReferencia: 16.7, cargaTributaria: 0.12 },
    { ean: '7896024760014', ncm: '04072100', descricao: 'OVOS BRANCOS 12UN', unidade: 'UN', precoReferencia: 13.5, cargaTributaria: 0.0 }
  ]
};

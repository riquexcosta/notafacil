/**
 * Restaura a conta de demonstração com um histórico de compras sintético.
 * Só a conta demo é apagada e recriada: as contas dos demais usuários, suas
 * notas e os produtos e estabelecimentos que elas usam são preservados.
 * Uso: npm run seed
 */
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { db } from './db/index.js';
import { calcularDigitoVerificador } from './domain/chaveAcesso.js';
import { CATALOGO_DEMONSTRACAO } from './domain/nfe/catalogoDemonstracao.js';
import { VERSAO_POLITICA } from './lgpd/politica.js';
import { importarNota, removerRegistrosOrfaos } from './services/notaService.js';

const CODIGO_UF_PB = '25';

/** Monta uma chave de acesso válida (44 dígitos) a partir dos campos do MOC. */
function montarChave({ cnpj, ano, mes, modelo = '65', serie = 1, numero, codigo }) {
  const base =
    CODIGO_UF_PB +
    String(ano).slice(-2) +
    String(mes).padStart(2, '0') +
    cnpj +
    modelo +
    String(serie).padStart(3, '0') +
    String(numero).padStart(9, '0') +
    '1' +
    String(codigo).padStart(8, '0');
  return base + calcularDigitoVerificador(base);
}

export const EMAIL_DEMONSTRACAO = 'demo@notafacil.app';
const SENHA_DEMONSTRACAO = 'demo1234';

// Gerador pseudoaleatório com semente fixa: o seed é reprodutível. A semente
// volta ao valor inicial a cada restauração, para os preços serem sempre os mesmos.
const SEMENTE_INICIAL = 20260910;
let semente = SEMENTE_INICIAL;
function aleatorio() {
  semente = (semente * 1103515245 + 12345) % 2147483648;
  return semente / 2147483648;
}

const { empresas, produtos } = CATALOGO_DEMONSTRACAO;

// Cestas típicas por tipo de estabelecimento
const CESTAS = {
  '07526557000100': [0, 1, 2, 3, 4, 5, 6, 8, 11, 12, 19], // supermercado
  '47960950000121': [1, 2, 3, 5, 6, 7, 14, 15, 9, 10], // atacado
  '33041260065290': [0, 8, 12, 13, 19, 11], // mercadinho
  '61585865000151': [16, 17] // farmácia
};

// Inflação mensal acumulada aplicada ao preço de referência
const FATOR_MENSAL = 0.011;

function precoNoMes(produto, indiceMes, empresaIndice) {
  const inflacao = 1 + FATOR_MENSAL * indiceMes;
  const politicaLoja = [1.0, 0.91, 1.07, 1.03][empresaIndice]; // atacado mais barato
  const ruido = 1 + (aleatorio() - 0.5) * 0.06;
  return Number((produto.precoReferencia * inflacao * politicaLoja * ruido).toFixed(2));
}

function gerarNota({ empresaIndice, indiceMes, numero }) {
  const empresa = empresas[empresaIndice];
  const cesta = CESTAS[empresa.cnpj];
  const quantidadeItens = 3 + Math.floor(aleatorio() * Math.min(6, cesta.length - 3));

  const escolhidos = [...cesta].sort(() => aleatorio() - 0.5).slice(0, quantidadeItens);

  const data = new Date(Date.UTC(2026, 2 + indiceMes, 3 + Math.floor(aleatorio() * 25)));
  const dataEmissao = data.toISOString().slice(0, 10);
  // Hora derivada do número da nota, sem consumir o gerador pseudoaleatório:
  // assim os valores da base continuam os mesmos de antes.
  const horaEmissao = `${String(8 + (numero % 13)).padStart(2, '0')}:${String((numero * 7) % 60).padStart(2, '0')}:00`;

  const itens = escolhidos.map((idx) => {
    const produto = produtos[idx];
    const valorUnitario = precoNoMes(produto, indiceMes, empresaIndice);
    const quantidade =
      produto.unidade === 'KG'
        ? Number((0.3 + aleatorio() * 1.6).toFixed(3))
        : 1 + Math.floor(aleatorio() * 3);
    const valorTotal = Number((valorUnitario * quantidade).toFixed(2));

    return {
      ean: produto.ean,
      ncm: produto.ncm,
      descricao: produto.descricao,
      unidade: produto.unidade,
      quantidade,
      valorUnitario,
      valorTotal,
      valorTributos: Number((valorTotal * produto.cargaTributaria).toFixed(2))
    };
  });

  return {
    chave: montarChave({
      cnpj: empresa.cnpj,
      ano: data.getUTCFullYear(),
      mes: data.getUTCMonth() + 1,
      numero,
      codigo: 10000000 + numero * 137
    }),
    numero: String(numero),
    serie: '1',
    modelo: '65',
    dataEmissao,
    horaEmissao,
    valorTotal: Number(itens.reduce((s, i) => s + i.valorTotal, 0).toFixed(2)),
    valorTributos: Number(itens.reduce((s, i) => s + i.valorTributos, 0).toFixed(2)),
    emitente: empresa,
    origem: 'qrcode',
    itens
  };
}

export const restaurarContaDemonstracao = db.transaction(() => {
  semente = SEMENTE_INICIAL;

  // Apaga só a conta demo; notas, itens e preços dela saem em cascata.
  db.prepare('DELETE FROM usuario WHERE email = ?').run(EMAIL_DEMONSTRACAO);
  removerRegistrosOrfaos();

  // A conta de demonstração já nasce com a política vigente aceita.
  const usuario = db
    .prepare(
      `INSERT INTO usuario (nome, email, senha_hash, politica_versao, politica_aceita_em)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run('Henrique Gonsalves', EMAIL_DEMONSTRACAO, bcrypt.hashSync(SENHA_DEMONSTRACAO, 10), VERSAO_POLITICA, new Date().toISOString());
  const usuarioId = Number(usuario.lastInsertRowid);

  // Seis meses de compras: 3 notas/mês no supermercado e no atacado,
  // mais compras esparsas no mercadinho e na farmácia.
  const planoMensal = [0, 0, 1, 2, 0, 1, 2, 3];
  let numero = 1001;
  let importadas = 0;

  for (let mes = 0; mes < 6; mes++) {
    for (const empresaIndice of planoMensal) {
      if (empresaIndice === 3 && mes % 2 !== 0) continue; // farmácia a cada dois meses
      if (empresaIndice === 2 && aleatorio() < 0.35) continue;

      const nota = gerarNota({ empresaIndice, indiceMes: mes, numero: numero++ });
      try {
        importarNota(usuarioId, nota);
        importadas++;
      } catch (erro) {
        if (erro.status !== 409) throw erro;
      }
    }
  }

  const contagem = db
    .prepare(
      `SELECT COUNT(DISTINCT n.id) AS notas, COUNT(i.id) AS itens,
              COUNT(DISTINCT i.produto_id) AS produtos, COUNT(DISTINCT n.empresa_id) AS estabelecimentos
         FROM nota_fiscal n JOIN item_nota i ON i.nota_id = n.id
        WHERE n.usuario_id = ?`
    )
    .get(usuarioId);
  return { usuarioId, importadas, ...contagem };
});

function executar() {
  const resumo = restaurarContaDemonstracao();
  console.log('Conta de demonstração restaurada:');
  console.log(`  usuário .............. ${EMAIL_DEMONSTRACAO} / ${SENHA_DEMONSTRACAO}`);
  console.log(`  notas fiscais ........ ${resumo.notas}`);
  console.log(`  itens ................ ${resumo.itens}`);
  console.log(`  produtos distintos ... ${resumo.produtos}`);
  console.log(`  estabelecimentos ..... ${resumo.estabelecimentos}`);
}

// Executa só quando chamado pela linha de comando, não ao ser importado nos testes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) executar();

/**
 * Interpretação da chave de acesso da NF-e / NFC-e (44 dígitos).
 *
 * Layout definido pelo Manual de Orientação do Contribuinte (MOC), versão 7.0:
 *   cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 */

const UF_POR_CODIGO = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL',
  28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR',
  42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF'
};

const MODELOS = { 55: 'NF-e', 65: 'NFC-e' };

export function somenteDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

/**
 * Extrai a chave de 44 dígitos de um conteúdo de QR Code.
 * O QR Code da NFC-e traz uma URL de consulta cujo parâmetro `p` (ou `chNFe`)
 * começa pela chave de acesso.
 */
export function extrairChave(conteudo) {
  const bruto = String(conteudo ?? '').trim();

  const direto = somenteDigitos(bruto);
  if (direto.length === 44) return direto;

  const porParametro = bruto.match(/(?:chNFe|[?&]p)=(\d{44})/i);
  if (porParametro) return porParametro[1];

  const primeiraSequencia = bruto.match(/\d{44}/);
  if (primeiraSequencia) return primeiraSequencia[0];

  return null;
}

/** Dígito verificador da chave — módulo 11 com pesos cíclicos de 2 a 9. */
export function calcularDigitoVerificador(chave43) {
  let peso = 2;
  let soma = 0;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

export function validarChave(chave) {
  if (!/^\d{44}$/.test(chave ?? '')) return false;
  return calcularDigitoVerificador(chave.slice(0, 43)) === Number(chave[43]);
}

/** Decompõe a chave nos campos previstos pelo MOC. */
export function interpretarChave(chave) {
  if (!validarChave(chave)) {
    throw new Error('Chave de acesso inválida: dígito verificador não confere.');
  }

  const cUF = chave.slice(0, 2);
  const ano = Number(chave.slice(2, 4));
  const mes = chave.slice(4, 6);

  return {
    chave,
    cUF,
    uf: UF_POR_CODIGO[Number(cUF)] ?? null,
    anoMesEmissao: `${2000 + ano}-${mes}`,
    cnpjEmitente: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    descricaoModelo: MODELOS[Number(chave.slice(20, 22))] ?? 'Desconhecido',
    serie: String(Number(chave.slice(22, 25))),
    numero: String(Number(chave.slice(25, 34))),
    tipoEmissao: chave.slice(34, 35),
    codigoNumerico: chave.slice(35, 43),
    digitoVerificador: chave.slice(43)
  };
}

export function formatarCnpj(cnpj) {
  const d = somenteDigitos(cnpj).padStart(14, '0');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * GTIN (EAN-8, UPC-A, EAN-13, GTIN-14): código de barras atribuído ao produto
 * pelo fabricante, estável entre estabelecimentos.
 *
 * Os documentos fiscais nem sempre trazem um GTIN no campo de código: portais
 * estaduais devolvem o código interno da loja ("11956", "210004") e sistemas de
 * frente de caixa completam esse código com zeros ("0000000007379"), o que às
 * vezes produz um dígito verificador válido por acaso. Por isso o código só é
 * aceito se, sem os zeros à esquerda, tiver ao menos 8 dígitos e o dígito
 * verificador conferir. O valor é devolvido sem os zeros à esquerda, para que o
 * mesmo produto tenha a mesma chave em qualquer loja ("07891..." e "7891...").
 */
export function normalizarGtin(codigo) {
  const bruto = String(codigo ?? '').trim();
  if (!/^\d{8,14}$/.test(bruto)) return null;

  const significativo = bruto.replace(/^0+/, '');
  if (significativo.length < 8) return null;

  let soma = 0;
  for (let i = bruto.length - 2, peso = 3; i >= 0; i--, peso = 4 - peso) soma += Number(bruto[i]) * peso;
  return (10 - (soma % 10)) % 10 === Number(bruto[bruto.length - 1]) ? significativo : null;
}

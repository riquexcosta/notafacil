/**
 * Configuração de implantação: abertura do cadastro, proxy reverso e cliente
 * web servido pela própria API.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Indica se novas contas podem ser criadas. O cadastro fica aberto por padrão
 * e é fechado com CADASTRO_ABERTO=false, como na instalação de demonstração,
 * em que só a conta de demonstração existe. Lido a cada chamada, para que a
 * mudança da variável valha sem alterar o código.
 */
export function cadastroAberto(ambiente = process.env) {
  return ambiente.CADASTRO_ABERTO?.trim().toLowerCase() !== 'false';
}

/**
 * Quantas contas um mesmo IP pode criar por hora (LIMITE_CADASTROS_POR_HORA,
 * padrão 5). Com o cadastro aberto, evita a criação em massa de contas que
 * consumiriam a consulta paga.
 */
export function limiteDeCadastrosPorHora(ambiente = process.env) {
  const valor = Number(ambiente.LIMITE_CADASTROS_POR_HORA);
  return Number.isInteger(valor) && valor > 0 ? valor : 5;
}

/**
 * Valor de `trust proxy` do Express. Atrás de um proxy reverso (nginx), o IP
 * real do cliente chega em X-Forwarded-For; sem essa configuração o limite de
 * tentativas de login trataria todos os acessos como vindos do próprio proxy.
 * Aceita um número de saltos ("1") ou os nomes do Express ("loopback").
 */
export function confiancaNoProxy(ambiente = process.env) {
  const valor = ambiente.TRUST_PROXY?.trim();
  if (!valor) return false;
  return /^\d+$/.test(valor) ? Number(valor) : valor;
}

/** Pasta com o build do cliente web (web/dist), servida quando existir. */
export function pastaDoCliente(ambiente = process.env) {
  if (ambiente.CLIENTE_DIR?.trim()) return path.resolve(ambiente.CLIENTE_DIR.trim());
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
}

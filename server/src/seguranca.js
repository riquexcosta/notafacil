/**
 * Medidas de segurança da API (art. 46 da LGPD): segredo de assinatura, origens
 * permitidas, cabeçalhos HTTP e limite de tentativas de login.
 */

const SEGREDO_DESENVOLVIMENTO = 'notafacil-desenvolvimento';

/**
 * Segredo que assina os tokens de sessão. Em produção é obrigatório defini-lo:
 * com o valor padrão, qualquer pessoa que leia o código poderia forjar sessões.
 */
export function resolverSegredoJwt(ambiente = process.env) {
  const segredo = ambiente.JWT_SECRET?.trim();
  if (segredo) return segredo;
  if (ambiente.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET é obrigatório em produção. Defina um segredo longo e aleatório.');
  }
  return SEGREDO_DESENVOLVIMENTO;
}

/** Origens autorizadas a chamar a API pelo navegador (CORS). */
export function origensPermitidas(ambiente = process.env) {
  const lista = ambiente.CORS_ORIGENS?.split(',').map((o) => o.trim()).filter(Boolean);
  return lista?.length ? lista : ['http://localhost:5173'];
}

/** Cabeçalhos que reduzem exposição a ataques comuns no navegador. */
export function cabecalhosDeSeguranca(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  next();
}

/**
 * Limita tentativas de login malsucedidas por chave (IP + e-mail) dentro de uma
 * janela de tempo. O estado fica em memória: basta para uma instância única.
 */
export function criarLimitadorDeLogin({ maximo = 5, janelaMs = 15 * 60 * 1000, agora = Date.now } = {}) {
  const falhas = new Map();

  function tentativasValidas(chave) {
    const limite = agora() - janelaMs;
    const lista = (falhas.get(chave) ?? []).filter((instante) => instante > limite);
    if (lista.length) falhas.set(chave, lista);
    else falhas.delete(chave);
    return lista;
  }

  return {
    /** Segundos até liberar novas tentativas, ou 0 quando a chave não está bloqueada. */
    segundosDeBloqueio(chave) {
      const lista = tentativasValidas(chave);
      if (lista.length < maximo) return 0;
      return Math.max(1, Math.ceil((lista[0] + janelaMs - agora()) / 1000));
    },
    registrarFalha(chave) {
      falhas.set(chave, [...tentativasValidas(chave), agora()]);
    },
    limpar(chave) {
      falhas.delete(chave);
    }
  };
}

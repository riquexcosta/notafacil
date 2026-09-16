import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, atualizarUsuarioDaSessao, dataBr, lerSessao } from '../servicos/api.js';
import { Vazio } from '../componentes/comuns.jsx';

/**
 * Política de privacidade. É pública; para quem está logado com uma versão
 * antiga aceita, também registra o aceite da versão vigente.
 */
export default function Privacidade() {
  const navegar = useNavigate();
  const { state } = useLocation();
  const sessao = lerSessao();
  const [politica, setPolitica] = useState(null);
  const [consentimento, setConsentimento] = useState(false);
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.privacidade().then(setPolitica).catch((e) => setErro(e.message));
  }, []);

  async function aceitar() {
    setEnviando(true);
    setErro(null);
    try {
      atualizarUsuarioDaSessao(await api.aceitarPolitica(politica.versao));
      navegar(state?.voltarPara ?? '/painel', { replace: true });
    } catch (e) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  if (!politica) return erro ? <div className="aviso erro">{erro}</div> : <Vazio>Carregando política…</Vazio>;

  const pendente = sessao?.token && sessao.usuario?.politicaPendente;

  return (
    <div className="pagina-avulsa">
      <header className="cabecalho-pagina">
        <div className="marca marca-escura">
          <span className="marca-icone">▤</span>
          NotaFácil
        </div>
        <h1>Política de privacidade</h1>
        <p>
          Versão {politica.versao}, vigente desde {dataBr(politica.vigenteDesde)}. {politica.controlador.papel}:{' '}
          {politica.controlador.nome} ({politica.controlador.contato}).
        </p>
      </header>

      {pendente && (
        <div className="aviso informacao" style={{ marginBottom: 16 }}>
          A política de privacidade mudou. Leia a versão {politica.versao} e confirme o aceite no fim da página para
          continuar usando o NotaFácil.
        </div>
      )}

      <div className="cartao politica">
        {politica.secoes.map((secao) => (
          <section key={secao.titulo}>
            <h2>{secao.titulo}</h2>
            {secao.paragrafos.map((paragrafo) => (
              <p key={paragrafo}>{paragrafo}</p>
            ))}
          </section>
        ))}
      </div>

      <div className="cartao">
        {pendente ? (
          <>
            <label className="caixa-aceite">
              <input type="checkbox" checked={consentimento} onChange={(e) => setConsentimento(e.target.checked)} />
              <span>
                Li a política versão {politica.versao} e consinto, de forma específica, com o tratamento das compras que
                possam revelar dados de saúde, como medicamentos, apenas para exibição no meu histórico.
              </span>
            </label>
            {erro && <div className="aviso erro" style={{ marginTop: 12 }}>{erro}</div>}
            <div className="barra-acoes" style={{ marginTop: 14 }}>
              <button type="button" className="botao-primario" disabled={!consentimento || enviando} onClick={aceitar}>
                {enviando ? 'Registrando…' : 'Aceitar e continuar'}
              </button>
            </div>
          </>
        ) : sessao?.token ? (
          <div className="barra-acoes">
            <span className="fraco">
              Você aceitou a versão {sessao.usuario?.politicaVersao}
              {sessao.usuario?.politicaAceitaEm && ` em ${dataBr(sessao.usuario.politicaAceitaEm)}`}.
            </span>
            <div className="espaco" />
            <Link className="botao botao-secundario" to="/conta">
              Minha conta
            </Link>
            <Link className="botao botao-primario" to="/painel">
              Voltar ao painel
            </Link>
          </div>
        ) : (
          <div className="barra-acoes">
            <div className="espaco" />
            <Link className="botao botao-primario" to="/entrar">
              Voltar para a entrada
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, gravarSessao } from '../servicos/api.js';

export default function Entrar() {
  const navegar = useNavigate();
  const [aba, setAba] = useState('entrar');
  const [dados, setDados] = useState({ nome: '', email: 'demo@notafacil.app', senha: 'demo1234' });
  const [aceitePolitica, setAceitePolitica] = useState(false);
  const [consentimento, setConsentimento] = useState(false);
  const [versaoPolitica, setVersaoPolitica] = useState(null);
  // Só mostra a aba de cadastro quando a instalação aceita novas contas.
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    api
      .privacidade()
      .then((p) => setVersaoPolitica(p.versao))
      .catch(() => setVersaoPolitica(null));
    api
      .saude()
      .then((s) => setCadastroAberto(s.cadastroAberto !== false))
      .catch(() => setCadastroAberto(false));
  }, []);

  const alterar = (campo) => (evento) => setDados({ ...dados, [campo]: evento.target.value });
  const cadastro = cadastroAberto && aba === 'cadastro';

  async function enviar(evento) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const sessao = cadastro
        ? await api.cadastrar({
            ...dados,
            aceitePolitica,
            consentimentoDadosSensiveis: consentimento,
            versaoPolitica
          })
        : await api.entrar({ email: dados.email, senha: dados.senha });
      gravarSessao(sessao);
      navegar(sessao.usuario?.politicaPendente ? '/privacidade' : '/painel');
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="tela-login">
      <section className="login-apresentacao">
        <div className="marca">
          <span className="marca-icone">▤</span>
          NotaFácil
        </div>
        <h1>Suas notas fiscais viram histórico de preços</h1>
        <p>
          Leia o QR Code da NFC-e no caixa e acompanhe quanto cada produto custou nas suas compras
          anteriores, em cada estabelecimento.
        </p>
        <ul>
          <li>Leitura da nota pela câmera ou importação do XML autorizado</li>
          <li>Comparação automática com o preço pago da última vez</li>
          <li>Produtos recorrentes, variação de preços e carga tributária</li>
        </ul>
      </section>

      <section className="login-formulario">
        {cadastroAberto ? (
          <div className="abas">
            <button type="button" className={!cadastro ? 'ativa' : undefined} onClick={() => setAba('entrar')}>
              Entrar
            </button>
            <button type="button" className={cadastro ? 'ativa' : undefined} onClick={() => setAba('cadastro')}>
              Criar conta
            </button>
          </div>
        ) : (
          <h2 className="titulo-entrar">Entrar</h2>
        )}

        <form onSubmit={enviar}>
          {cadastro && (
            <div className="campo">
              <label htmlFor="nome">Nome</label>
              <input id="nome" value={dados.nome} onChange={alterar('nome')} required />
            </div>
          )}

          <div className="campo">
            <label htmlFor="email">E-mail</label>
            <input id="email" type="email" value={dados.email} onChange={alterar('email')} required />
          </div>

          <div className="campo">
            <label htmlFor="senha">Senha</label>
            <input
              id="senha"
              type="password"
              value={dados.senha}
              onChange={alterar('senha')}
              required
              minLength={cadastro ? 8 : undefined}
            />
            {cadastro && <span className="dica">Ao menos 8 caracteres.</span>}
          </div>

          {cadastro && (
            <div className="aceites">
              <label className="caixa-aceite">
                <input
                  type="checkbox"
                  checked={aceitePolitica}
                  onChange={(e) => setAceitePolitica(e.target.checked)}
                  required
                />
                <span>
                  Li e aceito a{' '}
                  <Link to="/privacidade" target="_blank" rel="noopener">
                    política de privacidade
                  </Link>
                  {versaoPolitica && ` (versão ${versaoPolitica})`}.
                </span>
              </label>
              <label className="caixa-aceite destaque">
                <input
                  type="checkbox"
                  checked={consentimento}
                  onChange={(e) => setConsentimento(e.target.checked)}
                  required
                />
                <span>
                  Consinto com o tratamento das compras que possam revelar dados de saúde, como medicamentos, apenas
                  para exibição no meu histórico. Posso revogar excluindo as notas ou a conta.
                </span>
              </label>
            </div>
          )}

          {erro && <div className="aviso erro">{erro}</div>}

          <button
            type="submit"
            className="botao-primario"
            disabled={carregando || (cadastro && (!aceitePolitica || !consentimento || !versaoPolitica))}
          >
            {carregando ? 'Aguarde…' : cadastro ? 'Criar conta' : 'Entrar'}
          </button>
        </form>

        <div className="aviso informacao">
          Conta de demonstração: <strong>demo@notafacil.app</strong> / <strong>demo1234</strong>
        </div>
        <Link to="/privacidade" className="link-discreto">
          Como o NotaFácil trata os seus dados
        </Link>
      </section>
    </div>
  );
}

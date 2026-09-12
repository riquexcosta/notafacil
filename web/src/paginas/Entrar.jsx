import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, gravarSessao } from '../servicos/api.js';

export default function Entrar() {
  const navegar = useNavigate();
  const [aba, setAba] = useState('entrar');
  const [dados, setDados] = useState({ nome: '', email: 'demo@notafacil.app', senha: 'demo1234' });
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);

  const alterar = (campo) => (evento) => setDados({ ...dados, [campo]: evento.target.value });

  async function enviar(evento) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const sessao =
        aba === 'entrar'
          ? await api.entrar({ email: dados.email, senha: dados.senha })
          : await api.cadastrar(dados);
      gravarSessao(sessao);
      navegar('/painel');
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
        <div className="abas">
          <button
            type="button"
            className={aba === 'entrar' ? 'ativa' : undefined}
            onClick={() => setAba('entrar')}
          >
            Entrar
          </button>
          <button
            type="button"
            className={aba === 'cadastro' ? 'ativa' : undefined}
            onClick={() => setAba('cadastro')}
          >
            Criar conta
          </button>
        </div>

        <form onSubmit={enviar}>
          {aba === 'cadastro' && (
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
              minLength={6}
            />
          </div>

          {erro && <div className="aviso erro">{erro}</div>}

          <button type="submit" className="botao-primario" disabled={carregando}>
            {carregando ? 'Aguarde…' : aba === 'entrar' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>

        <div className="aviso informacao">
          Conta de demonstração: <strong>demo@notafacil.app</strong> / <strong>demo1234</strong>
        </div>
      </section>
    </div>
  );
}

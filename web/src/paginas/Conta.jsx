import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  atualizarUsuarioDaSessao,
  baixarJson,
  dataBr,
  encerrarSessao
} from '../servicos/api.js';
import { Cabecalho, Vazio } from '../componentes/comuns.jsx';

/** Direitos do titular (art. 18 da LGPD): acesso, correção, portabilidade e eliminação. */
export default function Conta() {
  const [conta, setConta] = useState(null);
  const [formulario, setFormulario] = useState({ nome: '', email: '' });
  const [mensagem, setMensagem] = useState(null);
  const [erro, setErro] = useState(null);
  const [senhaExclusao, setSenhaExclusao] = useState('');
  const [confirmaExclusao, setConfirmaExclusao] = useState(false);
  const [ocupado, setOcupado] = useState(null);

  useEffect(() => {
    api
      .conta()
      .then((c) => {
        setConta(c);
        setFormulario({ nome: c.nome, email: c.email });
      })
      .catch((e) => setErro(e.message));
  }, []);

  async function executar(acao, funcao) {
    setOcupado(acao);
    setErro(null);
    setMensagem(null);
    try {
      await funcao();
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  }

  const salvar = (evento) => {
    evento.preventDefault();
    executar('salvar', async () => {
      const atualizada = await api.atualizarConta(formulario);
      setConta(atualizada);
      atualizarUsuarioDaSessao(atualizada);
      setMensagem('Dados atualizados.');
    });
  };

  const exportar = () =>
    executar('exportar', async () => {
      const dados = await api.exportarDados();
      baixarJson(dados, `notafacil-meus-dados-${new Date().toISOString().slice(0, 10)}.json`);
      setMensagem(`Arquivo gerado com ${dados.notas.length} notas.`);
    });

  const excluir = (evento) => {
    evento.preventDefault();
    executar('excluir', async () => {
      await api.excluirConta(senhaExclusao);
      encerrarSessao();
      window.location.assign('/entrar');
    });
  };

  if (!conta) return erro ? <div className="aviso erro">{erro}</div> : <Vazio>Carregando conta…</Vazio>;

  return (
    <>
      <Cabecalho
        titulo="Minha conta"
        descricao="Consulte, corrija, exporte ou exclua os seus dados, conforme a Lei Geral de Proteção de Dados."
      />

      {mensagem && <div className="aviso sucesso" style={{ marginBottom: 16 }}>{mensagem}</div>}
      {erro && <div className="aviso erro" style={{ marginBottom: 16 }}>{erro}</div>}

      <div className="grade grade-2">
        <div className="cartao">
          <h2>Dados cadastrais</h2>
          <p className="legenda">Direito de correção. O e-mail é usado para entrar no sistema.</p>
          <form className="formulario-vertical" onSubmit={salvar}>
            <div className="campo">
              <label htmlFor="conta-nome">Nome</label>
              <input
                id="conta-nome"
                value={formulario.nome}
                onChange={(e) => setFormulario({ ...formulario, nome: e.target.value })}
                minLength={2}
                required
              />
            </div>
            <div className="campo">
              <label htmlFor="conta-email">E-mail</label>
              <input
                id="conta-email"
                type="email"
                value={formulario.email}
                onChange={(e) => setFormulario({ ...formulario, email: e.target.value })}
                required
              />
            </div>
            <div className="barra-acoes">
              <button type="submit" className="botao-primario" disabled={ocupado === 'salvar'}>
                {ocupado === 'salvar' ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
          </form>
        </div>

        <div className="cartao">
          <h2>Privacidade</h2>
          <p className="legenda">Consentimento registrado e acesso aos dados.</p>
          <div className="painel-chave">
            <div>
              <span className="rotulo">Política aceita</span>
              <span className="conteudo">versão {conta.politicaVersao ?? '—'}</span>
            </div>
            <div>
              <span className="rotulo">Aceite em</span>
              <span className="conteudo">{dataBr(conta.politicaAceitaEm)}</span>
            </div>
            <div>
              <span className="rotulo">Conta criada em</span>
              <span className="conteudo">{dataBr(conta.criadoEm)}</span>
            </div>
          </div>
          <div className="barra-acoes" style={{ marginTop: 16 }}>
            <button type="button" className="botao-secundario" onClick={exportar} disabled={ocupado === 'exportar'}>
              {ocupado === 'exportar' ? 'Gerando…' : 'Baixar meus dados (JSON)'}
            </button>
            <Link className="botao botao-secundario" to="/privacidade">
              Ler a política
            </Link>
          </div>
        </div>
      </div>

      <div className="cartao zona-perigo">
        <h2>Excluir conta</h2>
        <p className="legenda">
          Direito de eliminação. Apaga imediatamente a conta, todas as notas, itens e preços registrados. Não é possível
          desfazer. Para excluir apenas uma compra, abra a nota e use a opção de exclusão.
        </p>
        <form className="formulario-vertical" onSubmit={excluir}>
          <label className="caixa-aceite">
            <input type="checkbox" checked={confirmaExclusao} onChange={(e) => setConfirmaExclusao(e.target.checked)} />
            <span>Entendo que todos os meus dados serão apagados definitivamente.</span>
          </label>
          <div className="campo" style={{ maxWidth: 320 }}>
            <label htmlFor="senha-exclusao">Confirme com a sua senha</label>
            <input
              id="senha-exclusao"
              type="password"
              value={senhaExclusao}
              onChange={(e) => setSenhaExclusao(e.target.value)}
              required
            />
          </div>
          <div className="barra-acoes">
            <button
              type="submit"
              className="botao-perigo"
              disabled={!confirmaExclusao || !senhaExclusao || ocupado === 'excluir'}
            >
              {ocupado === 'excluir' ? 'Excluindo…' : 'Excluir minha conta e meus dados'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

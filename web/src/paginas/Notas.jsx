import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dataBr, moeda } from '../servicos/api.js';
import { Cabecalho, Vazio } from '../componentes/comuns.jsx';

const FILTROS_INICIAIS = { busca: '', chave: '', dataInicio: '', dataFim: '' };

export default function Notas() {
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [listagem, setListagem] = useState(null);
  const [erro, setErro] = useState(null);

  function carregar(f = filtros) {
    api.listarNotas(f).then(setListagem).catch((e) => setErro(e.message));
  }

  useEffect(() => {
    carregar(FILTROS_INICIAIS);
  }, []);

  const alterar = (campo) => (e) => setFiltros({ ...filtros, [campo]: e.target.value });

  const notas = listagem?.notas;

  return (
    <>
      <Cabecalho
        titulo="Histórico de notas"
        descricao="Filtre por estabelecimento, período ou chave de acesso."
        acoes={
          <Link className="botao botao-primario" to="/leitura">
            Ler nova nota
          </Link>
        }
      />

      <div className="cartao">
        <form
          className="linha-filtros"
          onSubmit={(e) => {
            e.preventDefault();
            carregar();
          }}
        >
          <div className="campo">
            <label htmlFor="busca">Estabelecimento ou CNPJ</label>
            <input id="busca" value={filtros.busca} onChange={alterar('busca')} placeholder="Ex.: Atacadão" />
          </div>
          <div className="campo">
            <label htmlFor="chave">Chave de acesso</label>
            <input id="chave" value={filtros.chave} onChange={alterar('chave')} placeholder="Trecho da chave" />
          </div>
          <div className="campo">
            <label htmlFor="inicio">De</label>
            <input id="inicio" type="date" value={filtros.dataInicio} onChange={alterar('dataInicio')} />
          </div>
          <div className="campo">
            <label htmlFor="fim">Até</label>
            <input id="fim" type="date" value={filtros.dataFim} onChange={alterar('dataFim')} />
          </div>
          <div className="barra-acoes">
            <button type="submit" className="botao-primario">
              Filtrar
            </button>
            <button
              type="button"
              className="botao-secundario"
              onClick={() => {
                setFiltros(FILTROS_INICIAIS);
                carregar(FILTROS_INICIAIS);
              }}
            >
              Limpar
            </button>
          </div>
        </form>
      </div>

      {erro && <div className="aviso erro">{erro}</div>}

      <div className="cartao">
        <div className="barra-acoes" style={{ marginBottom: 10 }}>
          <h2>{listagem ? `${listagem.quantidade} notas encontradas` : 'Carregando…'}</h2>
          <div className="espaco" />
          {listagem && (
            <span className="fraco">
              Total: {moeda(listagem.valorTotal)} · tributos: {moeda(listagem.valorTributos)}
            </span>
          )}
        </div>
        {listagem && listagem.quantidade > notas.length && (
          <div className="aviso informacao" style={{ marginBottom: 10 }}>
            Exibindo as {notas.length} notas mais recentes. Quantidade e totais consideram todas as{' '}
            {listagem.quantidade}; use os filtros para refinar a lista.
          </div>
        )}

        {notas?.length === 0 ? (
          <Vazio>Nenhuma nota corresponde aos filtros informados.</Vazio>
        ) : (
          <div className="rolagem-horizontal">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Estabelecimento</th>
                  <th>Chave de acesso</th>
                  <th className="num">Itens</th>
                  <th className="num">Tributos</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {(notas ?? []).map((n) => (
                  <tr key={n.id}>
                    <td className="num">{dataBr(n.dataEmissao)}</td>
                    <td>
                      <Link to={`/notas/${n.id}`} className="descricao-produto">
                        {n.nomeFantasia ?? n.razaoSocial}
                      </Link>
                      <div className="fraco" style={{ fontSize: '0.78rem' }}>
                        {n.municipio}/{n.uf}
                      </div>
                    </td>
                    <td className="mono fraco">…{n.chave.slice(-16)}</td>
                    <td className="num">{n.totalItens}</td>
                    <td className="num fraco">{moeda(n.valorTributos)}</td>
                    <td className="num">
                      <strong>{moeda(n.valorTotal)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

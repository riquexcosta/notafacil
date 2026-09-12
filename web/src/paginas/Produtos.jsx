import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dataBr, moeda } from '../servicos/api.js';
import { Cabecalho, Vazio } from '../componentes/comuns.jsx';

const FILTROS_INICIAIS = { termo: '', ean: '', ncm: '' };

export default function Produtos() {
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [produtos, setProdutos] = useState(null);
  const [somenteRecorrentes, setSomenteRecorrentes] = useState(false);
  const [erro, setErro] = useState(null);

  function carregar(f = filtros, recorrentes = somenteRecorrentes) {
    const consulta = recorrentes ? api.produtosRecorrentes() : api.buscarProdutos(f);
    consulta.then(setProdutos).catch((e) => setErro(e.message));
  }

  useEffect(() => {
    carregar(FILTROS_INICIAIS, false);
  }, []);

  const alterar = (campo) => (e) => setFiltros({ ...filtros, [campo]: e.target.value });

  return (
    <>
      <Cabecalho
        titulo="Produtos"
        descricao="Busque pelo código de barras (EAN), pela classificação fiscal (NCM) ou pela descrição."
      />

      <div className="cartao">
        <form
          className="linha-filtros"
          onSubmit={(e) => {
            e.preventDefault();
            setSomenteRecorrentes(false);
            carregar(filtros, false);
          }}
        >
          <div className="campo">
            <label htmlFor="termo">Descrição</label>
            <input id="termo" value={filtros.termo} onChange={alterar('termo')} placeholder="Ex.: café" />
          </div>
          <div className="campo">
            <label htmlFor="ean">EAN (código de barras)</label>
            <input id="ean" className="mono" value={filtros.ean} onChange={alterar('ean')} placeholder="7891000100103" />
          </div>
          <div className="campo">
            <label htmlFor="ncm">NCM</label>
            <input id="ncm" className="mono" value={filtros.ncm} onChange={alterar('ncm')} placeholder="0402" />
          </div>
          <div className="barra-acoes">
            <button type="submit" className="botao-primario">
              Buscar
            </button>
            <button
              type="button"
              className="botao-secundario"
              onClick={() => {
                setFiltros(FILTROS_INICIAIS);
                setSomenteRecorrentes(true);
                carregar(FILTROS_INICIAIS, true);
              }}
            >
              Só recorrentes
            </button>
          </div>
        </form>
      </div>

      {erro && <div className="aviso erro">{erro}</div>}

      <div className="cartao">
        <div className="barra-acoes" style={{ marginBottom: 10 }}>
          <h2>
            {somenteRecorrentes ? 'Produtos recorrentes' : 'Resultado da busca'}
            {produtos && ` · ${produtos.length}`}
          </h2>
        </div>

        {produtos?.length === 0 ? (
          <Vazio>Nenhum produto encontrado com os critérios informados.</Vazio>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>EAN</th>
                <th>NCM</th>
                <th className="num">Compras</th>
                <th className="num">Menor</th>
                <th className="num">Médio</th>
                <th className="num">Maior</th>
                <th className="num">Última</th>
              </tr>
            </thead>
            <tbody>
              {(produtos ?? []).map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/produtos/${p.id}`} className="descricao-produto">
                      {p.descricao}
                    </Link>
                  </td>
                  <td className="mono fraco">{p.ean ?? '—'}</td>
                  <td className="mono fraco">{p.ncm ?? '—'}</td>
                  <td className="num">{p.ocorrencias}</td>
                  <td className="num">{moeda(p.menorPreco)}</td>
                  <td className="num">{moeda(p.precoMedio)}</td>
                  <td className="num">{moeda(p.maiorPreco)}</td>
                  <td className="num fraco">{dataBr(p.ultimaCompra)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

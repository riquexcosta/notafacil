import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dataBr, moeda, percentual } from '../servicos/api.js';
import { Cabecalho, Indicador, Vazio } from '../componentes/comuns.jsx';

const FILTROS_INICIAIS = { dataInicio: '', dataFim: '', empresas: [] };

export default function Comparativo() {
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [opcoesDeLoja, setOpcoesDeLoja] = useState([]);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);

  function carregar(f = filtros) {
    api
      .compararEstabelecimentos({ ...f, empresas: f.empresas.join(',') })
      .then((r) => {
        setErro(null);
        setResultado(r);
      })
      .catch((e) => setErro(e.message));
  }

  useEffect(() => {
    carregar(FILTROS_INICIAIS);
    api.listarEmpresas().then(setOpcoesDeLoja).catch(() => setOpcoesDeLoja([]));
  }, []);

  const alterar = (campo) => (e) => setFiltros({ ...filtros, [campo]: e.target.value });
  const alternarLoja = (id) =>
    setFiltros({
      ...filtros,
      empresas: filtros.empresas.includes(id) ? filtros.empresas.filter((e) => e !== id) : [...filtros.empresas, id]
    });
  const lojas = resultado?.estabelecimentos ?? [];
  const nomeDaLoja = (id) => lojas.find((l) => l.id === id)?.nome ?? '—';
  const { cesta } = resultado ?? {};

  return (
    <>
      <Cabecalho
        titulo="Comparar estabelecimentos"
        descricao="Preço que você pagou pelo mesmo produto em cada loja, considerando a compra mais recente de cada uma no período."
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
            <label htmlFor="comp-inicio">De</label>
            <input id="comp-inicio" type="date" value={filtros.dataInicio} onChange={alterar('dataInicio')} />
          </div>
          <div className="campo">
            <label htmlFor="comp-fim">Até</label>
            <input id="comp-fim" type="date" value={filtros.dataFim} onChange={alterar('dataFim')} />
          </div>
          <div className="barra-acoes">
            <button type="submit" className="botao-primario">
              Comparar
            </button>
            <button
              type="button"
              className="botao-secundario"
              onClick={() => {
                setFiltros(FILTROS_INICIAIS);
                carregar(FILTROS_INICIAIS);
              }}
            >
              Limpar filtros
            </button>
          </div>
        </form>
        {opcoesDeLoja.length > 1 && (
          <div className="selecao-lojas">
            <span className="fraco">{filtros.empresas.length ? 'Lojas:' : 'Lojas (todas):'}</span>
            {opcoesDeLoja.map((l) => (
              <label key={l.id} className={`chip ${filtros.empresas.includes(l.id) ? 'ativo' : ''}`}>
                <input type="checkbox" checked={filtros.empresas.includes(l.id)} onChange={() => alternarLoja(l.id)} />
                {l.nomeFantasia ?? l.razaoSocial}
              </label>
            ))}
          </div>
        )}
      </div>

      {erro && <div className="aviso erro">{erro}</div>}
      {!resultado && !erro && <Vazio>Carregando comparativo…</Vazio>}

      {resultado && lojas.length < 2 && (
        <div className="cartao">
          <Vazio>
            A comparação precisa de compras em pelo menos dois estabelecimentos no período. Registre notas de lojas
            diferentes para ver o comparativo.
          </Vazio>
        </div>
      )}

      {resultado && lojas.length >= 2 && (
        <>
          {cesta ? (
            <div className="grade grade-3" style={{ marginTop: 16 }}>
              <Indicador
                rotulo="Cesta mais barata"
                valor={nomeDaLoja(cesta.empresaMaisBarata)}
                apoio={`${moeda(cesta.custoPorLoja[0].total)} por ${cesta.produtos.length} produtos em comum`}
              />
              <Indicador
                rotulo="Cesta mais cara"
                valor={nomeDaLoja(cesta.empresaMaisCara)}
                apoio={moeda(cesta.custoPorLoja[cesta.custoPorLoja.length - 1].total)}
              />
              <Indicador
                rotulo="Economia na cesta"
                valor={moeda(cesta.economia)}
                apoio={`${percentual(cesta.economiaPercentual)} a menos que na loja mais cara`}
              />
            </div>
          ) : (
            <div className="aviso informacao" style={{ marginTop: 16 }}>
              Nenhum produto foi comprado em todas as {lojas.length} lojas no período, então não há cesta comum. A
              tabela abaixo compara os produtos presentes em pelo menos duas delas.
            </div>
          )}

          <div className="cartao">
            <h2>Preço por produto e estabelecimento</h2>
            <p className="legenda">
              Em destaque, o menor preço de cada produto. Amplitude = (maior − menor) / menor. Cesta = soma do preço de
              uma unidade de cada produto comprado em todas as lojas (itens por quilo usam o preço do quilo).
            </p>
            {resultado.produtos.length === 0 ? (
              <Vazio>Nenhum produto foi comprado em mais de um estabelecimento no período.</Vazio>
            ) : (
              <div className="rolagem-horizontal">
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      {lojas.map((l) => (
                        <th key={l.id} className="num">
                          {l.nome}
                        </th>
                      ))}
                      <th className="num">Diferença</th>
                      <th className="num">Amplitude</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.produtos.map((p) => (
                      <tr key={p.produtoId}>
                        <td>
                          <Link to={`/produtos/${p.produtoId}`} className="descricao-produto">
                            {p.descricao}
                          </Link>
                          <div className="mono fraco" style={{ fontSize: '0.75rem' }}>
                            {p.ean ? `EAN ${p.ean}` : 'identificado pela descrição'} · {p.unidade}
                          </div>
                        </td>
                        {lojas.map((l) => {
                          const preco = p.precos[l.id];
                          const maisBarato = p.empresasMaisBaratas.includes(l.id);
                          return (
                            <td key={l.id} className={`num ${maisBarato ? 'celula-menor-preco' : ''}`}>
                              {preco ? (
                                <>
                                  <strong>{moeda(preco.valorUnitario)}</strong>
                                  <div className="fraco" style={{ fontSize: '0.72rem' }}>
                                    {dataBr(preco.dataEmissao)}
                                  </div>
                                </>
                              ) : (
                                <span className="fraco">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="num">{moeda(p.diferenca)}</td>
                        <td className="num">
                          <span className="etiqueta estavel">{percentual(p.amplitudePercentual)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {cesta && (
                    <tfoot>
                      <tr>
                        <th>Cesta comum ({cesta.produtos.length} produtos)</th>
                        {lojas.map((l) => {
                          const custo = cesta.custoPorLoja.find((c) => c.empresaId === l.id);
                          return (
                            <th
                              key={l.id}
                              className={`num ${l.id === cesta.empresaMaisBarata ? 'celula-menor-preco' : ''}`}
                            >
                              {moeda(custo.total)}
                            </th>
                          );
                        })}
                        <th className="num">{moeda(cesta.economia)}</th>
                        <th className="num fraco">{percentual(cesta.economiaPercentual)} de economia</th>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>

          <div className="cartao">
            <h2>Menor preço por estabelecimento</h2>
            <p className="legenda">Em quantos dos produtos comparados cada loja teve o menor preço.</p>
            <table>
              <tbody>
                {[...lojas]
                  .sort((a, b) => b.produtosComMenorPreco - a.produtosComMenorPreco)
                  .map((l) => (
                    <tr key={l.id}>
                      <td className="descricao-produto">{l.nome}</td>
                      <td className="fraco">
                        {l.municipio}/{l.uf}
                      </td>
                      <td className="num">
                        {l.produtosComMenorPreco} de {resultado.produtos.length}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dataBr, moeda } from '../servicos/api.js';
import { Cabecalho, Vazio } from '../componentes/comuns.jsx';

export default function Empresas() {
  const [empresas, setEmpresas] = useState(null);
  const [selecionada, setSelecionada] = useState(null);
  const [produtos, setProdutos] = useState([]);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    api
      .listarEmpresas()
      .then((lista) => {
        setEmpresas(lista);
        if (lista[0]) selecionar(lista[0]);
      })
      .catch((e) => setErro(e.message));
  }, []);

  function selecionar(empresa) {
    setSelecionada(empresa);
    api.produtosDaEmpresa(empresa.id).then(setProdutos).catch((e) => setErro(e.message));
  }

  if (erro) return <div className="aviso erro">{erro}</div>;
  if (!empresas) return <Vazio>Carregando estabelecimentos…</Vazio>;

  return (
    <>
      <Cabecalho
        titulo="Estabelecimentos"
        descricao="Onde você compra e quais preços cada loja praticou nas notas mais recentes."
      />

      <div className="cartao">
        <table>
          <thead>
            <tr>
              <th>Estabelecimento</th>
              <th>CNPJ</th>
              <th>Município</th>
              <th className="num">Notas</th>
              <th className="num">Total gasto</th>
              <th className="num">Última compra</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {empresas.map((e) => (
              <tr key={e.id}>
                <td className="descricao-produto">{e.nomeFantasia ?? e.razaoSocial}</td>
                <td className="mono fraco">{e.cnpj}</td>
                <td>
                  {e.municipio}/{e.uf}
                </td>
                <td className="num">{e.totalNotas}</td>
                <td className="num">{moeda(e.totalGasto)}</td>
                <td className="num fraco">{dataBr(e.ultimaCompra)}</td>
                <td className="num">
                  <button
                    type="button"
                    className={selecionada?.id === e.id ? 'botao-primario' : 'botao-secundario'}
                    onClick={() => selecionar(e)}
                  >
                    Ver produtos
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selecionada && (
        <div className="cartao">
          <h2>Produtos em {selecionada.nomeFantasia ?? selecionada.razaoSocial}</h2>
          <p className="legenda">
            Preço mais recente registrado para cada produto, atualizado a cada nota importada.
          </p>
          {produtos.length === 0 ? (
            <Vazio>Nenhum produto registrado para este estabelecimento.</Vazio>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>EAN</th>
                  <th>NCM</th>
                  <th className="num">Preço</th>
                  <th className="num">Referência</th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/produtos/${p.id}`} className="descricao-produto">
                        {p.descricao}
                      </Link>
                    </td>
                    <td className="mono fraco">{p.ean ?? '—'}</td>
                    <td className="mono fraco">{p.ncm ?? '—'}</td>
                    <td className="num">
                      <strong>{moeda(p.valorUnitario)}</strong>
                    </td>
                    <td className="num fraco">{dataBr(p.dataReferencia)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

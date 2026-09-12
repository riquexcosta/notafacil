import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, dataBr, mascararChave, moeda } from '../servicos/api.js';
import { Cabecalho, EtiquetaSituacao, Vazio } from '../componentes/comuns.jsx';

export default function DetalheNota() {
  const { id } = useParams();
  const [nota, setNota] = useState(null);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    api.obterNota(id).then(setNota).catch((e) => setErro(e.message));
  }, [id]);

  if (erro) return <div className="aviso erro">{erro}</div>;
  if (!nota) return <Vazio>Carregando nota…</Vazio>;

  return (
    <>
      <Cabecalho
        titulo={nota.nomeFantasia ?? nota.razaoSocial}
        descricao={`Nota ${nota.numero}, série ${nota.serie} · emitida em ${dataBr(nota.dataEmissao)}`}
        acoes={
          <Link className="botao botao-secundario" to="/notas">
            Voltar ao histórico
          </Link>
        }
      />

      <div className="grade grade-4">
        <div className="cartao indicador">
          <span className="rotulo">Valor total</span>
          <span className="valor">{moeda(nota.valorTotal)}</span>
        </div>
        <div className="cartao indicador">
          <span className="rotulo">Tributos</span>
          <span className="valor">{moeda(nota.valorTributos)}</span>
          <span className="apoio">
            {nota.valorTotal > 0
              ? `${((nota.valorTributos / nota.valorTotal) * 100).toFixed(1)}% do total`
              : '—'}
          </span>
        </div>
        <div className="cartao indicador">
          <span className="rotulo">Itens</span>
          <span className="valor">{nota.itens.length}</span>
        </div>
        <div className="cartao indicador">
          <span className="rotulo">Origem</span>
          <span className="valor" style={{ fontSize: '1.1rem' }}>
            {{ qrcode: 'QR Code', xml: 'XML autorizado', demo: 'Catálogo local', manual: 'Manual' }[
              nota.origem
            ] ?? nota.origem}
          </span>
        </div>
      </div>

      <div className="cartao">
        <h2>Emitente</h2>
        <div className="painel-chave" style={{ marginTop: 10 }}>
          <div>
            <span className="rotulo">Razão social</span>
            <span className="conteudo">{nota.razaoSocial}</span>
          </div>
          <div>
            <span className="rotulo">CNPJ</span>
            <span className="conteudo mono">{nota.cnpjFormatado ?? nota.cnpj}</span>
          </div>
          <div>
            <span className="rotulo">Endereço</span>
            <span className="conteudo">{nota.logradouro ?? '—'}</span>
          </div>
          <div>
            <span className="rotulo">Município</span>
            <span className="conteudo">
              {nota.municipio}/{nota.uf}
            </span>
          </div>
        </div>
        <div className="mono fraco" style={{ marginTop: 12, fontSize: '0.8rem' }}>
          Chave: {mascararChave(nota.chave)}
        </div>
      </div>

      <div className="cartao">
        <h2>Itens e comparação de preços</h2>
        <p className="legenda">
          O preço anterior considera a última compra do mesmo produto em qualquer estabelecimento.
        </p>
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Qtd.</th>
              <th className="num">Unitário</th>
              <th className="num">Total</th>
              <th className="num">Anterior</th>
              <th>Comparação</th>
              <th className="num">Compras</th>
            </tr>
          </thead>
          <tbody>
            {nota.itens.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link to={`/produtos/${item.produtoId}`} className="descricao-produto">
                    {item.descricao}
                  </Link>
                  <div className="mono fraco" style={{ fontSize: '0.75rem' }}>
                    EAN {item.ean ?? '—'} · NCM {item.ncm ?? '—'}
                  </div>
                </td>
                <td className="num">
                  {item.quantidade} {item.unidade}
                </td>
                <td className="num">{moeda(item.valorUnitario)}</td>
                <td className="num">{moeda(item.valorTotal)}</td>
                <td className="num fraco">{item.precoAnterior ? moeda(item.precoAnterior) : '—'}</td>
                <td>
                  <EtiquetaSituacao situacao={item.situacao} variacao={item.variacaoPercentual} />
                </td>
                <td className="num fraco">{item.comparacoes + 1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

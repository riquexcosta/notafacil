import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, dataBr, mascararChave, moeda, percentual } from '../servicos/api.js';
import { Cabecalho, EtiquetaSituacao, Vazio } from '../componentes/comuns.jsx';

const ORIGENS = {
  qrcode: 'QR Code',
  xml: 'XML autorizado',
  infosimples: 'SEFAZ (Infosimples)',
  demo: 'Catálogo local',
  manual: 'Manual'
};

export default function DetalheNota() {
  const { id } = useParams();
  const navegar = useNavigate();
  const [nota, setNota] = useState(null);
  const [erro, setErro] = useState(null);
  const [excluindo, setExcluindo] = useState(false);

  useEffect(() => {
    api.obterNota(id).then(setNota).catch((e) => setErro(e.message));
  }, [id]);

  async function excluir() {
    const confirmado = window.confirm(
      'Excluir esta nota? Os itens e os preços registrados por ela serão apagados, e a comparação das outras notas será recalculada.'
    );
    if (!confirmado) return;
    setExcluindo(true);
    try {
      await api.excluirNota(id);
      navegar('/notas', { replace: true });
    } catch (e) {
      setErro(e.message);
      setExcluindo(false);
    }
  }

  if (erro) return <div className="aviso erro">{erro}</div>;
  if (!nota) return <Vazio>Carregando nota…</Vazio>;

  const emitidaEm = `${dataBr(nota.dataEmissao)}${nota.horaEmissao ? ` às ${nota.horaEmissao.slice(0, 5)}` : ''}`;

  return (
    <>
      <Cabecalho
        titulo={nota.nomeFantasia ?? nota.razaoSocial}
        descricao={`Nota ${nota.numero}, série ${nota.serie} · emitida em ${emitidaEm}`}
        acoes={
          <>
            <button type="button" className="botao-perigo" onClick={excluir} disabled={excluindo}>
              {excluindo ? 'Excluindo…' : 'Excluir nota'}
            </button>
            <Link className="botao botao-secundario" to="/notas">
              Voltar ao histórico
            </Link>
          </>
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
            {nota.percentualTributos === null ? '—' : `${percentual(nota.percentualTributos)} do total`}
          </span>
        </div>
        <div className="cartao indicador">
          <span className="rotulo">Itens</span>
          <span className="valor">{nota.itens.length}</span>
        </div>
        <div className="cartao indicador">
          <span className="rotulo">Origem</span>
          <span className="valor" style={{ fontSize: '1.1rem' }}>
            {ORIGENS[nota.origem] ?? nota.origem}
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
              {nota.municipio ?? '—'}/{nota.uf ?? '—'}
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
          Cada item é comparado com a sua compra anterior mais recente do mesmo produto, em qualquer estabelecimento.
          Compras posteriores a esta nota não entram na comparação.
        </p>
        <div className="rolagem-horizontal">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Qtd.</th>
                <th className="num">Unitário</th>
                <th className="num">Total</th>
                <th className="num">Anterior</th>
                <th>Comparação</th>
                <th className="num">Compra nº</th>
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
                  <td className="num fraco">
                    {item.precoAnterior ? moeda(item.precoAnterior) : '—'}
                    {item.empresaAnterior && (
                      <div style={{ fontSize: '0.72rem' }}>
                        {item.empresaAnterior}, {dataBr(item.dataAnterior)}
                      </div>
                    )}
                  </td>
                  <td>
                    <EtiquetaSituacao situacao={item.situacao} variacao={item.variacaoPercentual} />
                  </td>
                  <td className="num fraco">{item.comparacoes + 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

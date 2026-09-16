import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { api, dataBr, moeda, percentual } from '../servicos/api.js';
import { Cabecalho, Vazio } from '../componentes/comuns.jsx';

export default function DetalheProduto() {
  const { id } = useParams();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    setDados(null);
    api.historicoProduto(id).then(setDados).catch((e) => setErro(e.message));
  }, [id]);

  if (erro) return <div className="aviso erro">{erro}</div>;
  if (!dados) return <Vazio>Carregando histórico…</Vazio>;

  const { produto, historico, ofertas, estatisticas } = dados;
  // O eixo X usa o índice da compra: duas notas podem ter a mesma data e
  // categorias repetidas quebrariam o traçado da linha.
  const serie = historico.map((h, indice) => ({
    indice,
    data: dataBr(h.dataEmissao).slice(0, 5),
    preco: h.valorUnitario,
    empresa: h.empresa
  }));

  const melhorOferta = ofertas[0];

  return (
    <>
      <Cabecalho
        titulo={produto.descricao}
        descricao={`EAN ${produto.ean ?? '—'} · NCM ${produto.ncm ?? '—'} · unidade ${produto.unidade}`}
        acoes={
          <Link className="botao botao-secundario" to="/produtos">
            Voltar aos produtos
          </Link>
        }
      />

      {estatisticas && (
        <div className="grade grade-4">
          <div className="cartao indicador">
            <span className="rotulo">Compras registradas</span>
            <span className="valor">{estatisticas.compras}</span>
            <span className="apoio">notas com este produto</span>
          </div>
          <div className="cartao indicador">
            <span className="rotulo">Menor e maior preço</span>
            <span className="valor" style={{ fontSize: '1.25rem' }}>
              {moeda(estatisticas.menorPreco)} a {moeda(estatisticas.maiorPreco)}
            </span>
            <span className="apoio">amplitude de {percentual(estatisticas.amplitudePercentual)}</span>
          </div>
          <div className="cartao indicador">
            <span className="rotulo">Preço médio pago</span>
            <span className="valor">{moeda(estatisticas.precoMedio)}</span>
            <span className="apoio">total gasto ÷ quantidade comprada</span>
          </div>
          <div className="cartao indicador">
            <span className="rotulo">Variação no período</span>
            <span
              className="valor"
              style={{ color: estatisticas.variacaoPercentual > 0 ? '#b3261e' : '#10796b' }}
            >
              {estatisticas.variacaoPercentual > 0 ? '+' : ''}
              {percentual(estatisticas.variacaoPercentual)}
            </span>
            <span className="apoio">da primeira à última compra</span>
          </div>
        </div>
      )}

      <div className="cartao">
        <h2>Evolução do preço unitário</h2>
        <p className="legenda">Cada ponto corresponde a uma nota fiscal do seu histórico.</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={serie} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            <XAxis
              dataKey="indice"
              tickFormatter={(i) => serie[i]?.data ?? ''}
              tick={{ fontSize: 12, fill: '#7d8a99' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={18}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#7d8a99' }}
              tickLine={false}
              axisLine={false}
              domain={['dataMin - 1', 'dataMax + 1']}
              tickFormatter={(v) => `R$ ${Number(v).toFixed(2)}`}
              width={78}
            />
            <Tooltip
              formatter={(v, _n, item) => [moeda(v), item.payload.empresa]}
              labelFormatter={(i) => `Compra de ${serie[i]?.data ?? ''}`}
            />
            <Line
              type="monotone"
              dataKey="preco"
              stroke="#2563a8"
              strokeWidth={2.4}
              dot={{ r: 3.5, fill: '#2563a8' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grade grade-2">
        <div className="cartao">
          <h2>Onde está mais barato</h2>
          <p className="legenda">
            Preço da sua compra mais recente em cada estabelecimento. Só entram as suas notas.
          </p>
          <table>
            <thead>
              <tr>
                <th>Estabelecimento</th>
                <th className="num">Preço</th>
                <th className="num">Referência</th>
              </tr>
            </thead>
            <tbody>
              {ofertas.map((o) => (
                <tr key={o.id}>
                  <td>
                    <span className="descricao-produto">{o.empresa ?? o.razaoSocial}</span>
                    <div className="fraco" style={{ fontSize: '0.78rem' }}>
                      {o.municipio}/{o.uf}
                    </div>
                  </td>
                  <td className="num">
                    <strong>{moeda(o.valorUnitario)}</strong>
                    {o.id === melhorOferta?.id && (
                      <div>
                        <span className="etiqueta reducao">menor preço</span>
                      </div>
                    )}
                  </td>
                  <td className="num fraco">{dataBr(o.dataReferencia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="cartao">
          <h2>Compras registradas</h2>
          <p className="legenda">Histórico completo deste produto nas suas notas.</p>
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Estabelecimento</th>
                <th className="num">Qtd.</th>
                <th className="num">Unitário</th>
              </tr>
            </thead>
            <tbody>
              {[...historico].reverse().map((h, i) => (
                <tr key={i}>
                  <td className="num">{dataBr(h.dataEmissao)}</td>
                  <td>{h.empresa}</td>
                  <td className="num">{h.quantidade}</td>
                  <td className="num">{moeda(h.valorUnitario)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

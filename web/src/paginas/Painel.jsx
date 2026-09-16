import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { api, dataBr, mesBr, moeda, percentual } from '../servicos/api.js';
import { Cabecalho, Indicador, Vazio } from '../componentes/comuns.jsx';

export default function Painel() {
  const [resumo, setResumo] = useState(null);
  const [recorrentes, setRecorrentes] = useState([]);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    Promise.all([api.resumo(), api.produtosRecorrentes()])
      .then(([r, p]) => {
        setResumo(r);
        setRecorrentes(p.slice(0, 8));
      })
      .catch((e) => setErro(e.message));
  }, []);

  if (erro) return <div className="aviso erro">{erro}</div>;
  if (!resumo) return <Vazio>Carregando indicadores…</Vazio>;

  const serie = resumo.gastoPorMes.map((m) => ({ mes: mesBr(m.mes), total: m.total }));

  return (
    <>
      <Cabecalho
        titulo="Painel"
        descricao={
          resumo.totalNotas > 0
            ? `Histórico de ${dataBr(resumo.primeiraCompra)} a ${dataBr(resumo.ultimaCompra)}`
            : 'Nenhuma nota importada ainda'
        }
        acoes={
          <Link className="botao botao-primario" to="/leitura">
            Ler nova nota
          </Link>
        }
      />

      <div className="grade grade-4">
        <Indicador
          rotulo="Notas importadas"
          valor={resumo.totalNotas}
          apoio={`${resumo.totalEstabelecimentos} estabelecimentos`}
        />
        <Indicador
          rotulo="Total gasto"
          valor={moeda(resumo.totalGasto)}
          apoio={`${resumo.totalProdutos} produtos distintos`}
        />
        <Indicador
          rotulo="Tributos embutidos"
          valor={moeda(resumo.totalTributos)}
          apoio={
            resumo.percentualTributos === null ? '—' : `${percentual(resumo.percentualTributos)} do total pago`
          }
        />
        <Indicador rotulo="Ticket médio" valor={moeda(resumo.ticketMedio)} apoio="total gasto ÷ notas" />
      </div>

      <div className="grade grade-2-1" style={{ marginTop: 16 }}>
        <div className="cartao">
          <h2>Gasto por mês</h2>
          <p className="legenda">
            Soma do valor total das notas de cada mês, com zero nos meses sem compra.
          </p>
          <ResponsiveContainer width="100%" height={228}>
            <BarChart data={serie} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#7d8a99' }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 12, fill: '#7d8a99' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `R$ ${v}`}
                width={70}
              />
              <Tooltip formatter={(v) => moeda(v)} cursor={{ fill: '#f4f7fb' }} />
              <Bar dataKey="total" radius={[5, 5, 0, 0]} isAnimationActive={false}>
                {serie.map((_, i) => (
                  <Cell key={i} fill="#2563a8" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="cartao">
          <h2>Maiores variações</h2>
          <p className="legenda">Amplitude entre o menor e o maior preço já pago: (maior − menor) ÷ menor.</p>
          {resumo.maioresVariacoes.length === 0 ? (
            <Vazio>Importe mais notas para comparar preços.</Vazio>
          ) : (
            <div className="rolagem-horizontal">
              <table>
                <tbody>
                  {resumo.maioresVariacoes.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/produtos/${p.id}`} className="descricao-produto">
                          {p.descricao}
                        </Link>
                        <div className="fraco" style={{ fontSize: '0.78rem' }}>
                          {moeda(p.menorPreco)} → {moeda(p.maiorPreco)}
                        </div>
                      </td>
                      <td className="num">
                        <span className="etiqueta estavel">{percentual(p.amplitudePercentual)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="cartao">
        <h2>Produtos que você compra com frequência</h2>
        <p className="legenda">
          Itens presentes em duas ou mais notas, identificados pelo código de barras ou, sem ele, pela descrição.
          Médio = total gasto ÷ quantidade comprada. Amplitude = (maior − menor) ÷ menor.
        </p>
        {recorrentes.length === 0 ? (
          <Vazio>Nenhum produto recorrente identificado até o momento.</Vazio>
        ) : (
          <div className="rolagem-horizontal">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>NCM</th>
                  <th className="num">Compras</th>
                  <th className="num">Menor</th>
                  <th className="num">Médio</th>
                  <th className="num">Maior</th>
                  <th className="num">Amplitude</th>
                  <th className="num">Total gasto</th>
                </tr>
              </thead>
              <tbody>
                {recorrentes.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/produtos/${p.id}`} className="descricao-produto">
                        {p.descricao}
                      </Link>
                    </td>
                    <td className="mono fraco">{p.ncm ?? '—'}</td>
                    <td className="num">{p.ocorrencias}</td>
                    <td className="num">{moeda(p.menorPreco)}</td>
                    <td className="num">{moeda(p.precoMedio)}</td>
                    <td className="num">{moeda(p.maiorPreco)}</td>
                    <td className="num">
                      <span className="etiqueta estavel">{percentual(p.amplitudePercentual)}</span>
                    </td>
                    <td className="num">{moeda(p.totalGasto)}</td>
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

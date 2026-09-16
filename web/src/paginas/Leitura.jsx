import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dataBr, mascararChave, moeda } from '../servicos/api.js';
import { Cabecalho, EtiquetaSituacao } from '../componentes/comuns.jsx';

const MODOS = [
  { id: 'camera', titulo: 'Câmera', descricao: 'Aponte para o QR Code da NFC-e' },
  { id: 'chave', titulo: 'Chave de acesso', descricao: 'Digite os 44 dígitos da nota' },
  { id: 'xml', titulo: 'Arquivo XML', descricao: 'Importe o XML autorizado' }
];

export default function Leitura() {
  const [modo, setModo] = useState('chave');
  const [chave, setChave] = useState('');
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [estadoCamera, setEstadoCamera] = useState('inativa');
  const leitorRef = useRef(null);

  // Ciclo de vida do leitor de QR Code: inicia ao entrar no modo câmera e
  // encerra o acesso ao dispositivo ao sair da tela.
  useEffect(() => {
    if (modo !== 'camera') return undefined;
    let leitor;
    let cancelado = false;

    (async () => {
      try {
        setEstadoCamera('iniciando');
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelado) return;
        leitor = new Html5Qrcode('leitor-qrcode');
        leitorRef.current = leitor;
        await leitor.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 260 } },
          (texto) => {
            leitor.stop().catch(() => {});
            processar(() => api.lerQrCode(texto));
          },
          () => {}
        );
        if (!cancelado) setEstadoCamera('ativa');
      } catch {
        if (!cancelado) setEstadoCamera('indisponivel');
      }
    })();

    return () => {
      cancelado = true;
      if (leitor?.isScanning) leitor.stop().catch(() => {});
    };
  }, [modo]);

  async function processar(acao) {
    setErro(null);
    setResultado(null);
    setCarregando(true);
    try {
      setResultado(await acao());
    } catch (e) {
      setErro({ mensagem: e.message, codigo: e.dados?.codigo, urlConsulta: e.dados?.urlConsulta });
    } finally {
      setCarregando(false);
    }
  }

  const enviarChave = (evento) => {
    evento.preventDefault();
    processar(() => api.lerQrCode(chave));
  };

  const enviarXml = (evento) => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    arquivo.text().then((xml) => processar(() => api.enviarXml(xml)));
  };

  return (
    <>
      <Cabecalho
        titulo="Ler nota fiscal"
        descricao="A leitura identifica o emitente, os produtos e compara os preços com o seu histórico."
      />

      <div className="cartao">
        <div className="opcoes-leitura">
          {MODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`opcao-leitura ${modo === m.id ? 'ativa' : ''}`}
              onClick={() => {
                setModo(m.id);
                setErro(null);
              }}
            >
              <strong>{m.titulo}</strong>
              <span>{m.descricao}</span>
            </button>
          ))}
        </div>

        {modo === 'camera' && (
          <>
            <div id="leitor-qrcode" />
            {estadoCamera !== 'ativa' && (
              <div className="moldura-camera">
                {estadoCamera === 'iniciando' && 'Solicitando acesso à câmera…'}
                {estadoCamera === 'indisponivel' && (
                  <>
                    Câmera indisponível neste dispositivo ou permissão negada.
                    <br />
                    Use a chave de acesso ou o arquivo XML.
                  </>
                )}
                {estadoCamera === 'inativa' && 'Preparando o leitor…'}
              </div>
            )}
          </>
        )}

        {modo === 'chave' && (
          <form onSubmit={enviarChave} className="campo">
            <label htmlFor="chave">Chave de acesso ou conteúdo do QR Code</label>
            <input
              id="chave"
              className="mono"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              placeholder="25260307526557000100650010000010011101371370"
            />
            <span className="dica">
              Aceita os 44 dígitos, com ou sem separadores, ou a URL completa de consulta da SEFAZ.
            </span>
            <div style={{ marginTop: 10 }}>
              <button type="submit" className="botao-primario" disabled={carregando || !chave}>
                {carregando ? 'Consultando…' : 'Consultar nota'}
              </button>
            </div>
          </form>
        )}

        {modo === 'xml' && (
          <div className="campo">
            <label htmlFor="xml">XML de autorização da NF-e/NFC-e</label>
            <input id="xml" type="file" accept=".xml,text/xml,application/xml" onChange={enviarXml} />
            <span className="dica">
              O arquivo é processado localmente pela API; os dados vêm do próprio documento fiscal.
            </span>
          </div>
        )}

        {erro?.codigo === 'CONSULTA_ASSISTIDA' ? (
          <ConsultaAssistida erro={erro} aoEscolherXml={enviarXml} />
        ) : (
          erro && (
            <div className="aviso erro" style={{ marginTop: 14 }}>
              {erro.mensagem}
            </div>
          )
        )}
      </div>

      {resultado && <ResultadoLeitura resultado={resultado} />}
    </>
  );
}

// O portal da SEFAZ exige verificação humana para exibir a nota: o consumidor
// consulta no site oficial e traz o XML autorizado para a importação.
function ConsultaAssistida({ erro, aoEscolherXml }) {
  return (
    <div className="aviso informacao" style={{ marginTop: 14 }}>
      <p style={{ margin: '0 0 8px' }}>{erro.mensagem}</p>
      <ol style={{ margin: '0 0 10px', paddingLeft: 20 }}>
        {erro.urlConsulta && (
          <li>
            Abra a{' '}
            <a href={erro.urlConsulta} target="_blank" rel="noopener noreferrer">
              consulta oficial da SEFAZ
            </a>{' '}
            e conclua a verificação.
          </li>
        )}
        <li>Obtenha o XML autorizado da nota — no portal, quando disponível, ou com o estabelecimento emissor.</li>
        <li>Importe o arquivo abaixo.</li>
      </ol>
      <input
        type="file"
        accept=".xml,text/xml,application/xml"
        aria-label="XML de autorização da nota"
        onChange={aoEscolherXml}
      />
    </div>
  );
}

function ResultadoLeitura({ resultado }) {
  const { nota, chaveInterpretada } = resultado;
  const comparados = nota.itens.filter((i) => i.situacao !== 'novo');
  const economia = nota.itens.reduce((s, i) => s + (i.economiaPossivel ?? 0), 0);

  return (
    <>
      <div className="aviso sucesso" style={{ margin: '16px 0' }}>
        Nota importada com sucesso — {nota.itens.length} itens, {comparados.length} já presentes no
        seu histórico.
      </div>

      {chaveInterpretada && (
        <div className="cartao">
          <h2>Chave de acesso interpretada</h2>
          <p className="legenda">
            Campos extraídos conforme o layout do Manual de Orientação do Contribuinte.
          </p>
          <div className="painel-chave">
            <div>
              <span className="rotulo">UF de emissão</span>
              <span className="conteudo">{chaveInterpretada.uf}</span>
            </div>
            <div>
              <span className="rotulo">Modelo</span>
              <span className="conteudo">
                {chaveInterpretada.descricaoModelo} ({chaveInterpretada.modelo})
              </span>
            </div>
            <div>
              <span className="rotulo">Série / Número</span>
              <span className="conteudo">
                {chaveInterpretada.serie} / {chaveInterpretada.numero}
              </span>
            </div>
            <div>
              <span className="rotulo">Competência</span>
              <span className="conteudo">{chaveInterpretada.anoMesEmissao}</span>
            </div>
          </div>
        </div>
      )}

      <div className="cartao">
        <div className="cabecalho-nota">
          <div>
            <h2>{nota.nomeFantasia ?? nota.razaoSocial}</h2>
            <div className="fraco" style={{ fontSize: '0.85rem' }}>
              {nota.razaoSocial} · {nota.municipio}/{nota.uf}
            </div>
            <div className="mono fraco" style={{ fontSize: '0.78rem', marginTop: 4 }}>
              {mascararChave(nota.chave)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="fraco" style={{ fontSize: '0.8rem' }}>
              {dataBr(nota.dataEmissao)}
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{moeda(nota.valorTotal)}</div>
            <div className="fraco" style={{ fontSize: '0.78rem' }}>
              tributos: {moeda(nota.valorTributos)}
            </div>
          </div>
        </div>

        <div className="rolagem-horizontal">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Qtd.</th>
                <th className="num">Preço pago</th>
                <th className="num">Preço anterior</th>
                <th className="num">Menor já pago</th>
                <th>Comparação</th>
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
                  <td className="num">
                    <strong>{moeda(item.valorUnitario)}</strong>
                  </td>
                  <td className="num fraco">
                    {item.precoAnterior ? moeda(item.precoAnterior) : '—'}
                  </td>
                  <td className="num fraco">{item.menorPreco ? moeda(item.menorPreco) : '—'}</td>
                  <td>
                    <EtiquetaSituacao situacao={item.situacao} variacao={item.variacaoPercentual} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {economia > 0 && (
          <div className="aviso alerta" style={{ marginTop: 14, background: '#fdf1d6', borderColor: '#f0dcae', color: '#9a6700' }}>
            Comprando cada item pelo menor preço já registrado no seu histórico, esta compra sairia{' '}
            <strong>{moeda(economia)}</strong> mais barata.
          </div>
        )}
      </div>
    </>
  );
}

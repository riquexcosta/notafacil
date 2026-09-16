import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dataBr, mascararChave, moeda } from '../servicos/api.js';
import { Cabecalho, EtiquetaSituacao } from '../componentes/comuns.jsx';

const MODOS = [
  { id: 'camera', titulo: 'Câmera', descricao: 'Aponte para o QR Code da NFC-e' },
  { id: 'chave', titulo: 'Chave de acesso', descricao: 'Digite os 44 dígitos da nota' },
  { id: 'xml', titulo: 'Arquivo XML', descricao: 'Importe o XML autorizado' }
];

const ID_CAMERA = 'leitor-qrcode';
const ID_FOTO = 'leitor-qrcode-foto';

// No celular com câmera, a tela já abre na leitura pela câmera.
const modoInicial = () =>
  navigator.mediaDevices?.getUserMedia && window.matchMedia('(max-width: 860px)').matches ? 'camera' : 'chave';

async function criarLeitor(elementoId) {
  const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
  return new Html5Qrcode(elementoId, {
    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    // Usa o BarcodeDetector nativo (Android/Chrome) quando existe: lê bem os
    // QR Codes densos da NFC-e, que o decodificador em JavaScript costuma perder.
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    verbose: false
  });
}

/**
 * Lê o QR Code de uma foto. Tenta o detector nativo na resolução original e,
 * sem ele, o html5-qrcode sobre uma área de 1600 px fora da tela: a biblioteca
 * redimensiona a imagem para o tamanho do elemento, e um elemento pequeno
 * tornaria o código ilegível.
 */
async function lerQrDaFoto(arquivo) {
  if ('BarcodeDetector' in window) {
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const imagem = await createImageBitmap(arquivo);
      const [codigo] = await detector.detect(imagem);
      imagem.close?.();
      if (codigo?.rawValue) return codigo.rawValue;
    } catch {
      // segue para o decodificador em JavaScript
    }
  }
  const leitor = await criarLeitor(ID_FOTO);
  try {
    return (await leitor.scanFileV2(arquivo, false)).decodedText;
  } finally {
    leitor.clear();
  }
}

export default function Leitura() {
  const [modo, setModo] = useState(modoInicial);
  const [chave, setChave] = useState('');
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [cameraLigada, setCameraLigada] = useState(true);
  // Trocar a chave remonta o leitor, que pede a câmera de novo.
  const [tentativa, setTentativa] = useState(0);

  function lerConteudoQr(texto) {
    setCameraLigada(false);
    processar(() => api.lerQrCode(texto));
  }

  function ligarCamera() {
    setErro(null);
    setResultado(null);
    setTentativa((t) => t + 1);
    setCameraLigada(true);
  }

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
                if (m.id === 'camera') setCameraLigada(true);
              }}
            >
              <strong>{m.titulo}</strong>
              <span>{m.descricao}</span>
            </button>
          ))}
        </div>

        {modo === 'camera' && (
          <>
            {cameraLigada ? (
              <LeitorCamera key={tentativa} aoLer={lerConteudoQr} aoParar={() => setCameraLigada(false)} />
            ) : carregando ? (
              <div className="aviso informacao">QR Code lido. Consultando a nota…</div>
            ) : (
              <div className="moldura-camera">
                <p>{resultado ? 'Nota importada.' : 'Câmera desligada.'}</p>
                <button type="button" className="botao-primario" onClick={ligarCamera}>
                  {resultado ? 'Ler outra nota' : 'Ligar câmera'}
                </button>
              </div>
            )}
            <LeitorFoto
              desativado={carregando}
              aoLer={lerConteudoQr}
              aoFalhar={(mensagem) => setErro({ mensagem })}
            />
          </>
        )}
        <div id={ID_FOTO} className="area-foto-oculta" aria-hidden="true" />

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

/**
 * Leitura contínua pela câmera traseira. Mostra orientação enquanto procura,
 * sugere a foto se demorar e aciona `aoLer` uma única vez por leitura, para
 * não disparar duas consultas pagas com o mesmo cupom.
 */
function LeitorCamera({ aoLer, aoParar }) {
  const [estado, setEstado] = useState('iniciando');
  const [demorando, setDemorando] = useState(false);
  const [lanterna, setLanterna] = useState(null); // null: sem suporte
  const aoLerRef = useRef(aoLer);
  const lanternaRef = useRef(null);
  const lidoRef = useRef(false);

  useEffect(() => {
    aoLerRef.current = aoLer;
  });

  useEffect(() => {
    let leitor;
    let cancelado = false;
    let temporizador;

    const aoDecodificar = (texto) => {
      if (lidoRef.current) return;
      lidoRef.current = true;
      navigator.vibrate?.(120);
      aoLerRef.current(texto);
    };
    const qrbox = (largura, altura) => {
      const lado = Math.floor(Math.min(largura, altura) * 0.8);
      return { width: lado, height: lado };
    };

    (async () => {
      try {
        leitor = await criarLeitor(ID_CAMERA);
        if (cancelado) return;
        try {
          await leitor.start(
            { facingMode: 'environment' },
            {
              fps: 15,
              qrbox,
              videoConstraints: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                advanced: [{ focusMode: 'continuous' }]
              }
            },
            aoDecodificar,
            () => {}
          );
        } catch {
          // Câmeras que recusam a resolução pedida: tenta a configuração padrão.
          await leitor.start({ facingMode: 'environment' }, { fps: 15, qrbox }, aoDecodificar, () => {});
        }
        if (cancelado) {
          leitor.stop().catch(() => {});
          return;
        }
        setEstado('procurando');
        try {
          const tocha = leitor.getRunningTrackCameraCapabilities().torchFeature();
          if (tocha.isSupported()) {
            lanternaRef.current = tocha;
            setLanterna(false);
          }
        } catch {
          // navegador sem controle de lanterna
        }
        temporizador = setTimeout(() => setDemorando(true), 12000);
      } catch {
        if (!cancelado) setEstado('indisponivel');
      }
    })();

    return () => {
      cancelado = true;
      clearTimeout(temporizador);
      if (leitor?.isScanning) leitor.stop().catch(() => {});
    };
  }, []);

  async function alternarLanterna() {
    try {
      await lanternaRef.current.apply(!lanterna);
      setLanterna(!lanterna);
    } catch {
      setLanterna(null);
    }
  }

  return (
    <div className="leitor-camera">
      <div id={ID_CAMERA} />
      {estado === 'iniciando' && <div className="moldura-camera">Solicitando acesso à câmera…</div>}
      {estado === 'indisponivel' && (
        <div className="moldura-camera">
          Câmera indisponível neste dispositivo ou permissão negada.
          <br />
          Use a foto do QR Code, a chave de acesso ou o arquivo XML.
        </div>
      )}
      {estado === 'procurando' && (
        <p className="dica-camera">
          Aponte para o QR Code no rodapé do cupom, a uns 15 cm, com boa luz. A leitura é automática.
        </p>
      )}
      {estado === 'procurando' && demorando && (
        <div className="aviso informacao">
          Não está lendo? Toque em <strong>Fotografar o QR Code</strong> ou digite a chave de acesso.
        </div>
      )}
      {estado !== 'indisponivel' && (
        <div className="barra-acoes">
          {lanterna !== null && (
            <button type="button" className="botao-secundario" onClick={alternarLanterna}>
              {lanterna ? 'Desligar lanterna' : 'Ligar lanterna'}
            </button>
          )}
          <button type="button" className="botao-secundario" onClick={aoParar}>
            Parar câmera
          </button>
        </div>
      )}
    </div>
  );
}

/** Alternativa à câmera ao vivo: a câmera nativa tem foco e resolução melhores. */
function LeitorFoto({ aoLer, aoFalhar, desativado }) {
  const [lendo, setLendo] = useState(false);

  async function escolher(evento) {
    const arquivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!arquivo) return;
    setLendo(true);
    try {
      aoLer(await lerQrDaFoto(arquivo));
    } catch {
      aoFalhar(
        'Não encontramos o QR Code na foto. Fotografe mais de perto, com o código nítido e ocupando boa parte da imagem, ou digite a chave de acesso.'
      );
    } finally {
      setLendo(false);
    }
  }

  const bloqueado = desativado || lendo;
  return (
    <label className={`botao botao-secundario botao-foto ${bloqueado ? 'desativado' : ''}`}>
      {lendo ? 'Lendo a foto…' : 'Fotografar o QR Code'}
      <input type="file" accept="image/*" capture="environment" onChange={escolher} disabled={bloqueado} hidden />
    </label>
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

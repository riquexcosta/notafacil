export function Indicador({ rotulo, valor, apoio }) {
  return (
    <div className="cartao indicador">
      <span className="rotulo">{rotulo}</span>
      <span className="valor">{valor}</span>
      {apoio && <span className="apoio">{apoio}</span>}
    </div>
  );
}

const TEXTO_SITUACAO = {
  aumento: 'Aumentou',
  reducao: 'Baixou',
  estavel: 'Estável',
  novo: 'Primeira compra'
};

export function EtiquetaSituacao({ situacao, variacao }) {
  const sinal = variacao > 0 ? '+' : '';
  return (
    <span className={`etiqueta ${situacao}`}>
      {TEXTO_SITUACAO[situacao] ?? situacao}
      {situacao !== 'novo' && variacao !== undefined && ` ${sinal}${variacao}%`}
    </span>
  );
}

export function Cabecalho({ titulo, descricao, acoes }) {
  return (
    <header className="cabecalho-pagina">
      <div className="barra-acoes">
        <div>
          <h1>{titulo}</h1>
          {descricao && <p>{descricao}</p>}
        </div>
        <div className="espaco" />
        {acoes}
      </div>
    </header>
  );
}

export function Vazio({ children }) {
  return <div className="vazio">{children}</div>;
}

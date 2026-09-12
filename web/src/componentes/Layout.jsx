import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { encerrarSessao, lerSessao } from '../servicos/api.js';

const ITENS = [
  { rota: '/painel', rotulo: 'Painel', icone: '◧' },
];

export default function Layout() {
  const navegar = useNavigate();
  const sessao = lerSessao();

  function sair() {
    encerrarSessao();
    navegar('/entrar');
  }

  return (
    <div className="app">
      <aside className="barra-lateral">
        <div className="marca">
          <span className="marca-icone">▤</span>
          NotaFácil
        </div>

        <nav className="menu">
          {ITENS.map((item) => (
            <NavLink
              key={item.rota}
              to={item.rota}
              className={({ isActive }) => (isActive ? 'ativo' : undefined)}
            >
              <span aria-hidden="true">{item.icone}</span>
              {item.rotulo}
            </NavLink>
          ))}
        </nav>

        <div className="rodape-lateral">
          <strong>{sessao?.usuario?.nome ?? 'Visitante'}</strong>
          <span>{sessao?.usuario?.email}</span>
          <button type="button" className="botao-sair" onClick={sair}>
            Sair da conta
          </button>
        </div>
      </aside>

      <main className="conteudo">
        <Outlet />
      </main>
    </div>
  );
}

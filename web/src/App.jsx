import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './componentes/Layout.jsx';
import Comparativo from './paginas/Comparativo.jsx';
import Conta from './paginas/Conta.jsx';
import DetalheNota from './paginas/DetalheNota.jsx';
import DetalheProduto from './paginas/DetalheProduto.jsx';
import Empresas from './paginas/Empresas.jsx';
import Entrar from './paginas/Entrar.jsx';
import Leitura from './paginas/Leitura.jsx';
import Notas from './paginas/Notas.jsx';
import Painel from './paginas/Painel.jsx';
import Privacidade from './paginas/Privacidade.jsx';
import Produtos from './paginas/Produtos.jsx';
import { lerSessao } from './servicos/api.js';

/**
 * Rotas autenticadas. Enquanto a conta não aceitar a versão vigente da política
 * de privacidade, o acesso é redirecionado para a leitura e o aceite.
 */
function Protegida({ children }) {
  const local = useLocation();
  const sessao = lerSessao();
  if (!sessao?.token) return <Navigate to="/entrar" replace />;
  if (sessao.usuario?.politicaPendente) {
    return <Navigate to="/privacidade" replace state={{ voltarPara: local.pathname }} />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Entrar />} />
      <Route path="/cadastro" element={<Entrar />} />
      <Route path="/privacidade" element={<Privacidade />} />
      <Route
        element={
          <Protegida>
            <Layout />
          </Protegida>
        }
      >
        <Route path="/painel" element={<Painel />} />
        <Route path="/leitura" element={<Leitura />} />
        <Route path="/notas" element={<Notas />} />
        <Route path="/notas/:id" element={<DetalheNota />} />
        <Route path="/produtos" element={<Produtos />} />
        <Route path="/produtos/:id" element={<DetalheProduto />} />
        <Route path="/empresas" element={<Empresas />} />
        <Route path="/comparativo" element={<Comparativo />} />
        <Route path="/conta" element={<Conta />} />
      </Route>
      <Route path="*" element={<Navigate to="/painel" replace />} />
    </Routes>
  );
}

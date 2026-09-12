import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './componentes/Layout.jsx';
import DetalheNota from './paginas/DetalheNota.jsx';
import DetalheProduto from './paginas/DetalheProduto.jsx';
import Empresas from './paginas/Empresas.jsx';
import Entrar from './paginas/Entrar.jsx';
import Leitura from './paginas/Leitura.jsx';
import Notas from './paginas/Notas.jsx';
import Painel from './paginas/Painel.jsx';
import Produtos from './paginas/Produtos.jsx';
import { lerSessao } from './servicos/api.js';

function Protegida({ children }) {
  return lerSessao()?.token ? children : <Navigate to="/entrar" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Entrar />} />
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
      </Route>
      <Route path="*" element={<Navigate to="/painel" replace />} />
    </Routes>
  );
}

import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './componentes/Layout.jsx';
import Entrar from './paginas/Entrar.jsx';
import Painel from './paginas/Painel.jsx';
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
      </Route>
      <Route path="*" element={<Navigate to="/painel" replace />} />
    </Routes>
  );
}

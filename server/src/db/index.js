import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', '..', 'data', 'notafacil.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

const colunas = (tabela) => db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);

function adicionarColuna(tabela, coluna, definicao) {
  if (!colunas(tabela).includes(coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}

/**
 * Bases criadas antes da separação por usuário guardavam um único preço por
 * estabelecimento e produto, compartilhado entre todos. A tabela é recriada
 * por usuário e repovoada a partir das próprias notas de cada um.
 */
const separarPrecosPorUsuario = db.transaction(() => {
  db.exec('ALTER TABLE preco_empresa_produto RENAME TO preco_empresa_produto_compartilhada');
  db.exec(SCHEMA);
  db.exec(`
    INSERT INTO preco_empresa_produto (usuario_id, empresa_id, produto_id, valor_unitario, data_referencia)
    SELECT usuario_id, empresa_id, produto_id, valor_unitario, referencia
      FROM (SELECT n.usuario_id, n.empresa_id, i.produto_id, i.valor_unitario,
                   n.data_emissao || COALESCE('T' || n.hora_emissao, '') AS referencia,
                   ROW_NUMBER() OVER (
                     PARTITION BY n.usuario_id, n.empresa_id, i.produto_id
                     ORDER BY n.data_emissao DESC, COALESCE(n.hora_emissao, '') DESC, n.id DESC, i.id DESC
                   ) AS ordem
              FROM item_nota i
              JOIN nota_fiscal n ON n.id = i.nota_id)
     WHERE ordem = 1;
    DROP TABLE preco_empresa_produto_compartilhada;
  `);
});

export function migrate() {
  db.exec(SCHEMA);
  adicionarColuna('nota_fiscal', 'hora_emissao', 'TEXT');
  if (!colunas('preco_empresa_produto').includes('usuario_id')) separarPrecosPorUsuario();
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_preco_usuario_produto ON preco_empresa_produto(usuario_id, produto_id)'
  );
}

migrate();

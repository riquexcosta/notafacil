import Database from 'better-sqlite3';
import { normalizarGtin } from '../domain/gtin.js';
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

/**
 * GTINs gravados antes da validação estrita: códigos internos completados com
 * zeros deixam de ser GTIN, e os demais perdem os zeros à esquerda.
 */
const normalizarGtinsGravados = db.transaction(() => {
  const produtos = db.prepare('SELECT id, ean FROM produto WHERE ean IS NOT NULL').all();
  for (const { id, ean } of produtos) {
    const normalizado = normalizarGtin(ean);
    if (normalizado === ean) continue;
    const ocupado = normalizado && db.prepare('SELECT id FROM produto WHERE ean = ? AND id <> ?').get(normalizado, id);
    if (!ocupado) db.prepare('UPDATE produto SET ean = ? WHERE id = ?').run(normalizado, id);
  }
});

export function migrate() {
  db.exec(SCHEMA);
  adicionarColuna('usuario', 'politica_versao', 'TEXT');
  adicionarColuna('usuario', 'politica_aceita_em', 'TEXT');
  adicionarColuna('nota_fiscal', 'hora_emissao', 'TEXT');
  adicionarColuna('item_nota', 'produto_resolvido_id', 'INTEGER REFERENCES produto(id)');
  db.exec('UPDATE item_nota SET produto_resolvido_id = produto_id WHERE produto_resolvido_id IS NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_item_produto_resolvido ON item_nota(produto_resolvido_id)');
  normalizarGtinsGravados();
  if (!colunas('preco_empresa_produto').includes('usuario_id')) separarPrecosPorUsuario();
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_preco_usuario_produto ON preco_empresa_produto(usuario_id, produto_id)'
  );
}

migrate();

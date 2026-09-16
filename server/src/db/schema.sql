-- NotaFácil — esquema relacional (SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuario (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nome                TEXT    NOT NULL,
  email               TEXT    NOT NULL UNIQUE,
  senha_hash          TEXT    NOT NULL,
  politica_versao     TEXT,              -- versão da política de privacidade aceita
  politica_aceita_em  TEXT,              -- data e hora (ISO 8601) do aceite
  criado_em           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS empresa (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj           TEXT    NOT NULL UNIQUE,
  razao_social   TEXT    NOT NULL,
  nome_fantasia  TEXT,
  logradouro     TEXT,
  municipio      TEXT,
  uf             TEXT,
  criado_em      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produto (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ean         TEXT UNIQUE,          -- GTIN/código de barras (chave preferencial)
  ncm         TEXT,                 -- Nomenclatura Comum do Mercosul
  descricao   TEXT    NOT NULL,
  unidade     TEXT,
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_produto_ncm ON produto(ncm);

CREATE TABLE IF NOT EXISTS nota_fiscal (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id     INTEGER NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  empresa_id     INTEGER NOT NULL REFERENCES empresa(id),
  chave_acesso   TEXT    NOT NULL,
  numero         TEXT,
  serie          TEXT,
  modelo         TEXT,
  data_emissao   TEXT    NOT NULL,
  hora_emissao   TEXT,             -- HH:MM:SS, quando a fonte informa
  valor_total    REAL    NOT NULL DEFAULT 0,
  valor_tributos REAL    NOT NULL DEFAULT 0,
  origem         TEXT    NOT NULL DEFAULT 'qrcode', -- qrcode | xml | infosimples | demo
  criado_em      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (usuario_id, chave_acesso)
);

CREATE INDEX IF NOT EXISTS idx_nota_usuario_data ON nota_fiscal(usuario_id, data_emissao);

CREATE TABLE IF NOT EXISTS item_nota (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_id        INTEGER NOT NULL REFERENCES nota_fiscal(id) ON DELETE CASCADE,
  produto_id     INTEGER NOT NULL REFERENCES produto(id),
  quantidade     REAL    NOT NULL DEFAULT 1,
  valor_unitario REAL    NOT NULL,
  valor_total    REAL    NOT NULL,
  valor_tributos REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_item_produto ON item_nota(produto_id);
CREATE INDEX IF NOT EXISTS idx_item_nota ON item_nota(nota_id);

-- Preço mais recente pago por cada usuário em cada estabelecimento, por produto.
-- É por usuário: um usuário nunca vê os preços, lojas ou datas das compras de outro.
-- data_referencia guarda a data e, quando conhecida, a hora (AAAA-MM-DDTHH:MM:SS).
CREATE TABLE IF NOT EXISTS preco_empresa_produto (
  usuario_id      INTEGER NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  empresa_id      INTEGER NOT NULL REFERENCES empresa(id),
  produto_id      INTEGER NOT NULL REFERENCES produto(id),
  valor_unitario  REAL    NOT NULL,
  data_referencia TEXT    NOT NULL,
  PRIMARY KEY (usuario_id, empresa_id, produto_id)
);

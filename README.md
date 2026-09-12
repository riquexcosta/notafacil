# NotaFácil

Aplicação web progressiva que transforma as notas fiscais de consumo em um histórico
pessoal de preços. A partir do QR Code do cupom, da chave de acesso ou do XML
autorizado, o sistema registra os itens comprados e compara cada um deles com as
compras anteriores do mesmo usuário.

Produto de software desenvolvido como Trabalho de Conclusão de Curso do Bacharelado em
Engenharia de Software da Unicesumar. Autor: **Henrique Gonsalves Costa**.

---

## Sumário

- [O que a aplicação faz](#o-que-a-aplicação-faz)
- [Como a nota é obtida](#como-a-nota-é-obtida)
- [Requisitos](#requisitos)
- [Como rodar localmente](#como-rodar-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Scripts disponíveis](#scripts-disponíveis)
- [API REST](#api-rest)
- [Arquitetura](#arquitetura)
- [Modelo de dados](#modelo-de-dados)
- [Identidade do produto e comparação de preços](#identidade-do-produto-e-comparação-de-preços)
- [Testes](#testes)
- [Capturas e diagramas](#capturas-e-diagramas)
- [Problemas comuns](#problemas-comuns)
- [Limitações conhecidas](#limitações-conhecidas)
- [Licença](#licença)

---

## O que a aplicação faz

O sistema é de uso individual: cada usuário enxerga apenas as notas que registrou. As
funcionalidades estão organizadas em cinco telas.

| Tela | Rota | O que oferece |
| --- | --- | --- |
| **Entrar** | `/entrar` | Criação de conta e login com e-mail e senha. A sessão é mantida por token assinado guardado no navegador. |
| **Painel** | `/painel` | Indicadores de notas, gasto total, tributos e ticket médio; gráfico de gasto por mês; produtos de maior variação de preço; produtos comprados com mais frequência. |
| **Ler nota** | `/leitura` | Três formas de registrar uma nota: leitura do QR Code pela câmera, digitação da chave de acesso (ou da URL de consulta) e importação do arquivo XML. Mostra os campos interpretados da chave, a comparação item a item e a economia possível. |
| **Notas** | `/notas` e `/notas/:id` | Histórico com filtros por estabelecimento, chave e período. O detalhe traz emitente, itens, tributos, origem do registro e a comparação de cada item. |
| **Produtos e Empresas** | `/produtos`, `/produtos/:id` e `/empresas` | Busca por descrição, código de barras ou classificação fiscal; produtos recorrentes; série histórica do preço unitário; preço mais recente por estabelecimento e produtos comprados em cada loja. |

Ao registrar uma nota, cada item recebe uma situação:

- **novo**: primeira compra do produto no histórico;
- **aumento**: preço mais de 1% acima da compra anterior;
- **redução**: preço mais de 1% abaixo da compra anterior;
- **estável**: variação dentro da faixa de 1%, que evita tratar arredondamento como
  mudança de preço.

O sistema também calcula o menor preço já pago pelo produto e quanto a compra teria
custado a menos com esse valor.

## Como a nota é obtida

A obtenção do documento fiscal fica atrás de uma porta (`consultar(chave)`) com cinco
implementações intercambiáveis. Uma cadeia de responsabilidade percorre os provedores e
usa o primeiro que responder.

| Provedor | Quando entra | O que faz |
| --- | --- | --- |
| `ProvedorXmlAutorizado` | Importação de arquivo XML | Lê o XML de autorização da NF-e/NFC-e. É o caminho de maior fidelidade, porque os dados vêm do próprio documento. |
| `ProvedorSefaz` | Sempre tentado primeiro | Ponto de extensão para o serviço de distribuição da SEFAZ. Não implementado, porque exige certificado digital A1/A3 do destinatário. Sinaliza indisponibilidade e a cadeia segue. |
| `ProvedorInfosimples` | Com `INFOSIMPLES_TOKEN` no `.env` | Consulta a NFC-e pela API da Infosimples, que acessa o portal da SEFAZ-PB e devolve a nota em JSON. Serviço pago por requisição. |
| `ProvedorConsultaAssistida` | Sem token, ou quando a Infosimples falha | Devolve o endereço da consulta oficial da SEFAZ para o usuário resolver o captcha, e oferece a importação do XML na mesma tela. |
| `ProvedorCatalogoLocal` | Só com `npm run start:demo` | Monta a nota com itens sintéticos de um catálogo local, a partir dos campos reais da chave. Marca o registro com `origem: 'demo'`. |

Por que existe o intermediário: o portal público da NFC-e da Paraíba exige verificação
humana por reCAPTCHA mesmo quando aberto pela URL do QR Code, então a leitura não pode
ser automatizada pelo servidor. O serviço de distribuição nacional, por sua vez, exige
certificado digital do destinatário.

Dois cuidados relacionados ao custo e à segurança:

- A duplicidade é verificada **antes** da consulta paga, então reler um cupom já
  registrado não gera cobrança.
- O endereço lido do QR Code só é repassado ao navegador se pertencer a um domínio
  `.gov.br`.

## Requisitos

- **Node.js 22.9 ou superior** (o `--env-file-if-exists` usado nos scripts exige essa versão).
- npm (vem com o Node).
- Nenhum banco de dados servidor: a persistência é um arquivo SQLite local.
- Opcional: uma conta na [Infosimples](https://infosimples.com/consultas/sefaz-pb-nfce/)
  para a consulta automática por chave. Sem ela, a aplicação funciona com a consulta
  assistida e a importação do XML.

## Como rodar localmente

### 1. Instalar as dependências

São dois pacotes independentes:

```bash
npm install --prefix server
```

```bash
npm install --prefix web
```

### 2. Criar a base de demonstração (opcional, recomendado)

```bash
npm --prefix server run seed
```

O comando recria o arquivo `server/data/notafacil.db` com seis meses de compras
simuladas: 41 notas, 207 itens, 19 produtos e 4 estabelecimentos, além da conta de
demonstração `demo@notafacil.app` / `demo1234`.

> O seed apaga e recria a base. Rode de novo sempre que quiser voltar ao estado inicial.

### 3. Configurar o `.env` (opcional)

```bash
cp server/.env.example server/.env
```

Preencha `INFOSIMPLES_TOKEN` se quiser a consulta automática por chave. Sem o arquivo, a
aplicação sobe normalmente e usa a consulta assistida.

### 4. Subir a API (porta 3333)

```bash
npm --prefix server start
```

A mensagem de inicialização informa o modo em uso, por exemplo
`NotaFácil API ouvindo em http://localhost:3333 (consulta de NFC-e via Infosimples ativa)`.

Para desenvolvimento com recarga automática, use `npm --prefix server run dev`.

### 5. Subir o cliente (porta 5173), em outro terminal

```bash
npm --prefix web run dev
```

### 6. Acessar

Abra **http://localhost:5173** e entre com a conta de demonstração:

- **E-mail:** `demo@notafacil.app`
- **Senha:** `demo1234`

O cliente repassa as chamadas de `/api` para a porta 3333, então não é preciso acessar a
API diretamente.

### Modo demonstração

Para apresentar a leitura por chave sem depender de serviço externo nem gerar custo:

```bash
npm --prefix server run start:demo
```

Nesse modo, qualquer chave válida gera uma nota com itens sintéticos do catálogo local,
marcada como `origem: 'demo'`. Não há chamada paga.

## Variáveis de ambiente

Todas são opcionais e ficam em `server/.env` (veja `server/.env.example`).

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `INFOSIMPLES_TOKEN` | vazio | Token da API Infosimples. Com ele, a leitura por chave ou QR consulta o portal da SEFAZ-PB. Sem ele, a aplicação usa a consulta assistida. |
| `NFE_MODO_DEMO` | vazio | `1` liga o modo demonstração (mesmo efeito de `npm run start:demo`). |
| `PORT` | `3333` | Porta da API. |
| `DB_PATH` | `server/data/notafacil.db` | Caminho do arquivo SQLite. Os testes usam um diretório temporário. |
| `JWT_SECRET` | `notafacil-desenvolvimento` | Segredo que assina o token de sessão. **Troque em produção.** |
| `VITE_API_URL` | `http://localhost:3333` | Destino do proxy `/api` do cliente em desenvolvimento. |

O `.env` não vai para o Git.

## Scripts disponíveis

**`server/`**

| Script | O que faz |
| --- | --- |
| `npm start` | Sobe a API lendo o `.env`. |
| `npm run dev` | Mesmo que o anterior, com recarga automática. |
| `npm run start:demo` | Sobe a API no modo demonstração. |
| `npm run seed` | Recria a base de demonstração. |
| `npm test` | Roda os 40 testes automatizados. |
| `npm run sonda:infosimples -- <chave>` | Faz **uma** consulta real à Infosimples e grava a resposta em `server/data/infosimples-amostra.json`. Consome uma requisição da conta. |

**`web/`**

| Script | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento na porta 5173. |
| `npm run build` | Gera o cliente compilado em `web/dist`. |
| `npm run preview` | Serve o resultado do build. |
| `npm run lint` | Roda o oxlint. |

**Raiz (`app/`)**, usados para o material do TCC:

| Script | O que faz |
| --- | --- |
| `npm run capturas` | Gera as telas completas em `capturas/telas/`. |
| `npm run recortes` | Gera os recortes usados no artigo. |
| `npm run diagramas` | Gera os diagramas UML em `capturas/diagramas/`. |

## API REST

Todas as rotas autenticadas esperam o cabeçalho `Authorization: Bearer <token>`, obtido
no login. O corpo é JSON, exceto a importação de XML, que aceita `application/xml`.

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| `GET` | `/api/saude` | pública | Verificação de disponibilidade. |
| `GET` | `/api/docs` | pública | Documentação navegável (Swagger UI). |
| `GET` | `/api/openapi.json` | pública | Especificação OpenAPI 3.0 da API. |
| `POST` | `/api/auth/cadastro` | pública | Cria conta com nome, e-mail e senha. |
| `POST` | `/api/auth/login` | pública | Devolve o token de sessão. |
| `POST` | `/api/notas/qrcode` | autenticada | Registra uma nota a partir do conteúdo do QR Code ou da chave de acesso. |
| `POST` | `/api/notas/xml` | autenticada | Registra uma nota a partir do XML de autorização. |
| `GET` | `/api/notas` | autenticada | Lista as notas, com filtros por chave, período, empresa e busca. |
| `GET` | `/api/notas/:id` | autenticada | Detalhe da nota com itens e comparação. |
| `GET` | `/api/notas/:id/comparacao` | autenticada | Comparação item a item com o histórico. |
| `GET` | `/api/produtos` | autenticada | Busca produtos por descrição, código de barras ou classificação fiscal. |
| `GET` | `/api/produtos/recorrentes` | autenticada | Produtos comprados em duas ou mais notas. |
| `GET` | `/api/produtos/:id/historico` | autenticada | Série histórica de preço, ofertas por loja e estatísticas. |
| `GET` | `/api/empresas` | autenticada | Estabelecimentos com total gasto e última compra. |
| `GET` | `/api/empresas/:id/produtos` | autenticada | Produtos comprados em um estabelecimento. |
| `GET` | `/api/relatorios/resumo` | autenticada | Indicadores do painel. |

Com a API no ar, a documentação navegável fica em **http://localhost:3333/api/docs**, e a
especificação em `http://localhost:3333/api/openapi.json`. A interface carrega o Swagger UI
por CDN, então precisa de internet; o arquivo da especificação funciona offline e está em
`server/src/docs/openapi.json`.

Respostas de erro trazem `{ "erro": "mensagem" }`. Quando a consulta automática não está
disponível, a resposta é `422` com `codigo: "CONSULTA_ASSISTIDA"` e o campo `urlConsulta`,
usado pela tela de leitura para encaminhar o usuário ao portal oficial.

## Arquitetura

```
web/      cliente PWA em React 19 e Vite, com html5-qrcode, Recharts e React Router
server/   API REST em Node.js 22 e Express, SQLite (better-sqlite3), JWT e Zod
capturas/ roteiros Playwright que geram as telas e os diagramas do artigo
```

O servidor é dividido em camadas:

```
server/src/index.js              rotas, validação de entrada e tratamento de erro
server/src/auth.js               cadastro, login e middleware de autenticação
server/src/services/             casos de uso: importação, comparação e buscas
server/src/domain/chaveAcesso.js validação e decomposição da chave (módulo 11)
server/src/domain/nfe/           porta de consulta e provedores
server/src/db/                   conexão, esquema e migração
```

As regras de negócio não conhecem a fonte dos dados. Trocar de provedor não altera os
serviços de importação e de comparação.

## Modelo de dados

Seis tabelas em SQLite, criadas automaticamente na primeira execução:

| Tabela | Papel |
| --- | --- |
| `usuario` | Conta de acesso, com senha guardada como hash bcrypt. |
| `empresa` | Estabelecimento emitente, único por CNPJ. |
| `produto` | Produto único no sistema, identificado por código de barras ou por classificação fiscal e descrição normalizada. |
| `nota_fiscal` | Nota registrada por um usuário, única por par usuário e chave de acesso. |
| `item_nota` | Ocorrência de compra, com quantidade, valor unitário e tributos. |
| `preco_empresa_produto` | Preço mais recente de cada produto em cada estabelecimento. |

A separação entre `produto` e `item_nota` é o que torna a comparação possível. Toda a
gravação de uma nota ocorre em uma única transação.

## Identidade do produto e comparação de preços

Para reconhecer o mesmo produto em notas de emitentes diferentes, o sistema segue esta
ordem:

1. **Código de barras (GTIN/EAN)**, aceito somente se o dígito verificador conferir. O
   portal devolve no mesmo campo códigos internos da loja, como `CFOP5102`, que são
   descartados por essa checagem.
2. **Classificação fiscal (NCM) com a descrição normalizada**, quando não há código de
   barras. A normalização remove acentos, converte para caixa alta e descarta o que não
   é letra ou dígito.
3. **Descrição normalizada sozinha**, quando a fonte não informa a classificação fiscal,
   como acontece no retorno do portal.
4. Sem correspondência, registra-se um produto novo.

## Testes

```bash
npm --prefix server test
```

São 40 casos, executados sobre uma base isolada em diretório temporário:

| Arquivo | Casos | Cobre |
| --- | --- | --- |
| `chaveAcesso.test.js` | 10 | Validação e decomposição da chave, extração a partir do QR Code e formatação do CNPJ. |
| `comparacao.test.js` | 11 | Classificação da variação de preço, economia possível, recusa de duplicidade, indicadores e identidade do produto. |
| `provedores.test.js` | 6 | Consulta assistida, links de portais oficiais e cadeia de provedores. |
| `infosimples.test.js` | 8 | Conversão da resposta real, validação do GTIN, datas, notas canceladas e desvio em caso de falha. |
| `openapi.test.js` | 5 | Estrutura da especificação e sincronia com as rotas: falha se uma rota ficar sem documentação ou se a documentação citar rota inexistente. |

Nenhum teste faz chamada paga: a Infosimples é substituída por um duplo que devolve uma
resposta real registrada, sem os dados da conta.

## Capturas e diagramas

Com a API e o cliente em execução:

```bash
npm install
```

```bash
node capturas/capturar.mjs
```

```bash
node capturas/recortes.mjs
```

```bash
node capturas/gerar-diagramas.mjs
```

Os roteiros usam Playwright. Em máquinas sem o Chromium do Playwright, aponte um
navegador existente pela variável `CHROMIUM_PATH`, por exemplo o Microsoft Edge no
Windows.

Antes de gerar capturas para o artigo, rode o seed para que os números das telas batam
com os relatados no texto.

## Problemas comuns

| Sintoma | Causa provável e solução |
| --- | --- |
| `--env-file-if-exists` não reconhecido | Node anterior à 22.9. Atualize o Node. |
| Tela de login abre, mas nada carrega | A API não está no ar. Confira o terminal da porta 3333. |
| `EADDRINUSE` na porta 3333 ou 5173 | Outra instância está rodando. Encerre o processo ou use `PORT` para trocar a porta da API. |
| Leitura por chave devolve o aviso da consulta assistida | Não há `INFOSIMPLES_TOKEN` no `.env`, ou o serviço falhou. Use o link da SEFAZ e importe o XML, ou configure o token. |
| `Esta nota fiscal já consta no seu histórico` | A chave já foi registrada nessa conta. É a proteção que evita consulta paga repetida. |
| A câmera não abre na leitura | O navegador exige HTTPS ou `localhost` e permissão de câmera. Use a chave de acesso como alternativa. |
| Base com dados estranhos após testes manuais | Rode `npm --prefix server run seed` para recriar a base de demonstração. |

## Limitações conhecidas

- A consulta ao serviço de distribuição da SEFAZ não está implementada, porque exige
  certificado digital do destinatário.
- O portal público da NFC-e da SEFAZ-PB exige reCAPTCHA mesmo a partir do QR Code, então
  a leitura automática depende de um intermediário contratado.
- A integração cobre, nesta versão, apenas notas emitidas na Paraíba.
- O retorno do portal não traz a classificação fiscal nem os tributos por item, e o
  código de barras só aparece quando o estabelecimento o cadastra.
- A base de demonstração é sintética e reprodutível. As chaves de acesso são válidas,
  mas os itens e preços não vêm de documentos autorizados.
- Produtos a granel com códigos internos do estabelecimento não têm identidade estável
  entre lojas e não são tratados.

## Licença

MIT.

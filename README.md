# NotaFácil

Aplicação web progressiva que transforma as notas fiscais de consumo em um histórico
pessoal de preços. A partir do QR Code do cupom, da chave de acesso ou do XML
autorizado, o sistema registra os itens comprados e compara cada um deles com as
compras anteriores do mesmo usuário.

Produto de software desenvolvido como Trabalho de Conclusão de Curso do Bacharelado em
Engenharia de Software da Unicesumar. Autor: **Henrique Gonsalves Costa**.

**Demonstração online:** https://notafacil.henriquegratidao.com.br, com a conta
`demo@notafacil.app` e a senha `demo1234`, ou crie a sua conta em
https://notafacil.henriquegratidao.com.br/cadastro. A conta de demonstração é restaurada todo dia
às 4h (horário de Brasília), sem afetar as contas criadas.

---

## Sumário

- [O que a aplicação faz](#o-que-a-aplicação-faz)
- [Como as métricas são calculadas](#como-as-métricas-são-calculadas)
- [Como a nota é obtida](#como-a-nota-é-obtida)
- [Requisitos](#requisitos)
- [Como rodar localmente](#como-rodar-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Scripts disponíveis](#scripts-disponíveis)
- [API REST](#api-rest)
- [Arquitetura](#arquitetura)
- [Modelo de dados](#modelo-de-dados)
- [Identidade do produto e comparação de preços](#identidade-do-produto-e-comparação-de-preços)
- [Privacidade e LGPD](#privacidade-e-lgpd)
- [Testes](#testes)
- [Capturas e diagramas](#capturas-e-diagramas)
- [Publicação em servidor](#publicação-em-servidor)
- [Problemas comuns](#problemas-comuns)
- [Limitações conhecidas](#limitações-conhecidas)
- [Licença](#licença)

---

## O que a aplicação faz

O sistema é de uso individual: cada usuário enxerga apenas as notas que registrou. As
funcionalidades estão organizadas nas telas abaixo.

| Tela | Rota | O que oferece |
| --- | --- | --- |
| **Entrar** | `/entrar` | Criação de conta e login com e-mail e senha. A sessão é mantida por token assinado guardado no navegador. |
| **Painel** | `/painel` | Indicadores de notas, gasto total, tributos e ticket médio; gráfico de gasto por mês; produtos de maior variação de preço; produtos comprados com mais frequência. |
| **Ler nota** | `/leitura` | Três formas de registrar uma nota: leitura do QR Code pela câmera, digitação da chave de acesso (ou da URL de consulta) e importação do arquivo XML. Mostra os campos interpretados da chave, a comparação item a item e a economia possível. |
| **Notas** | `/notas` e `/notas/:id` | Histórico com filtros por estabelecimento, chave e período. O detalhe traz emitente, itens, tributos, origem do registro, a comparação de cada item e a opção de excluir a nota. |
| **Produtos e Empresas** | `/produtos`, `/produtos/:id` e `/empresas` | Busca por descrição, código de barras ou classificação fiscal; produtos recorrentes; série histórica do preço unitário; preço mais recente por estabelecimento e produtos comprados em cada loja. |
| **Comparar lojas** | `/comparativo` | Para os produtos comprados em duas ou mais lojas: preço em cada uma, a mais barata, diferença e amplitude, além do custo da cesta em comum e da economia. Permite escolher o período e as lojas. |
| **Minha conta** | `/conta` | Corrigir nome e e-mail, baixar todos os dados em JSON e excluir a conta. |
| **Privacidade** | `/privacidade` | Política de privacidade versionada, pública, com o aceite da versão vigente. |

Cada item de uma nota é comparado com a compra anterior mais recente do mesmo produto, só entre as
compras feitas antes dela, e recebe uma situação:

- **novo**: primeira compra do produto no histórico;
- **aumento**: preço mais de 1% acima da compra anterior;
- **redução**: preço mais de 1% abaixo da compra anterior;
- **estável**: variação dentro da faixa de 1%, que evita tratar arredondamento como
  mudança de preço.

O sistema também calcula o menor preço já pago pelo produto e quanto a compra teria
custado a menos com esse valor.

## Como as métricas são calculadas

Todos os valores são calculados na API, nunca na tela, e cada fórmula tem teste em
`server/tests/metricas.test.js`. Todas as consultas são filtradas pelo usuário autenticado.

| Onde aparece | Métrica | Fórmula |
| --- | --- | --- |
| Painel | Total gasto | Σ valor total das notas |
| Painel | Tributos embutidos | Σ tributos ÷ Σ valor total × 100 |
| Painel | Ticket médio | total gasto ÷ número de notas |
| Painel | Gasto por mês | Σ valor total das notas do mês, com zero nos meses sem compra |
| Painel, produtos | Preço médio | Σ valor total ÷ Σ quantidade (média ponderada pela quantidade) |
| Painel, produtos | Amplitude | (maior preço unitário − menor) ÷ menor × 100 |
| Detalhe do produto | Variação no período | (preço da última compra − preço da primeira) ÷ primeira × 100 |
| Detalhe do produto | Onde está mais barato | preço da compra mais recente do usuário em cada loja |
| Detalhe da nota | Variação do item | (preço atual − preço da compra anterior) ÷ anterior × 100 |
| Detalhe da nota | Economia possível | máx(0, (preço atual − menor preço anterior) × quantidade) |
| Histórico de notas | Quantidade e totais | somados sobre todas as notas filtradas; a lista exibe as 200 mais recentes |
| Comparar lojas | Preço na loja | compra mais recente do produto naquela loja, no período |
| Comparar lojas | Cesta comum | produtos com preço em todas as lojas comparadas; custo = soma do preço de uma unidade de cada |
| Comparar lojas | Economia da cesta | custo na loja mais cara − custo na mais barata; o percentual é sobre a mais cara |

Na comparação da nota, "compra anterior" é sempre anterior à própria nota, pela data e pela
hora de emissão. Importar notas fora de ordem não altera o resultado de nenhuma delas.

## Como a nota é obtida

A obtenção do documento fiscal fica atrás de uma porta (`consultar(chave)`) com cinco
implementações intercambiáveis. Uma cadeia de responsabilidade percorre os provedores e
usa o primeiro que responder.

| Provedor | Quando entra | O que faz |
| --- | --- | --- |
| `ProvedorXmlAutorizado` | Importação de arquivo XML | Lê o XML de autorização da NF-e/NFC-e. É o caminho de maior fidelidade, porque os dados vêm do próprio documento. |
| `ProvedorSefaz` | Sempre tentado primeiro | Ponto de extensão para o serviço de distribuição da SEFAZ. Não implementado, porque exige certificado digital A1/A3 do destinatário. Sinaliza indisponibilidade e a cadeia segue. |
| `ProvedorInfosimples` | Com `INFOSIMPLES_TOKEN` no `.env` | Consulta a NFC-e pela API da Infosimples, que acessa o portal da SEFAZ da UF da nota e devolve a nota em JSON. Serviço pago por requisição. |
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

> O seed apaga e recria só a conta de demonstração; as demais contas ficam intactas. Rode de novo
> sempre que quiser voltar ao estado inicial da demo.

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
| `INFOSIMPLES_TOKEN` | vazio | Token da API Infosimples. Com ele, a leitura por chave ou QR consulta o portal da SEFAZ da UF da nota. Sem ele, a aplicação usa a consulta assistida. |
| `NFE_MODO_DEMO` | vazio | `1` liga o modo demonstração (mesmo efeito de `npm run start:demo`). |
| `PORT` | `3333` | Porta da API. |
| `DB_PATH` | `server/data/notafacil.db` | Caminho do arquivo SQLite. Os testes usam um diretório temporário. |
| `JWT_SECRET` | `notafacil-desenvolvimento` fora de produção | Segredo que assina o token de sessão. **Obrigatório em produção**: com `NODE_ENV=production`, a API não inicia sem ele. |
| `NODE_ENV` | vazio | `production` ativa as exigências de produção, como o `JWT_SECRET` próprio. |
| `INFOSIMPLES_AMOSTRAS_DIR` | vazio | Pasta onde gravar cada resposta da Infosimples, sem consumidor, destinatário e dados da conta. Serve para conferir o formato de UFs novas; deixe vazio no uso normal. |
| `CORS_ORIGENS` | `http://localhost:5173` | Origens autorizadas a chamar a API pelo navegador, separadas por vírgula. |
| `CADASTRO_ABERTO` | aberto | `false` fecha o cadastro de novas contas: a API responde 403 e a tela de entrada esconde a aba e o link de cadastro. |
| `LIMITE_CADASTROS_POR_HORA` | `5` | Contas que um mesmo IP pode criar por hora. Acima disso, a API responde 429 com `Retry-After`. |
| `TRUST_PROXY` | desligado | Valor de `trust proxy` do Express atrás de um proxy reverso (`loopback` ou número de saltos), para o limite de login usar o IP real do cliente. |
| `CLIENTE_DIR` | `web/dist` | Pasta do build do cliente. Quando existe, a API serve o cliente na mesma origem, com as rotas do React. |
| `VITE_API_URL` | `http://localhost:3333` | Destino do proxy `/api` do cliente em desenvolvimento. |

O `.env` não vai para o Git.

## Scripts disponíveis

**`server/`**

| Script | O que faz |
| --- | --- |
| `npm start` | Sobe a API lendo o `.env`. |
| `npm run dev` | Mesmo que o anterior, com recarga automática. |
| `npm run start:demo` | Sobe a API no modo demonstração. |
| `npm run seed` | Restaura a conta de demonstração, sem tocar nas outras contas. |
| `npm test` | Roda os 102 testes automatizados. |
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
no login. O corpo é JSON, exceto a importação de XML, que aceita `application/xml`. Todas as
consultas são filtradas pelo usuário autenticado.

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| `GET` | `/api/saude` | pública | Verificação de disponibilidade. |
| `GET` | `/api/docs` | pública | Documentação navegável (Swagger UI). |
| `GET` | `/api/openapi.json` | pública | Especificação OpenAPI 3.0 da API. |
| `GET` | `/api/privacidade` | pública | Política de privacidade vigente. |
| `POST` | `/api/auth/cadastro` | pública | Cria conta com nome, e-mail e senha, exigindo o aceite da política. |
| `POST` | `/api/auth/login` | pública | Devolve o token de sessão. Bloqueia após 5 tentativas erradas (429). |
| `GET` | `/api/conta` | autenticada | Dados da conta e situação do aceite da política. |
| `PATCH` | `/api/conta` | autenticada | Corrige nome ou e-mail. |
| `DELETE` | `/api/conta` | autenticada | Exclui a conta e todos os dados, com confirmação de senha. |
| `GET` | `/api/conta/exportacao` | autenticada | Exporta todos os dados do titular em JSON. |
| `POST` | `/api/conta/politica` | autenticada | Registra o aceite da versão vigente da política. |
| `POST` | `/api/notas/qrcode` | autenticada | Registra uma nota a partir do conteúdo do QR Code ou da chave de acesso. |
| `POST` | `/api/notas/xml` | autenticada | Registra uma nota a partir do XML de autorização. |
| `GET` | `/api/notas` | autenticada | Lista as notas, com filtros por chave, período, empresa e busca, e devolve quantidade e totais de todas as filtradas. |
| `GET` | `/api/notas/:id` | autenticada | Detalhe da nota com itens e comparação. |
| `DELETE` | `/api/notas/:id` | autenticada | Exclui a nota e recalcula os preços por estabelecimento. |
| `GET` | `/api/notas/:id/comparacao` | autenticada | Comparação item a item com o histórico. |
| `GET` | `/api/produtos` | autenticada | Busca produtos por descrição, código de barras ou classificação fiscal. |
| `GET` | `/api/produtos/recorrentes` | autenticada | Produtos comprados em duas ou mais notas. |
| `GET` | `/api/produtos/:id/historico` | autenticada | Série histórica de preço, ofertas por loja, estatísticas e produtos vinculados. |
| `GET` | `/api/produtos/:id/sugestoes-vinculo` | autenticada | Produtos do usuário que parecem ser o mesmo, com outra descrição. |
| `POST` | `/api/produtos/:id/vinculos` | autenticada | Confirma que outro produto é este mesmo (`{ produtoId }`). |
| `DELETE` | `/api/produtos/:id/vinculos/:origemId` | autenticada | Desfaz o vínculo. |
| `GET` | `/api/empresas` | autenticada | Estabelecimentos com total gasto e última compra. |
| `GET` | `/api/empresas/:id/produtos` | autenticada | Produtos comprados em um estabelecimento. |
| `GET` | `/api/comparativo/estabelecimentos` | autenticada | Comparação de preços e da cesta comum entre lojas, por período. |
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
server/src/seguranca.js          segredo do token, CORS, cabeçalhos e limite de login
server/src/lgpd/politica.js      política de privacidade versionada
server/src/services/             casos de uso: importação, comparação, conta e comparativo
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
| `usuario` | Conta de acesso, com senha guardada como hash bcrypt e a versão e a data do aceite da política. |
| `empresa` | Estabelecimento emitente, único por CNPJ. |
| `produto` | Produto único no sistema, identificado por código de barras ou por classificação fiscal e descrição normalizada. |
| `nota_fiscal` | Nota registrada por um usuário, com data e hora de emissão, única por par usuário e chave de acesso. |
| `item_nota` | Ocorrência de compra, com quantidade, valor unitário e tributos. |
| `preco_empresa_produto` | Preço mais recente de cada produto em cada estabelecimento, separado por usuário. |

A separação entre `produto` e `item_nota` é o que torna a comparação possível. Toda a
gravação de uma nota ocorre em uma única transação.

## Identidade do produto e comparação de preços

Para reconhecer o mesmo produto em notas de emitentes diferentes, o sistema segue esta
ordem:

1. **Código de barras (GTIN/EAN)**, aceito somente se o dígito verificador conferir e se,
   sem os zeros à esquerda, tiver ao menos 8 dígitos. O portal devolve no mesmo campo
   códigos internos da loja (`CFOP5102`, `11956`, `0000000007379`), que são descartados.
2. **Classificação fiscal (NCM) com a descrição normalizada**, quando não há código de
   barras. A normalização remove acentos, converte para caixa alta e descarta o que não
   é letra ou dígito.
3. **Descrição normalizada sozinha**, quando a fonte não informa a classificação fiscal,
   como acontece no retorno do portal.
4. Sem correspondência, registra-se um produto novo.

Nas NFC-e consultadas pelo portal da SEFAZ-PB, o código de barras não vem: o campo traz o
código interno da loja. A mesma lata chega como `REF COCA COLA S ACUCAR LT 350ML` no
atacado e `COCA COLA ZERO LATA 350 ML` no posto e vira dois produtos. Para esses casos há o
**vínculo manual**: na tela do produto, o sistema sugere produtos do próprio usuário com a
mesma medida, a mesma versão (zero, diet, integral...) e palavras em comum depois de
expandir abreviações (`REF`, `LT`, `S ACUCAR`). O usuário confirma, as compras passam a
contar no mesmo produto e a regra vale para as próximas notas. Nada é juntado
automaticamente, e o vínculo é de cada usuário.

## Privacidade e LGPD

O NotaFácil trata dados pessoais (conta e histórico de compras), então segue a Lei nº
13.709/2018. Esta seção descreve as medidas implementadas e não substitui uma avaliação
jurídica.

**Política e consentimento.** A política de privacidade fica em `server/src/lgpd/politica.js`,
é pública em `/privacidade` e `/api/privacidade` e identifica controlador e encarregado,
dados tratados, finalidade, bases legais, compartilhamento com a Infosimples, transferência
internacional, retenção, segurança e direitos. O cadastro exige o aceite da versão vigente e o
consentimento específico para compras que possam revelar dados de saúde (art. 11, I). A
versão e a data do aceite ficam registradas; quando a política muda de versão, o uso fica
bloqueado até o novo aceite.

**Direitos do titular (art. 18).**

| Direito | Como exercer | Rota |
| --- | --- | --- |
| Acesso e portabilidade | Minha conta > Baixar meus dados (JSON) | `GET /api/conta/exportacao` |
| Correção | Minha conta > Dados cadastrais | `PATCH /api/conta` |
| Eliminação de uma compra | Detalhe da nota > Excluir nota | `DELETE /api/notas/:id` |
| Eliminação total | Minha conta > Excluir conta (com senha) | `DELETE /api/conta` |
| Informação sobre compartilhamento | Política de privacidade | `GET /api/privacidade` |

**Minimização.** O CPF do consumidor, quando presente no XML ou na resposta do serviço de
consulta, é descartado antes da gravação (há teste que verifica todas as tabelas). A exportação
não inclui o hash da senha. Excluir notas ou a conta remove também produtos e estabelecimentos
que deixaram de ser usados.

**Isolamento.** Notas, produtos, preços por estabelecimento e comparativos são sempre filtrados
pelo usuário autenticado. Um usuário não consegue ver, nem por ID, compras de outro.

**Segurança (art. 46).** Senha com hash bcrypt e mínimo de 8 caracteres; sessão por token com
validade de 24 horas, invalidada quando a conta é excluída; login bloqueado após 5 tentativas
erradas em 15 minutos; CORS restrito às origens configuradas; cabeçalhos HTTP de proteção;
mensagens de erro interno sem detalhes técnicos; e `JWT_SECRET` obrigatório em produção.

Para publicar o sistema: sirva a API e o cliente por HTTPS, defina `JWT_SECRET` e
`CORS_ORIGENS` e, se adotar cópias de segurança, mantenha-as cifradas e incluídas na política.

## Testes

```bash
npm --prefix server test
```

São 102 casos, executados sobre uma base isolada em diretório temporário:

| Arquivo | Casos | Cobre |
| --- | --- | --- |
| `chaveAcesso.test.js` | 10 | Validação e decomposição da chave, extração a partir do QR Code e formatação do CNPJ. |
| `comparacao.test.js` | 11 | Classificação da variação de preço, economia possível, recusa de duplicidade, indicadores e identidade do produto. |
| `provedores.test.js` | 6 | Consulta assistida, links de portais oficiais e cadeia de provedores. |
| `infosimples.test.js` | 24 | Serviços das 27 UFs, NF-e de modelo 55 pelo serviço unificado (com resposta real anonimizada), recusa de emitente pessoa física e da NF-e avulsa sem CNPJ, conversão dos formatos resumido, completo (SP) e de MG, troca de caminho sem custo (602) e parada em erro cobrado, GTIN, datas, notas canceladas, anonimização das amostras e desvio em caso de falha. |
| `metricas.test.js` | 17 | Fórmulas do painel, dos produtos, da nota e do comparativo; ordem cronológica da comparação; isolamento entre usuários; exclusão de nota. |
| `lgpd.test.js` | 13 | Aceite e consentimento no cadastro, política pendente, exportação, correção, exclusão de nota e de conta, descarte do CPF, isolamento pelas rotas, limite de login, CORS e segredo obrigatório em produção. |
| `implantacao.test.js` | 7 | Cadastro fechado por configuração, limite de cadastros por IP, restauração da conta demo sem afetar outras contas, confiança no proxy, cliente web servido pela API e 404 em JSON para rota inexistente. |
| `vinculos.test.js` | 9 | GTIN com zeros à esquerda, semelhança de descrições (versões e medidas diferentes nunca sugeridas), vincular e desvincular produtos, vínculo aplicado a notas novas, isolamento entre usuários e exportação. |
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

## Publicação em servidor

A instalação de demonstração roda em uma VPS Linux com nginx e HTTPS. A API serve o build do
cliente na mesma origem, então há um único serviço. Os arquivos ficam em [`implantacao/`](implantacao/):

| Arquivo | Destino na VPS | Função |
| --- | --- | --- |
| `notafacil.service` | `/etc/systemd/system/` | Serviço da aplicação, com usuário próprio e escrita só em `/var/lib/notafacil`. |
| `notafacil-demo.service` e `.timer` | `/etc/systemd/system/` | Restaura a conta de demonstração todo dia às 4h (horário de Brasília). |
| `nginx-notafacil.conf` | `/etc/nginx/sites-available/notafacil` | Proxy reverso; o certbot acrescenta o HTTPS. |
| `env.producao.exemplo` | `/opt/notafacil/app/server/.env` | Variáveis de produção. |
| `atualizar.sh` | executado da pasta do repositório | Baixa a versão nova, instala, gera o build e reinicia o serviço. |

Estrutura na VPS: o Node fica em `/opt/notafacil/node` (sem alterar o Node do sistema), o
repositório em `/opt/notafacil/app` e a base em `/var/lib/notafacil/notafacil.db`.

Instalação inicial, como root:

```bash
useradd --system --home /opt/notafacil --shell /usr/sbin/nologin notafacil
mkdir -p /opt/notafacil /var/lib/notafacil && chown notafacil: /opt/notafacil /var/lib/notafacil
# Node 24 em /opt/notafacil/node (tarball oficial de nodejs.org)
sudo -u notafacil git clone https://github.com/riquexcosta/notafacil.git /opt/notafacil/app
# .env a partir de implantacao/env.producao.exemplo (chmod 600, dono notafacil)
cp /opt/notafacil/app/implantacao/notafacil{,-demo}.service /opt/notafacil/app/implantacao/notafacil-demo.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable notafacil notafacil-demo.timer
bash /opt/notafacil/app/implantacao/atualizar.sh        # instala, gera o build e inicia
systemctl start notafacil-demo.service                  # cria a conta de demonstração
sed 's/DOMINIO/notafacil.exemplo.com.br/; s/PORTA/3333/' /opt/notafacil/app/implantacao/nginx-notafacil.conf > /etc/nginx/sites-available/notafacil
ln -s /etc/nginx/sites-available/notafacil /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
systemctl start notafacil-demo.timer
certbot --nginx -d notafacil.exemplo.com.br
```

> A restauração diária apaga e recria **só a conta de demonstração**. As contas criadas pelo
> cadastro, suas notas e os produtos e lojas que elas usam são preservados.

## Problemas comuns

| Sintoma | Causa provável e solução |
| --- | --- |
| `--env-file-if-exists` não reconhecido | Node anterior à 22.9. Atualize o Node. |
| Tela de login abre, mas nada carrega | A API não está no ar. Confira o terminal da porta 3333. |
| `EADDRINUSE` na porta 3333 ou 5173 | Outra instância está rodando. Encerre o processo ou use `PORT` para trocar a porta da API. |
| Leitura por chave devolve o aviso da consulta assistida | Não há `INFOSIMPLES_TOKEN` no `.env`, ou o serviço falhou. Use o link da SEFAZ e importe o XML, ou configure o token. |
| `Esta nota fiscal já consta no seu histórico` | A chave já foi registrada nessa conta. É a proteção que evita consulta paga repetida. |
| A câmera não abre na leitura | O navegador exige HTTPS ou `localhost` e permissão de câmera. Use a chave de acesso como alternativa. |
| `Muitas tentativas de login` (429) | Foram 5 senhas erradas em 15 minutos para o mesmo e-mail. Aguarde o tempo indicado. |
| Depois de entrar, abre a política de privacidade | A conta ainda não aceitou a versão vigente da política. Leia e aceite para continuar. |
| API não inicia com `JWT_SECRET é obrigatório em produção` | `NODE_ENV=production` sem `JWT_SECRET`. Defina um segredo longo e aleatório no `.env`. |
| Aba "Criar conta" não aparece | A instalação está com `CADASTRO_ABERTO=false`. Use a conta de demonstração. |
| Conta demo com dados estranhos após testes manuais | Rode `npm --prefix server run seed` para restaurar a conta de demonstração. |

## Limitações conhecidas

- A consulta ao serviço de distribuição da SEFAZ não está implementada, porque exige
  certificado digital do destinatário.
- O portal público da NFC-e da SEFAZ-PB exige reCAPTCHA mesmo a partir do QR Code, então
  a leitura automática depende de um intermediário contratado.
- A integração cobre a NFC-e (modelo 65) das 27 UFs e a NF-e (modelo 55) pelo serviço unificado `sefaz/nfe`
  da Infosimples. O formato da resposta varia:
  SP, CE e as versões "completa" (AM, BA, GO, RJ, RO) trazem GTIN e NCM; as demais trazem só descrição,
  quantidade e valores, e a identidade do produto depende da descrição normalizada. A versão SVRS do RS,
  que exige login e certificado, não é usada.
- O retorno do portal não traz a classificação fiscal nem os tributos por item, e o
  código de barras só aparece quando o estabelecimento o cadastra.
- A base de demonstração é sintética e reprodutível. As chaves de acesso são válidas,
  mas os itens e preços não vêm de documentos autorizados.
- Produtos a granel com códigos internos do estabelecimento não têm identidade estável
  entre lojas e não são tratados.
- O limite de tentativas de login fica em memória: vale para uma única instância da API e
  recomeça quando ela reinicia.
- Esta versão não mantém cópias de segurança automáticas da base.

## Licença

MIT.

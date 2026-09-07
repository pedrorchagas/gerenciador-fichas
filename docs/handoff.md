# Handoff — gerenciador de fichas (festa beneficente)

Última atualização: 2026-09-06, ao fim da sessão que construiu o front inteiro (loja pública + painel do operador) em `front/`. Este documento existe pra qualquer pessoa (ou agente) que continue o trabalho sem ter visto a conversa original. Leia isto primeiro; para o detalhe de arquitetura/modelagem, veja [core-plan.md](core-plan.md); para o contrato de rotas que o front consome, veja [api-contract.md](api-contract.md); **para tudo que foi decidido no front, veja [front-handoff.md](front-handoff.md)**; para colocar isso no ar, veja [magalu-setup.md](magalu-setup.md) (infraestrutura Magalu Cloud) e [deploy.md](deploy.md) (VM, systemd, TLS e deploy por `git pull` — reescrito em 2026-09-07 pra Magalu Cloud).

## O que é o projeto

API para gerenciar fichas de uma festa beneficente de igreja. Duas frentes:
- **Pública**: cliente vê itens disponíveis, monta um pedido (carrinho gerenciado pelo front, fora deste repo) e recebe um QR code Pix pra pagar.
- **Logada**: operador da igreja cadastra/edita itens, vê a lista de pedidos e atualiza o status de cada um (separado/entregue) conforme o pagamento é confirmado.

Integração de pagamento: Mercado Pago (Pix). Banco de dados: **PostgreSQL via Sequelize**, instalado na própria VM (decisão de 2026-09-07 — DBaaS gerenciado foi avaliado e descartado por custo/simplicidade); imagens no **Object Storage da Magalu**.

> **Migração AWS → Magalu Cloud (2026-09-07).** O projeto saiu de DynamoDB + S3 e foi pra PostgreSQL (Sequelize) + Object Storage da Magalu. **Tudo abaixo que fala em DynamoDB, `dynamoService.js`, `s3Service.js` ou credenciais AWS é histórico** — as decisões de produto continuam valendo, os detalhes de infra não. Para configurar do zero, veja [magalu-setup.md](magalu-setup.md). Resumo do que mudou:
>
> - `services/dynamoService.js` → `services/databaseService.js` (instância Sequelize + os 3 models). PostgreSQL na própria VM, conexão por `localhost` com `DB_SSL=false`; **backup é responsabilidade nossa agora** (`pg_dump` no cron, ver [magalu-setup.md](magalu-setup.md)).
> - `services/s3Service.js` → `services/storageService.js` — **mesmo `@aws-sdk/client-s3`**, porque o Object Storage da Magalu é compatível com S3; muda só endpoint (`https://br-se1.magaluobjects.com`, `forcePathStyle`) e credenciais (API key da Magalu, no `.env`).
> - Models viraram Sequelize, com as mesmas assinaturas de função — controllers quase não mudaram. A exceção: "não existe" agora é `null` retornado pelos `update*`, não `ConditionalCheckFailedException`; e e-mail duplicado é `SequelizeUniqueConstraintError`.
> - Nomes de tabela com underscore (`fichas_itens`), porque agora são identificadores SQL. `items` do pedido virou coluna **JSONB** — mesmo snapshot embutido de antes, sem tabela de junção.
> - `npm run setup:tables` agora é `sequelize.sync()`; `npm run smoke` (novo) valida banco + object storage de ponta a ponta.
> - Env vars: `DATABASE_URL`, `MGC_REGION`, `MGC_BUCKET`, `MGC_ACCESS_KEY_ID`, `MGC_SECRET_ACCESS_KEY` no lugar de `AWS_REGION`/`DYNAMO_ENDPOINT`/`S3_BUCKET`.

## Estado no fim da sessão

O **core funcional está implementado e testado de ponta a ponta contra APIs reais** (AWS DynamoDB de verdade, Mercado Pago sandbox de verdade): registro/login, CRUD de itens (com upload de imagem pro S3), criação de pedido com QR Pix real, e o webhook já está recebendo notificações reais do Mercado Pago via ngrok (confirmado no log do servidor).

**WebSocket de tempo real pro painel logado: implementado** em 2026-09-05 (parte 3) — ver seção própria abaixo — e **validado com um cliente de verdade** em 2026-09-06, quando o front foi construído.

**O front existe e está completo** desde 2026-09-06 (`front/`, HTML/CSS/JS puro, sem build). Ver seção própria abaixo.

## Sessão de 2026-09-06: front completo (loja + painel)

Construído o front inteiro em `front/`, consumindo a API real (nada mockado). **Todo o detalhe está em [front-handoff.md](front-handoff.md)** — aqui fica só o que impacta quem mexe no backend:

- **`gerenciador-fichas-api.js` ganhou uma linha**: `app.use(express.static(path.join(__dirname, 'front')))`, ao lado do `express.static('public')` que já existia. **Sem isso o front não funciona** — a API não manda header `Access-Control-*` nenhum, então servir o front pela própria origem é o que resolve CORS e o WebSocket de uma vez. Se algum dia o front for pra outro domínio, aí sim vai precisar de `cors` na REST e da origem alinhada no Socket.IO (hoje `origin: '*'`).
- **`.eslintignore` ganhou `front/`** — o `.eslintrc.json` é `env: node` + airbnb-base, rodar isso sobre código de browser só gera ruído.
- **Nenhuma outra mudança no backend**, e nenhuma dependência nova.
- **A API não tem campo de categoria nos itens**, e a spec do front pedia menu por seções. Convenção acordada com o usuário, sem tocar no backend: a categoria é um **prefixo no `name`** (`"Bebidas: Guaraná Lata"`). Se um dia entrar um campo `category` de verdade no `itemModel`, o front tem um único ponto de troca (`splitCategory`/`joinCategory` em `front/assets/core.js`) — ver [front-handoff.md](front-handoff.md).
- **`pedidoAtualizado` confirmado de ponta a ponta** (era a pendência nº 3 da lista abaixo): token inválido é recusado no handshake com `"Token inválido ou expirado."`, token válido conecta, e um `PATCH` de status entrega o pedido completo no evento. Testado sem `socket.io-client` (não está instalado), falando o protocolo do Socket.IO na mão por polling — receita em [front-handoff.md](front-handoff.md).
- Dados de teste criados: 1 item `"Bebidas: Guaraná Lata [teste-front]"` já desativado, e 1 `PATCH` idempotente (`cancelled` → `cancelled`) no pedido `0f91b545-...`, que não mudou nada no banco.

## Sessão de 2026-09-05: upload de imagem nos itens (S3)

Adicionado suporte a imagem no cadastro de itens, testado de ponta a ponta contra AWS S3 real (bucket `sistema-feira`, região `sa-east-1`):

- `POST /itens` e `PUT /itens/:id` passaram de `application/json` pra `multipart/form-data` (campo `image`, opcional, além dos campos `name`/`description`/`price` como texto). Ver [api-contract.md](api-contract.md) pra formato exato.
- Upload vai direto pro S3 via `services/s3Service.js`, key `itens/<itemId>/<uuid>.<ext>`; o item guarda só `imageKey` no Dynamo.
- No `PUT` com nova imagem, a imagem anterior é apagada do S3 (testado: `head-object` confirma 404 depois da troca).
- Todo `GET` de item (lista e por id) devolve `imageUrl` — URL pública fixa do S3, montada em runtime a partir do `imageKey` (`s3Service.buildImageUrl`), não é presigned/expira. Decisão tomada com o usuário: como são imagens de cardápio pra visitante sem login, URL pública fixa é mais simples que presigned e não precisa ser renovada pelo front.
- Novo middleware `middlewares/uploadImageMiddleware.js` — `multer` em memória (não grava em disco), limite 5MB, só aceita mimetype `image/*` (fora disso o arquivo é ignorado silenciosamente — sem imagem, sem erro; não confundir com erro de validação).
- **Infra que o usuário configurou manualmente** (fora do alcance de código): bucket S3 `sistema-feira` criado em `sa-east-1`; "Block Public Access" desabilitado; bucket policy de leitura pública restrita ao prefixo `itens/*`:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "PublicReadItens",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::sistema-feira/itens/*"
    }]
  }
  ```
  A credencial AWS local (mesma chain usada pro DynamoDB) já tem `s3:PutObject`/`s3:DeleteObject` nesse bucket — confirmado via teste direto (`aws s3api put-object`/`delete-object`).
- Nova env var: `S3_BUCKET=sistema-feira` (já preenchida no `.env` real; adicionada também no `.env.example`).
- Itens antigos (criados antes dessa sessão) não têm `imageKey` — o `GET` devolve `imageUrl: null` pra eles, front precisa tratar esse caso (ex: mostrar um placeholder).

## Sessão de 2026-09-05 (parte 3): WebSocket de tempo real (Socket.IO)

Implementado o item que estava deliberadamente em aberto (ver seções anteriores). Decisões seguidas conforme já combinado com o usuário:

- Socket.IO anexado ao mesmo `server` HTTP criado em `gerenciador-fichas-api.js` (`socketService.init(server)`) — não é uma porta/processo separado.
- Autenticação via JWT no handshake (`socket.handshake.auth.token`), não por header — feita em `services/socketService.js` com um middleware `io.use(...)` que valida com o mesmo `JWT_SECRET` do `authMiddleware`. Conexão sem token ou com token inválido/expirado é recusada (`connect_error`), nunca chega a conectar.
- Evento único `pedidoAtualizado` (broadcast pra todos os clientes conectados, sem salas — não há conceito de "dono" do pedido no painel, qualquer operador logado vê tudo) emitido nos **três** pontos que mudam a lista de pedidos:
  1. `orderController.createOrder` — depois que o pedido é criado com sucesso (inclusive quando a criação do Pix falha e o pedido vira `cancelled` — emite também, senão o painel não veria o cancelamento).
  2. `orderController.handleMercadoPagoWebhook` — quando o status muda (`pending → paid`/`cancelled`).
  3. `orderController.updateOrderStatus` — na transição manual (`paid → ready → delivered`, ou `cancelled`).
- Payload do evento é o pedido completo (mesmo shape do `GET /pedidos/:id`) — front faz upsert na lista local pelo `orderId`, não precisa de um evento de remoção (pedido nunca é apagado, só muda de status).
- Ampliação em relação ao que tinha sido discutido originalmente: o combinado era emitir só nos dois pontos de mudança de *status* (webhook + PATCH). Nesta sessão o escopo foi lido como "lista atualiza conforme pedidos são criados" também — por isso a criação (`POST /pedidos`) também emite. Se isso não for desejado, é só remover a chamada em `createOrder`.
- `cors: { origin: '*' }` no Socket.IO (`services/socketService.js`) — liberado geral porque a API REST hoje também não tem CORS configurado (não foi adicionado agora, é um gap pré-existente; se algum dia restringir CORS da REST, replicar a mesma origem aqui).
- Testado manualmente: servidor sobe sem erro, `GET /socket.io/?EIO=4&transport=polling` responde `200` (handshake do protocolo Socket.IO ativo). Não foi testado um cliente WS de ponta a ponta emitindo/recebendo `pedidoAtualizado` de verdade (não há front neste repo) — próxima sessão que integrar o front deveria confirmar isso na prática.
- Contrato completo (payload, exemplo de conexão) documentado em [api-contract.md](api-contract.md#tempo-real--websocket-painel-logado).

## Mapa do que foi criado/reescrito nesta sessão

O projeto era um scaffold quase todo vazio (controllers/models vazios, rotas quebradas apontando pra um `postController` inexistente, `services/databaseService.js` referenciado mas nunca criado — o app não subia). Praticamente tudo foi escrito do zero:

```
gerenciador-fichas-api.js              entrypoint (dotenv, express, error handler central)
gerenciador-fichas/
  routes/
    routes.js                          registra /itens /pedidos /auth /pagamentos
    itemRoute.js                       CRUD itens (create/update/delete logados; list/get públicos)
    orderRoute.js                      POST público, GET logado, GET/:id público, PATCH/:id/status logado
    authRoute.js                       /register /login (públicos)
    paymentRoute.js                    POST /notifications (webhook Mercado Pago)
  controllers/
    itemController.js
    orderController.js                 createOrder chama o Mercado Pago; handleMercadoPagoWebhook
    userController.js                  bcrypt + JWT
  models/                              um arquivo por entidade, usando os models do Sequelize
    itemModel.js
    orderModel.js
    userModel.js
  middlewares/
    authMiddleware.js                  JÁ EXISTIA — só voltou a funcionar depois do errorService
    mercadoPagoWebhookMiddleware.js    valida x-signature (HMAC) das notificações do MP
    asyncHandler.js                    wrapper pra toda rota async — ver "bug crítico" abaixo
    uploadImageMiddleware.js           multer em memória p/ campo "image" (POST/PUT /itens) — sessão 2026-09-05
  services/
    databaseService.js                 instância Sequelize (PostgreSQL) + os 3 models — Magalu DBaaS
    errorService.js                    catálogo de erros + helper de resposta (estava vazio)
    mercadoPagoService.js              cria/consulta Order (Orders API!) via SDK oficial mercadopago
    storageService.js                  upload/delete/URL pública de imagem no Object Storage da Magalu
    socketService.js                   Socket.IO: auth JWT no handshake + emitOrderUpdated — sessão 2026-09-05 (parte 3)
scripts/
  createTables.js                      sequelize.sync() — cria as 3 tabelas (npm run setup:tables)
  smoke.js                             checa banco + object storage de ponta a ponta (npm run smoke)
docs-api/gerenciador-fichas-api/       coleção Bruno (formato OpenCollection YAML) pra testar tudo manualmente
docs/core-plan.md                      plano de arquitetura detalhado (banco, modelagem, fluxo de pagamento)
docs/handoff.md                        este arquivo
docs/api-contract.md                   rotas/formatos que o front consome — sessão 2026-09-05
docs/magalu-setup.md                   como configurar banco e object storage na Magalu Cloud — sessão 2026-09-07
docs/deploy.md                         VM, systemd, Caddy/TLS, deploy por git pull — Magalu Cloud
docs/front-handoff.md                  decisões do front
```

`package.json`: removidos `sequelize`, `sqlite3`, `debug`, `http-errors`, `jade`, `cookie-parser` (nenhum era usado de verdade — resto do boilerplate de blog). Adicionados `mercadopago`, `@aws-sdk/client-s3` (usado contra o Object Storage da Magalu), `multer` e — na migração de 2026-09-07 — `sequelize`, `pg`, `pg-hstore` (o `sequelize` do boilerplate voltou, agora de propósito e com PostgreSQL; `@aws-sdk/client-dynamodb` e `@aws-sdk/lib-dynamodb` saíram).

## Decisões tomadas com o usuário (não óbvias pelo código)

- **Sem controle de estoque** nos itens — só nome/descrição/preço/ativo.
- Pedido guarda **nome + telefone + e-mail** do comprador (e-mail entrou depois, porque o Mercado Pago exige `payer.email`).
- **Pix direto pelo backend**, não Checkout Pro — o QR volta na resposta do `POST /pedidos`.
- **WebSocket**: implementado na sessão 2026-09-05 (parte 3) — ver seção própria acima.
- Banco: **DynamoDB**, multi-tabela simples (Itens/Pedidos/Usuários), sem single-table design (escala pequena não justifica) — ver `core-plan.md` pra detalhe de PK/GSI.

## Bugs encontrados e corrigidos nesta sessão (contexto pra não reintroduzir)

1. **Rejeições assíncronas não tratadas derrubavam o processo inteiro do Node.** Qualquer erro do Dynamo (ex: tabela não existir) matava o servidor. Corrigido com `middlewares/asyncHandler.js` usado em toda rota + error handler central em `gerenciador-fichas-api.js`. **Todo handler novo precisa passar pelo `asyncHandler`.**
2. **`dotenv.config()` era chamado depois de `require('./routes/routes')`** em `gerenciador-fichas-api.js`. Como `dynamoService.js` lê `process.env.AWS_REGION` no carregamento do módulo (nível superior, não dentro de função), a região vinha sempre `undefined` → default errado (`us-east-1` em vez de `sa-east-1`), causando `ResourceNotFoundException` mesmo com as tabelas existindo. **Lição: `dotenv.config()` sempre no topo do arquivo, antes de qualquer outro `require` do projeto.**
3. Erros de negócio (`try/catch`) nos controllers só tratam casos conhecidos (`ConditionalCheckFailedException` etc.) e fazem `throw err` pro resto — não adicionar `catch` genérico que engula erro sem logar, isso já causou uma depuração longa (ver item 4).
4. Erro do Mercado Pago em `createOrder` estava sendo **completamente silenciado** (nenhum log). Corrigido com `console.error` no catch de `orderController.js:66`. Se voltar a mexer nesse trecho, mantenha o log.
5. `handleMercadoPagoWebhook` não tratava falha de `mercadoPagoService.getOrder` (ex: `data.id` de uma notificação de teste/simulador que não existe de verdade) — o erro subia sem catch e virava `500` genérico pro Mercado Pago, que reagia reenviando a notificação. Corrigido em 2026-09-05 com `try/catch` ao redor da chamada, logando o erro e respondendo `200` (webhook é idempotente, um erro nosso não deveria fazer o MP ficar retentando pra sempre).

## Descoberta importante: bug do Mercado Pago na assinatura do webhook de "order" — 2026-09-05

**Não reverta a validação de assinatura do webhook pra "estrita" sem reler isso.** Ao confirmar o webhook de ponta a ponta pela primeira vez (usando ngrok + um pedido real pago via truque `payer.first_name: "APRO"`, que aprova Pix automaticamente em sandbox), a notificação chegava certinho mas **a validação HMAC da assinatura sempre falhava** (`401`) pra notificações reais do tópico `order` com `data.id` alfanumérico (ex: `ORDTST01M1T0H5QJKB2CZ5DX8NXFRKQB`).

Investigação (nessa ordem, pra não repetir):
1. Confirmado que o `MP_WEBHOOK_SECRET` está correto: a **simulação de notificação do próprio painel do Mercado Pago** (com `data.id` numérico fake, tipo `123456`) **validou com sucesso** usando o mesmo secret/código.
2. Testado exaustivamente: `data.id` maiúsculo/minúsculo (a doc do MP menciona que precisa ser lowercase — não fez diferença), manifest com/sem `;` final, id do payment aninhado em vez do id da order, HMAC sobre o corpo cru inteiro. Nada bateu.
3. **Prova definitiva**: rodamos o `WebhookSignatureValidator` oficial do próprio pacote `mercadopago` (SDK oficial, não código nosso) contra a notificação real capturada — **ele também rejeita** (`SignatureFailureReason.SignatureMismatch`). Ou seja, não é bug nosso, é uma inconsistência do lado do Mercado Pago especificamente nas notificações do tópico `order` (API nova, lançada nov/2025 — já tinha outras arestas, ver seção abaixo).
4. Decisão tomada com o usuário: em vez de bloquear o webhook indefinidamente ou esperar o MP corrigir, `middlewares/mercadoPagoWebhookMiddleware.js` **aceita a notificação mesmo com assinatura inválida, mas só pro tópico `order`** (outros tópicos continuam rejeitando com `401` normalmente). Isso não abre brecha de segurança de verdade porque `handleMercadoPagoWebhook` **nunca confiou no corpo da notificação** — sempre busca o status real via `mercadoPagoService.getOrder` (API autenticada com nosso `MP_ACCESS_TOKEN`) antes de mudar qualquer coisa no banco. Um POST forjado nesse endpoint no máximo causa uma chamada redundante à API do MP; não consegue forjar confirmação de pagamento.
5. Sempre que isso acontece, um `console.warn` registra `data.id`/`request-id` no log — se um dia o Mercado Pago corrigir o bug, dá pra voltar a validação estrita removendo o `if (topic !== 'order')` do middleware.
6. **Testado de ponta a ponta com sucesso** depois dessa mudança: pedido criado → Pix aprovado via `APRO` → webhook real chega, assinatura não bate, aceito mesmo assim → `getOrder` confirma `status: processed` → pedido atualizado pra `paid` no banco. Fluxo completo funcionando.

## Descoberta: truque `payer.first_name: "APRO"` funciona (Orders API)

A doc do Mercado Pago menciona um comprador de teste com `first_name: "APRO"` pra simular aprovação automática de pagamento em sandbox. **Confirmado que funciona também na Orders API** (não só na Payments API clássica, que era o que a doc original citava). `mercadoPagoService.createPixOrder` agora aceita um `payerFirstName` opcional, e `orderController.createOrder` já manda o primeiro nome de `buyerName` (`buyerName.split(' ')[0]`) — então basta criar um pedido de teste com `buyerName: "APRO qualquercoisa"` pra o Pix ser aprovado automaticamente em sandbox, sem precisar "pagar" manualmente. Em produção isso não tem efeito nenhum (só funciona com credencial de teste) e nem é um problema — enviar o primeiro nome do comprador pro Mercado Pago é uma boa prática de qualquer forma (ajuda em antifraude do lado deles).

## Descoberta importante: Payments API vs Orders API do Mercado Pago

Isso vale a leitura completa antes de mexer em `mercadoPagoService.js` de novo — está detalhado em `core-plan.md` na seção "Payments API vs Orders API", mas o resumo:

- O plano original mandava usar a **Payments API clássica** (`/v1/payments`). Isso **não funciona mais** com as credenciais de teste que o Mercado Pago gera automaticamente hoje (mudança deles de nov/2025) — toda chamada dava `401 Unauthorized use of live credentials`, mesmo com comprador de teste real e testando métodos diferentes (Pix, boleto).
- A **Orders API** (`/v1/orders`, resource `Order` do SDK) funciona normalmente com a mesma credencial.
- Migração feita: `mercadoPagoService.js` usa `Order`, não `Payment`. Campo renomeado `mpPaymentId` → `mpOrderId` em todo lugar (model, controller). Vocabulário de status também mudou: `processed`/`expired`/`canceled`/`failed` (Orders) em vez de `approved`/`rejected`/`cancelled` (Payments).
- Webhook: o tópico correto no painel do Mercado Pago é **"Order (Mercado Pago)"**, não "Pagamentos". `data.id` da notificação é o id da Order.
- **Restrição do ambiente de teste**: `payer.email` precisa ser uma conta de comprador de teste real do Mercado Pago (criada via `POST /users/test_user`), não um e-mail qualquer nem um e-mail pessoal real — isso gera 400 sem detalhe nenhum na resposta (`error: ''`, `causes: []`, confirmado duas vezes por reprodução direta). **Isso é só uma restrição de sandbox** — em produção, o `buyerEmail` vai ser o e-mail real de cada cliente sem problema.

## Ambiente / infraestrutura atual

- **AWS**: conta `440466198161`, região **`sa-east-1`**, credenciais via AWS CLI local (não estão no `.env` de propósito — o SDK usa a chain default). Tabelas já criadas: `fichas-itens`, `fichas-pedidos`, `fichas-usuarios` (todas `PAY_PER_REQUEST`). Bucket S3 `sistema-feira` (mesma região) pra imagens de item, com leitura pública no prefixo `itens/*` (ver seção acima).
- **Mercado Pago**: credencial de **teste** (auto-gerada, prefixo `APP_USR-` mas é `tags: ["test_user"]` de verdade — confirmado via `/users/me`). Ainda não foi trocada pra produção.
- **`.env`** (não versionado) tem as chaves: `JWT_SECRET`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `AWS_REGION`, `DYNAMO_ENDPOINT` (vazio, não usado), `ITEMS_TABLE`, `ORDERS_TABLE`, `USERS_TABLE`, `S3_BUCKET`. Todas preenchidas (inclusive `MP_WEBHOOK_SECRET`, que o usuário configurou por conta própria depois de cadastrar o webhook no painel do MP, e `S3_BUCKET`, preenchido na sessão de 2026-09-05).
- **ngrok**: instalado via Homebrew, configurado com conta do usuário. Já testado recebendo notificações reais do Mercado Pago (confirmado nos logs — chegou um POST em `/pagamentos/notifications` com `type=order`, ainda não validado com sucesso porque o `MP_WEBHOOK_SECRET` só foi preenchido depois; **não confirmamos ainda que uma notificação passa pela validação de assinatura com sucesso**).
- **Comprador de teste do Mercado Pago criado via API**: `test_user_455430721329702270@testuser.com` (salvo na variável `{{mpTestBuyerEmail}}` do Bruno). Use esse (ou crie outro via `POST /users/test_user`) como `buyerEmail` em qualquer teste de criação de pedido.

### Dados de teste que ficaram nas tabelas (não é preciso limpar, mas é bom saber)

- 4 itens "Coxinha" duplicados (testes sucessivos criaram um novo a cada vez).
- 8 pedidos: 2 `pending` (com `mpOrderId` real de sandbox), 6 `cancelled` (das tentativas que falharam durante o diagnóstico).
- 2 usuários: `teste@igreja.org` (senha `senha123`, criado em teste) e `perodrigues132006@gmail.com` (parece ser o usuário real se registrando pra usar o painel).
- Sessão 2026-09-05: 1 item "Coxinha Teste Upload" criado, atualizado (troca de imagem) e desativado no mesmo teste — já fica `active: false`, não precisa limpar.
- Sessão 2026-09-05 (parte 2 — teste de webhook): 3 pedidos de teste com `buyerName` começando em "APRO". Dois (`b065603c...`, `e0541936...`) ficaram travados em `pending`/`action_required` porque a notificação `processed` do Mercado Pago chegou **antes** da correção do bug de assinatura (foi rejeitada com `401` e o MP não reenviou a tempo); o terceiro (`6a6434af...`) foi criado **depois** da correção e confirmou `paid`/`processed` de ponta a ponta com sucesso. Os dois travados podem ainda virar `paid` sozinhos se o Mercado Pago reenviar a notificação num retry futuro (schedule de backoff deles), ou ficam assim mesmo — é dado de teste, não precisa corrigir manualmente.
- Sessão 2026-09-06 (front): a tabela de pedidos estava em **11 pedidos** (4 `pending`, 1 `paid`, 6 `cancelled`) quando o kanban foi conferido contra ela. Criado 1 item `"Bebidas: Guaraná Lata [teste-front]"` (`1286d925-...`), atualizado e **já desativado** no mesmo teste. Nenhum pedido novo foi criado — o teste do WebSocket usou um `PATCH` idempotente (`cancelled` → `cancelled`) no pedido `0f91b545-...`, que não alterou nada no banco.

## Coleção Bruno (`docs-api/gerenciador-fichas-api/`)

Formato OpenCollection YAML (não é o `.bru` clássico). Environment `local` já configurado com `baseUrl`, `token` (setado automaticamente pelo request "Login"), `itemId` (setado por "Criar item"), `orderId` (setado por "Criar pedido"), `mpOrderId`, `mpTestBuyerEmail`. Fluxo recomendado: Login → Criar item → Criar pedido → (demais requests usam as variáveis salvas automaticamente). O request de webhook em `Pagamentos/` é só referência de formato — não roda de verdade pelo Bruno porque exige assinatura HMAC real.

**Sessão 2026-09-05**: "Criar item" e "Atualizar item" foram convertidos de `body: json` pra `body: multipart-form` (campo `image` com `filepath` vazio — precisa apontar pra um arquivo local antes de rodar, senão o item é criado sem imagem, o que também é válido).

## Próximos passos (em ordem sugerida)

1. ~~Confirmar o webhook de ponta a ponta~~ — **feito em 2026-09-05**. Ver seção "bug do Mercado Pago na assinatura do webhook de 'order'" acima antes de mexer nisso de novo.
2. ~~Investigar como simular aprovação de Pix em sandbox~~ — **feito em 2026-09-05**, truque `payer.first_name: "APRO"` confirmado funcionando na Orders API. Ver seção acima.
3. ~~WebSocket de tempo real pro painel logado~~ — **feito em 2026-09-05 (parte 3)** e ~~validar com um cliente WS de verdade~~ **feito em 2026-09-06** junto com o front. Ver seção própria acima e o contrato em [api-contract.md](api-contract.md#tempo-real--websocket-painel-logado).
4. ~~Front (loja + painel)~~ — **feito em 2026-09-06**, ver [front-handoff.md](front-handoff.md). O que ficou em aberto de propósito está listado lá ("O que **não** foi construído"): cancelar/reabrir pedido pelo painel e reativar item desativado, todos dependendo de decisão de escopo, não de código difícil.
5. **Testar um pedido real de ponta a ponta pelo front** — criar pelo cardápio, pagar o Pix sandbox com o truque `APRO`, e ver o card pular de "Fila total" pra "Pagos" sozinho no painel. As pontas foram testadas separadamente; o caminho completo (loja → webhook → WebSocket → kanban) ainda não foi feito numa tacada só.
6. **Checklist de corte pra produção**: trocar `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` de teste pra produção na mesma aplicação do MP; trocar a URL do webhook de ngrok pra um domínio real (lembrar de atualizar no painel do MP toda vez que o ngrok reiniciar sem domínio reservado — a URL muda); decidir se replica pra outra região AWS ou mantém `sa-east-1`; considerar acompanhar se o Mercado Pago corrige o bug de assinatura do tópico `order` (ver seção acima) antes de ir pra produção de verdade, já que hoje a validação desse tópico está deliberadamente relaxada.
5. Opcional/limpeza: apagar os itens/pedidos/usuários de teste listados acima antes de ir pra produção de verdade.

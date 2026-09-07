# Core funcional: itens, pedidos, auth e pagamento Pix (Mercado Pago) sobre DynamoDB

> **Desatualizado desde 2026-09-07**: as seções de DynamoDB e S3 descrevem a infra antiga (AWS). O projeto migrou pra PostgreSQL/Sequelize + Object Storage na Magalu Cloud — ver [magalu-setup.md](magalu-setup.md). As decisões de modelagem (snapshot dos itens no pedido, soft-delete, e-mail como chave do usuário) continuam valendo; a tecnologia por baixo mudou.

## Contexto

O projeto é um scaffold do Express quase todo vazio: models/controllers vazios ou inexistentes, e as rotas apontam para um `postController` que nunca existiu (resquício de um boilerplate de blog). O app hoje **não sobe** (`gerenciador-fichas-api.js` exige `services/databaseService.js`, que não existe). Sequelize/sqlite também eram resto desse boilerplate e serão removidos — o banco de dados do projeto é o **DynamoDB**.

O objetivo desta etapa é montar a parte funcional (core): cadastro/login, CRUD de itens, criação de pedido com Pix via Mercado Pago e atualização de status via webhook — deixando de fora, por decisão do usuário, o WebSocket de tempo real (entra depois).

Decisões já tomadas com o usuário:
- Banco: DynamoDB (não Sequelize/sqlite).
- Sem controle de estoque nos itens (só nome/descrição/preço/ativo).
- Pedido guarda nome, telefone **e e-mail** do comprador — o e-mail entrou porque o Mercado Pago exige `payer.email` pra criar o pagamento Pix.
- Pagamento: Pix direto pelo backend (não Checkout Pro) — o QR code volta na resposta do `POST /pedidos`, e o webhook só atualiza o status depois que o pagamento é confirmado. **Correção importante (ver seção "Payments API vs Orders API" abaixo): usamos a Orders API do Mercado Pago, não a Payments API clássica.**

## Bugs de fundação corrigidos (bloqueavam o boot)

- `services/databaseService.js` — não existia; recriado como `services/dynamoService.js` (cliente DynamoDB), e `gerenciador-fichas-api.js` atualizado.
- `services/errorService.js` — estava vazio, mas `authMiddleware.js` já chamava `errorService.returnError`, `.tokenNotFound`, `.invalidToken`.
- `routes/itemRoute.js`, `routes/orderRoute.js`, `routes/authRoute.js`, `routes/paymentRoute.js` — todos importavam `../controllers/postController` (inexistente) em vez do controller certo.
- `routes/authRoute.js` — `/register` e `/login` estavam com `authMiddleware` aplicado, impedindo login/cadastro sem já estar logado.
- `routes/paymentRoute.js` — existia mas não estava registrado em `routes.js`, e usava o `authMiddleware` (JWT) como se fosse verificação de assinatura do Mercado Pago.
- `package.json` — removidos `sequelize`/`sqlite3`; script `start` apontava pra `./blog.js`, inexistente (entrypoint real é `gerenciador-fichas-api.js`).

## Modelagem de dados (DynamoDB)

Sem ORM e sem join: cada "model" é um módulo de acesso direto à tabela (repository), usando `@aws-sdk/lib-dynamodb` (DocumentClient — evita lidar com o formato `AttributeValue` cru do SDK base). Três tabelas, uma por entidade — desenho multi-tabela simples, sem necessidade de single-table design pra essa escala:

- **Itens** (`ITEMS_TABLE`) — PK `itemId` (uuid). Atributos: `name`, `description`, `price` (centavos), `active`, `imageKey` (opcional — key do objeto no S3, não a URL; a URL é montada em runtime, ver seção "Upload de imagem (S3)").
- **Pedidos** (`ORDERS_TABLE`) — PK `orderId` (uuid). Atributos: `buyerName`, `buyerPhone`, `buyerEmail`, `status` (`pending`/`paid`/`ready`/`delivered`/`cancelled`), `total`, `items` (lista embutida `[{ itemId, name, unitPrice, quantity }]` — snapshot do item no momento da compra, sem precisar de tabela de junção), `mpOrderId` (id da Order no Mercado Pago), `mpStatus`, `qrCode`, `qrCodeBase64`, `createdAt`.
- **Usuários** (`USERS_TABLE`) — PK `email` (chave natural — elimina a necessidade de índice pra buscar por e-mail no login). Atributos: `passwordHash`.

Consultas:
- Buscar por id (item, pedido, usuário por email) → `GetCommand` direto pela PK, sem índice.
- Listar todos os itens/pedidos (`GET /itens`, `GET /pedidos`) → `ScanCommand`. Pro volume de uma festa (dezenas/centenas de pedidos) um Scan é suficiente e mais simples que manter um GSI — se o volume crescer muito, aí sim vale um GSI por `status`.
- Localizar o pedido a partir da notificação do Mercado Pago → em vez de precisar de um índice por `mpOrderId`, a criação da Order no MP já manda `external_reference = orderId`; o webhook lê isso e faz `GetCommand` direto pela PK.
- IDs gerados com `crypto.randomUUID()` (nativo do Node, sem dependência extra).

Criação das tabelas é feita fora do boot da aplicação (a app não deve gerenciar o próprio schema em runtime): um script único `scripts/createTables.js`, idempotente (verifica se a tabela já existe antes de criar), rodado manualmente via `npm run setup:tables`. Funciona tanto contra AWS DynamoDB real quanto contra DynamoDB Local — o client em `dynamoService.js` usa `DYNAMO_ENDPOINT` se a env var existir (aponta pro Local, ex. `http://localhost:8000`), senão usa a AWS de verdade com região/credenciais do ambiente.

## Services

- `services/dynamoService.js` — cria o `DynamoDBClient` + `DynamoDBDocumentClient` e exporta os nomes das tabelas (lidos de env: `ITEMS_TABLE`, `ORDERS_TABLE`, `USERS_TABLE`, com defaults tipo `fichas-itens`).
- `services/errorService.js` — catálogo pequeno de erros nomeados (`tokenNotFound`, `invalidToken`, `notFound`, `validationError`, `unauthorized`, `conflict`, `internalError`), cada um com `status` + `message`, e `returnError(res, erro)` que faz `res.status(erro.status).json({ message: erro.message })`.
- `services/mercadoPagoService.js` — encapsula o SDK oficial `mercadopago`, usando o resource `Order` (Orders API, `/v1/orders`):
  - `createPixOrder({ amount, orderId, payerEmail, payerFirstName })` → cria a order com `type: 'online'`, `processing_mode: 'automatic'`, `transactions.payments: [{ payment_method: { id: 'pix', type: 'bank_transfer' } }]` e `external_reference: orderId`, devolve `{ mpOrderId, status, qrCode, qrCodeBase64 }` (QR vem de `transactions.payments[0].payment_method`). `payerFirstName` é opcional e vai em `payer.first_name` — em sandbox, usar `"APRO"` aprova o Pix automaticamente (confirmado em 2026-09-05); em produção é só uma boa prática (ajuda antifraude do MP), sem efeito especial.
  - `getOrder(mpOrderId)` → usado pelo webhook pra buscar o status real (nunca confiar só no corpo da notificação).

## Middlewares

- `middlewares/authMiddleware.js` — já existia e já fazia a verificação do JWT (lê `Authorization: Bearer <token>`, valida com `JWT_SECRET`, popula `req.user`). Não foi reescrito, só voltou a funcionar com o `errorService.js` implementado. É esse middleware que protege as rotas logadas: `POST/PUT/DELETE /itens`, `GET /pedidos`, `PATCH /pedidos/:id/status`.
- `middlewares/mercadoPagoWebhookMiddleware.js` — valida o header `x-signature` (HMAC-SHA256 com `MP_WEBHOOK_SECRET`, conforme doc do MP: manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`) antes de deixar a notificação passar. Substitui o uso indevido do `authMiddleware` em `paymentRoute.js` (webhook do MP não é um usuário logado, não deve levar JWT).
  - **Exceção deliberada (2026-09-05)**: quando a assinatura não bate e o tópico da notificação é `order` (`req.query.type === 'order'`), o middleware **loga um aviso e deixa passar mesmo assim**, em vez de responder `401`. Isso existe porque o Mercado Pago tem um bug confirmado na assinatura desse tópico específico com `data.id` alfanumérico — reproduzido até com o `WebhookSignatureValidator` oficial do próprio pacote `mercadopago` rejeitando uma notificação real e legítima. Outros tópicos continuam exigindo assinatura válida normalmente. Essa relaxação é segura porque `orderController.handleMercadoPagoWebhook` nunca confia no corpo da notificação — sempre chama `mercadoPagoService.getOrder` (API autenticada com `MP_ACCESS_TOKEN`) pra confirmar o status real antes de mudar o pedido no banco; um POST forjado nesse endpoint não consegue forjar confirmação de pagamento, no máximo gera uma chamada redundante à API do MP. Detalhe completo da investigação em [handoff.md](handoff.md).

## "Models" (repositories DynamoDB)

- `models/userModel.js` — `createUser({ email, passwordHash })` (`PutCommand`, `ConditionExpression` pra não sobrescrever e-mail já existente), `getUserByEmail(email)` (`GetCommand`).
- `models/itemModel.js` — `createItem(data)` (aceita `itemId` opcional, gerado pelo controller quando há upload de imagem, pra a key do S3 já nascer alinhada ao id do item), `getAllItems({ onlyActive })` (`ScanCommand` + filtro), `getItemById(id)`, `updateItem(id, data)` (só toca o atributo `imageKey` no Dynamo quando `imageKey !== undefined`, pra não apagar a imagem existente em updates sem nova imagem), `deactivateItem(id)` (`UpdateCommand` setando `active=false` — soft-delete, pra não quebrar pedidos antigos que referenciam o item embutido).
- `models/orderModel.js` — `createOrder(data)`, `getAllOrders({ status })` (`ScanCommand` + filtro opcional), `getOrderById(id)`, `updateOrderStatus(id, status)`, `updateOrderPayment(id, { mpOrderId, mpStatus, qrCode, qrCodeBase64, status })`.

## Controllers

- `userController.js` — `register` (bcrypt hash + `userModel.createUser`), `login` (busca por email, compara hash, assina JWT com `JWT_SECRET`).
- `itemController.js` — `createItem`, `getAllItems` (sempre `active=true`, rota é pública), `getItemById`, `updateItem`, `deleteItem` (soft-delete via `deactivateItem`).
- `orderController.js`:
  - `createOrder` — recebe `{ buyerName, buyerPhone, buyerEmail, items: [{ itemId, quantity }] }`; busca cada item no banco (nunca confia em preço vindo do front), monta a lista embutida com preço/nome no momento da compra, calcula o total, cria o pedido (status `pending`), chama `mercadoPagoService.createPixOrder` (passando `payerFirstName: buyerName.split(' ')[0]`), salva `mpOrderId`/QR via `updateOrderPayment` e devolve o pedido com o QR pro front renderizar. Se a chamada ao Mercado Pago falhar, o pedido é marcado `cancelled`.
  - `getAllOrders` — logado, lista pedidos (com filtro opcional por `status` via querystring).
  - `getOrderById` — público (o id do pedido funciona como token de acesso do próprio cliente pra acompanhar o status).
  - `updateOrderStatus` — logado, transições manuais (`paid → ready → delivered`, ou `cancelled`).
  - `handleMercadoPagoWebhook` — lê o `data.id` (id da Order) da notificação, busca a order real via `mercadoPagoService.getOrder` (que retorna o `external_reference` = `orderId`) — envolto em `try/catch`: se a busca falhar (ex: `data.id` de uma notificação de teste/simulador que não existe de verdade), loga o erro e responde `200` em vez de deixar o erro subir como `500`. Atualiza o pedido — idempotente (só processa se o pedido ainda estiver `pending`). Mapeia status da Orders API pro nosso: `processed → paid`, `expired`/`canceled`/`failed → cancelled`.

## Rotas

- `authRoute.js` — sem `authMiddleware` em `/register` e `/login`.
- `itemRoute.js` — CRUD de itens (create/update/delete logados, list/get públicos).
- `orderRoute.js`:
  - `POST /` — público → `createOrder`.
  - `GET /` — logado → `getAllOrders`.
  - `GET /:id` — público → `getOrderById`.
  - `PATCH /:id/status` — logado → `updateOrderStatus`.
- `paymentRoute.js` — `POST /notifications` usa `mercadoPagoWebhookMiddleware` → `handleMercadoPagoWebhook`.
- `routes.js` — registra `app.use('/pagamentos', paymentRoute)`.

## Config

- `.env` (não versionado, ver `.env.example`): `JWT_SECRET`, `MP_ACCESS_TOKEN` (credencial de teste do Mercado Pago), `MP_WEBHOOK_SECRET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (ou `DYNAMO_ENDPOINT` se for usar DynamoDB Local em dev), `ITEMS_TABLE`, `ORDERS_TABLE`, `USERS_TABLE`, `S3_BUCKET` (bucket de imagens dos itens, ver seção "Upload de imagem (S3)").
- `package.json`: `sequelize`/`sqlite3` removidos; `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `mercadopago`, `@aws-sdk/client-s3` e `multer` adicionados; `"start": "node gerenciador-fichas-api.js"`; `"setup:tables": "node scripts/createTables.js"`.

## Payments API vs Orders API (correção feita durante o teste)

O plano original mandava chamar a **Payments API** clássica do Mercado Pago (`POST /v1/payments`, resource `Payment` do SDK). Isso quebrou no primeiro teste real com a credencial de teste (`APP_USR-...`, gerada automaticamente pelo painel — o Mercado Pago mudou o fluxo de credenciais de teste e o prefixo `TEST-` não é mais garantia de nada): toda chamada a `/v1/payments` devolvia `401 Unauthorized use of live credentials`, **mesmo com um comprador de teste real** (criado via `POST /users/test_user`) e **em qualquer método de pagamento** (testamos Pix e boleto, os dois falharam igual).

Diagnóstico: chamando a **Orders API** (`POST /v1/orders`, resource `Order` do SDK) com a mesma credencial, funcionou de primeira e devolveu QR code de sandbox de verdade. Conclusão: as credenciais de teste geradas automaticamente pelo Mercado Pago (fluxo lançado em nov/2025) só são autorizadas na Orders API — a Payments API clássica trata esse tipo de credencial como não autorizada, independente do payment method ou do payer.

Por isso `mercadoPagoService.js`, `orderModel.js` e `orderController.js` usam a Orders API (`mpOrderId` em vez de `mpPaymentId`, vocabulário de status `processed`/`expired`/`canceled`/`failed` em vez de `approved`/`rejected`/`cancelled`). O webhook também muda: `type: "order"` (não `"payment"`), e `data.id` é o id da Order.

## Upload de imagem (S3) — adicionado em 2026-09-05

Itens podem ter uma imagem opcional, enviada junto com `POST /itens` e `PUT /itens/:id` (que passaram de `application/json` pra `multipart/form-data`, campo `image`). Decisão tomada com o usuário: a imagem é servida por **URL pública fixa do S3**, não por URL assinada (presigned) — como são fotos de cardápio vistas por qualquer visitante sem login, uma URL fixa e cacheável é mais simples que gerenciar expiração, e não exige que o front peça uma URL nova a cada exibição.

- `middlewares/uploadImageMiddleware.js` — `multer` com `memoryStorage` (não grava em disco temporário), `limits.fileSize` 5MB, `fileFilter` só aceita mimetype `image/*` (fora isso, o multer simplesmente não popula `req.file` — não é tratado como erro de validação, então um upload de tipo errado hoje é equivalente a não enviar imagem nenhuma; se isso for um problema no futuro, dá pra fazer o `fileFilter` chamar `cb(new Error(...))` pra virar um 400 explícito).
- `services/s3Service.js` — encapsula `@aws-sdk/client-s3`:
  - `uploadItemImage(itemId, file)` → `PutObjectCommand`, key `itens/<itemId>/<uuid>.<extensão original>`. Devolve a key (não a URL).
  - `deleteItemImage(key)` → `DeleteObjectCommand`, usado só quando um item que já tinha imagem recebe uma nova (evita acumular órfãos no bucket).
  - `buildImageUrl(key)` → monta `https://<S3_BUCKET>.s3.<AWS_REGION>.amazonaws.com/<key>` (string pura, sem chamada de rede — por isso pode ser usada em todo `GET`/response sem custo). Devolve `null` se não houver `imageKey`.
- `itemController.js`:
  - `createItem` — gera o `itemId` no controller (antes só o model gerava), assim consegue subir a imagem pro S3 usando o mesmo id antes de gravar no Dynamo; se não vier `req.file`, `imageKey` fica `undefined` e o item nasce sem imagem.
  - `updateItem` — se vier `req.file`, busca o item atual pra saber a `imageKey` anterior, sobe a nova imagem, grava o item com a `imageKey` nova e só então apaga a antiga do S3 (ordem importa: nunca apagar antes de confirmar que a nova subiu).
  - Toda resposta de item (`createItem`, `getAllItems`, `getItemById`, `updateItem`) passa por um helper `withImageUrl` que anexa `imageUrl` calculada a partir de `imageKey`. `deleteById` (soft-delete) não precisa disso porque não expõe o item pro cliente final.
- **Infra que não é gerenciada por código** (feita manualmente pelo usuário no console AWS): bucket S3 dedicado (`sistema-feira`, região `sa-east-1` — mesma da conta/DynamoDB), com "Block Public Access" desabilitado e uma bucket policy de leitura pública restrita ao prefixo `itens/*`:
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
  A mesma credencial AWS local usada pro DynamoDB (chain default do SDK) precisa de `s3:PutObject`/`s3:DeleteObject` nesse bucket — já confirmado que tem.
- Env var nova: `S3_BUCKET` (nome do bucket, sem `s3://` nem barra final).
- **Testado de ponta a ponta contra AWS real**: criação de item com imagem (confirmado objeto no S3 e `imageUrl` retornando HTTP 200 sem autenticação), atualização trocando a imagem (confirmado `head-object` na key antiga devolvendo 404 depois da troca), listagem e busca por id devolvendo `imageUrl` (e `null` pros itens sem imagem, criados antes dessa mudança).

## Verificação

- `npm install` e `npm run setup:tables` (cria as 3 tabelas, idempotente) e `npm start` — servidor precisa subir sem erro.
- Fluxo manual via curl/Postman:
  1. `POST /auth/register` e `POST /auth/login` → recebe JWT.
  2. `POST /itens` (com JWT) cria um item; `GET /itens` (sem JWT) lista só os ativos.
  3. `POST /pedidos` (sem JWT) com um item do passo anterior, usando um `buyerEmail` de comprador de teste real do Mercado Pago (ver seção acima) → resposta deve trazer `qrCode`/`qrCodeBase64` reais vindos do Mercado Pago (usando credencial de teste).
  4. `GET /pedidos/:id` (sem JWT) → mostra status `pending`.
  5. `GET /pedidos` (sem JWT) → deve dar 401; com JWT → lista o pedido criado.
  6. Simular notificação em `POST /pagamentos/notifications` (assinatura válida) → status do pedido muda pra `paid`; repetir a mesma notificação não deve duplicar nada.
  7. `PATCH /pedidos/:id/status` (com JWT) → avança pra `ready`/`delivered`.
- Teste end-to-end do webhook real exige URL pública (ngrok) — necessário antes de testar com o Mercado Pago de verdade, mas não bloqueia o restante do core.

## Pendências (fora do escopo desta etapa)

- ~~WebSocket de tempo real pro painel logado~~ — implementado em 2026-09-05, ver [handoff.md](handoff.md).
- Precisa de tabelas DynamoDB provisionadas (rodar `npm run setup:tables`) e credenciais AWS/Mercado Pago configuradas em `.env` antes de rodar de ponta a ponta.

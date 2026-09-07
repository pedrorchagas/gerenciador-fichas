# API contract — o que o front precisa saber pra consumir essa API

Não é um contrato formal (sem OpenAPI/Swagger ainda) — é o documento de referência com tudo que quem for construir o front precisa saber: rotas, autenticação, formato de request/response, erros e o fluxo esperado. Pra contexto de arquitetura/decisões de banco, veja [core-plan.md](core-plan.md); pra histórico de sessões, veja [handoff.md](handoff.md).

Última atualização: 2026-09-05.

## Visão geral

- **Base URL**: `http://localhost:3000` em dev (porta fixa em `gerenciador-fichas-api.js`, ainda não vem de env var). Em produção, será a URL pública do servidor — a definir.
- **Formato**: JSON em quase tudo. As únicas exceções são `POST /itens` e `PUT /itens/:id`, que são `multipart/form-data` (por causa do upload de imagem).
- **Autenticação**: JWT via header `Authorization: Bearer <token>`, obtido em `POST /auth/login`. Rotas que exigem login estão marcadas como **logado** abaixo; o restante é público (sem header nenhum).
- **Duas "áreas" da aplicação**:
  - **Pública** (loja): listar itens, montar pedido, ver QR Pix, acompanhar status do próprio pedido.
  - **Logada** (painel do operador da igreja): cadastrar/editar itens, listar todos os pedidos, avançar status manualmente.
- **Tempo real (painel logado)**: WebSocket via Socket.IO, anexado ao mesmo servidor HTTP (mesma porta/host da REST). Ver seção "Tempo real — WebSocket" abaixo. O cliente final (loja) continua sem WebSocket — acompanha o próprio pedido via poll em `GET /pedidos/:id`.

## Erros

Todo erro de negócio (validação, não encontrado, não autorizado, conflito) segue o mesmo formato:

```json
{ "message": "Descrição curta do erro.", "details": "opcional, mais contexto" }
```

Códigos HTTP usados: `400` (validação), `401` (sem token / token inválido / credenciais erradas), `404` (não encontrado), `409` (conflito, ex: e-mail já cadastrado), `500` (erro interno — algo quebrou no servidor, não é erro de request). Erro de rede/servidor fora do ar deve ser tratado separadamente pelo front (essa API não tem um formato específico pra isso).

## Autenticação

### `POST /auth/register`

Cria um usuário do painel (operador da igreja). Público, mas **protegido por uma senha de convite**: quem não souber o `registerSecret` não cria conta.

Request:
```json
{ "email": "operador@igreja.org", "password": "senha123", "registerSecret": "<senha de convite>" }
```

O `registerSecret` é comparado com a variável de ambiente `REGISTER_SECRET` do servidor. Erros: `401` (`"Senha de cadastro inválida."`) se não bater; `500` se o servidor estiver sem `REGISTER_SECRET` configurado — nesse caso **ninguém** consegue se cadastrar (falha fechada de propósito, pra um `.env` incompleto não deixar o painel aberto).

Response `201`:
```json
{ "email": "operador@igreja.org", "passwordHash": "..." }
```
> O front não deveria precisar exibir `passwordHash` — é um retorno cru do banco, não filtrado. Ignorar esse campo na resposta.

Erros: `400` se faltar `email`/`password`; `409` se o e-mail já existir.

### `POST /auth/login`

Público.

Request:
```json
{ "email": "operador@igreja.org", "password": "senha123" }
```

Response `200`:
```json
{ "token": "eyJhbGciOi..." }
```

Token expira em **12h** (`expiresIn: '12h'`). Não há refresh token — expirado, o usuário precisa logar de novo. Erros: `400` (faltando campo), `401` (e-mail não existe ou senha errada — mesma mensagem genérica pros dois casos, por segurança).

## Itens

Sem controle de estoque — um item é só nome, descrição, preço e (opcional) imagem.

### `GET /itens` — público

Lista só os itens **ativos** (`active: true`). Sem paginação, sem filtro por querystring.

Response `200`:
```json
[
  {
    "itemId": "a0dffa6b-...",
    "name": "Coxinha",
    "description": "Coxinha de frango",
    "price": 500,
    "active": true,
    "imageKey": "itens/a0dffa6b-.../3bde29fb-....png",
    "imageUrl": "https://br-se1.magaluobjects.com/sistema-feira/itens/a0dffa6b-.../3bde29fb-....png"
  }
]
```

- **`price` é em centavos** (500 = R$ 5,00) — front formata pra exibição.
- **`imageUrl`** é `null` quando o item não tem imagem — trate esse caso (placeholder, etc). É uma URL pública fixa, não expira, dá pra usar direto em `<img src>` sem headers extras.
- `imageKey` também vem no payload (é o identificador interno no object storage) — o front não precisa usar isso pra nada, só ignorar.

### `GET /itens/:id` — público

Mesmo formato de item acima, `404` se não existir. Não filtra por `active` — mesmo um item desativado pode ser buscado por id diretamente (mas não aparece na listagem).

### `POST /itens` — logado

`Content-Type: multipart/form-data`. Campos:

| Campo | Tipo (no form) | Obrigatório | Observação |
|---|---|---|---|
| `name` | texto | sim | |
| `description` | texto | não | |
| `price` | texto (número em string) | sim | Em **centavos**. Ex: `"500"` pra R$ 5,00. |
| `image` | arquivo | não | Qualquer `image/*`, até 5MB. Fora disso, o arquivo é ignorado silenciosamente (item é criado sem imagem, sem erro). |

Response `201`: item criado, mesmo formato do `GET`, incluindo `imageUrl` já calculada se enviou imagem.

Erro `400` se faltar `name` ou `price` não for número.

Exemplo com `fetch` (browser):
```js
const form = new FormData();
form.append('name', 'Coxinha');
form.append('description', 'Coxinha de frango');
form.append('price', '500');
form.append('image', fileInput.files[0]); // opcional

await fetch(`${baseUrl}/itens`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` }, // NÃO setar Content-Type manualmente, o browser define o boundary
  body: form,
});
```

### `PUT /itens/:id` — logado

Mesmo formato de campos do `POST`. `name` e `price` são **sempre obrigatórios no PUT** (é uma substituição completa dos dados, não um patch parcial). `image` é opcional:
- **Sem `image`**: mantém a imagem atual (`imageKey` não é tocado).
- **Com `image`**: sobe a nova, apaga a antiga do object storage, `imageUrl` muda na resposta.

Response `200`: item atualizado. Erro `404` se o item não existir, `400` se faltar `name`/`price`.

### `DELETE /itens/:id` — logado

Soft-delete: seta `active: false`. O item continua existindo (pedidos antigos que o referenciam não quebram), só some do `GET /itens` público. Response `200` com o item atualizado. `404` se não existir.

## Pedidos

Status possíveis: `pending` → `paid` → `ready` → `delivered`, ou `cancelled` a qualquer momento antes de `delivered`.

- `pending`: pedido criado, aguardando confirmação do Pix.
- `paid`: pagamento confirmado (via webhook do Mercado Pago).
- `ready`: item(s) separado(s), pronto pra entrega (transição manual do operador).
- `delivered`: entregue ao cliente (transição manual do operador).
- `cancelled`: cancelado (pagamento falhou/expirou, ou cancelamento manual).

### `POST /pedidos` — público

Cria o pedido e já gera o QR Pix. **O carrinho é montado pelo front** (fora desta API) — aqui só se manda o resultado final.

Request:
```json
{
  "buyerName": "Maria Silva",
  "buyerPhone": "11999998888",
  "buyerEmail": "maria@example.com",
  "items": [
    { "itemId": "a0dffa6b-...", "quantity": 2 },
    { "itemId": "b1eefb7c-...", "quantity": 1 }
  ]
}
```

- **Preço não é enviado pelo front** — a API busca o preço real de cada `itemId` no banco no momento da criação (nunca confia em preço vindo do cliente).
- **`buyerEmail` importa de verdade**: o Mercado Pago exige `payer.email` pra gerar o Pix. Em produção é o e-mail real do comprador; em ambiente de sandbox/teste, precisa ser um e-mail de comprador de teste do Mercado Pago (ver [handoff.md](handoff.md)) — um e-mail pessoal comum falha com `400` sem detalhe.

Response `201`:
```json
{
  "orderId": "c2ffgc8d-...",
  "buyerName": "Maria Silva",
  "buyerPhone": "11999998888",
  "buyerEmail": "maria@example.com",
  "items": [
    { "itemId": "a0dffa6b-...", "name": "Coxinha", "unitPrice": 500, "quantity": 2 }
  ],
  "total": 1500,
  "status": "pending",
  "mpOrderId": "...",
  "mpStatus": "action_required",
  "qrCode": "00020126...copia-e-cola-do-pix...",
  "qrCodeBase64": "iVBORw0KGgo...",
  "createdAt": "2026-09-05T12:00:00.000Z"
}
```

- **`qrCode`**: string "copia e cola" do Pix — front pode mostrar como texto/botão de copiar.
- **`qrCodeBase64`**: imagem do QR code já em base64 (sem prefixo `data:image/...`) — front deve renderizar como `<img src="data:image/png;base64,${qrCodeBase64}">`.
- **`items` na resposta é um snapshot** (nome/preço no momento da compra) — não é o mesmo objeto do catálogo, não tem `imageUrl`. Se o front precisar mostrar imagem do item no resumo do pedido, precisa cruzar com os dados já carregados de `GET /itens`.

Erros: `400` (campos faltando, item inexistente/inativo, quantidade inválida), `500` com mensagem `"Falha ao gerar pagamento Pix."` se o Mercado Pago falhar (o pedido é criado mas marcado `cancelled` — o front deve tratar como "não foi possível gerar o Pix, tente novamente").

### `GET /pedidos/:id` — público

O `orderId` funciona como uma espécie de token de acesso do próprio cliente — qualquer um que tenha o id vê o pedido (não tem outra checagem de dono). **É essa rota que o front usa pra fazer polling e saber quando o status virou `paid`.**

Response `200`: mesmo formato do `POST /pedidos`. `404` se não existir.

### `GET /pedidos` — logado

Lista todos os pedidos (painel do operador). Aceita filtro opcional por querystring: `GET /pedidos?status=pending`. Sem paginação.

Response `200`: array de pedidos, mesmo formato acima.

### `PATCH /pedidos/:id/status` — logado

Avança o status manualmente (usado pelo painel depois que o pagamento já está `paid`).

Request:
```json
{ "status": "ready" }
```

Valores aceitos: `pending`, `paid`, `ready`, `delivered`, `cancelled` (a API não valida se a transição faz sentido — ex: nada impede voltar de `delivered` pra `pending` hoje; a responsabilidade de só oferecer transições coerentes na UI é do front).

Response `200`: pedido atualizado. `404` se não existir, `400` se `status` não for um dos valores válidos.

## Tempo real — WebSocket (painel logado)

Socket.IO, mesmo host/porta da API REST (`http://localhost:3000` em dev). Só o painel (logado) usa isso — a loja pública continua fazendo poll em `GET /pedidos/:id`.

### Conectar e autenticar

Autenticação via JWT no handshake (mesmo token do `POST /auth/login`), não por header:

```js
import { io } from 'socket.io-client';

const socket = io(baseUrl, {
  auth: { token }, // o mesmo JWT usado no Authorization: Bearer
});

socket.on('connect_error', (err) => {
  // err.message: "Token não informado." ou "Token inválido ou expirado."
});
```

Token ausente ou inválido/expirado → a conexão é recusada (`connect_error`), o socket não conecta. Não há reconexão automática de token: se o JWT expirar (12h) enquanto o socket está conectado, a conexão já estabelecida continua aberta (a checagem é só no handshake) — mas ao reconectar (ex: queda de rede) com o token expirado, a nova conexão será recusada. Front deve tratar isso como "sessão expirada, logue de novo".

### Evento `pedidoAtualizado`

Emitido pro servidor inteiro (broadcast, sem salas) toda vez que um pedido é criado ou muda de status — cobre os três pontos: `POST /pedidos` (criação), o webhook do Mercado Pago (`pending → paid`/`cancelled`) e `PATCH /pedidos/:id/status` (transição manual). Payload é o pedido completo, mesmo formato do `GET /pedidos`:

```js
socket.on('pedidoAtualizado', (order) => {
  // order.orderId, order.status, etc — mesmo shape do GET /pedidos/:id
  // front faz upsert na lista local pelo orderId (id novo = insere, id existente = substitui)
});
```

Não existe um evento de remoção — pedidos nunca são apagados, só mudam de status (inclusive `cancelled`), então upsert é suficiente.

## Pagamentos (webhook — não é consumido pelo front)

`POST /pagamentos/notifications` é chamado pelo **Mercado Pago**, não pelo front. Documentado aqui só pra completude — o front não precisa integrar com essa rota, só precisa dar poll em `GET /pedidos/:id` até o `status` mudar pra `paid` (o webhook é quem faz essa transição acontecer no backend).

## Fluxo esperado — loja (cliente final)

1. `GET /itens` → renderiza catálogo (usar `imageUrl`, com placeholder se `null`).
2. Cliente monta carrinho **no front** (fora desta API).
3. `POST /pedidos` com os itens do carrinho → recebe `qrCode`/`qrCodeBase64`.
4. Mostra o QR pro cliente pagar.
5. Faz polling em `GET /pedidos/:id` (sugestão: a cada poucos segundos) até `status` virar `paid` (ou `cancelled`, pra avisar que falhou) — isso deixa de ser necessário quando o WebSocket for implementado.

## Fluxo esperado — painel (operador logado)

1. `POST /auth/login` → guarda o `token` (ex: em memória / storage do app).
2. CRUD de itens: `POST`/`PUT`/`DELETE /itens` (sempre com o header `Authorization`), incluindo upload/troca de imagem.
3. `GET /pedidos` (com filtro por `status` se quiser abas tipo "Pendentes"/"Prontos") pra ver os pedidos.
4. `PATCH /pedidos/:id/status` pra mover `paid → ready → delivered` conforme o andamento físico da entrega.

## O que ainda não existe (não depender disso)

- Paginação em qualquer listagem.
- Refresh token / logout no servidor (logout é só o front descartar o token).
- Endpoint de upload de imagem avulso (a imagem só é enviada junto com criação/edição do item, não tem uma rota `POST /itens/:id/imagem` separada).

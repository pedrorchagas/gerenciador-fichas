# Gerenciador de fichas

Sistema de pedidos e pagamento por Pix para a festa beneficente de uma igreja.
Substitui a ficha de papel: o cliente monta o pedido no celular, paga o Pix e
recebe um número; o operador vê o pedido cair num quadro em tempo real e
acompanha até a entrega.

Rodou em produção na festa de **7 a 12 de setembro de 2026**.

## Resultado em produção

| | |
|---|---|
| Pedidos pagos | **91** |
| Arrecadado | **R$ 2.860,70** |
| Ticket médio | R$ 31,44 |
| Maior pedido | R$ 164,70 |
| Período | 07/09 17h41 → 12/09 22h17 |

Por categoria (só pedidos pagos):

| Categoria | Unidades | Receita |
|---|---:|---:|
| Hambúrgueres | 18 | R$ 552,20 |
| Churrasquinho | 41 | R$ 410,00 |
| Bebidas | 67 | R$ 391,00 |
| Batata Frita | 18 | R$ 242,00 |
| Crepes | 21 | R$ 240,00 |
| Arroz Carreteiro | 16 | R$ 240,00 |
| Pamonha | 18 | R$ 226,00 |
| Bingo | 41 | R$ 205,00 |
| Brinquedos | 17 | R$ 170,00 |
| Feijão Tropeiro | 12 | R$ 120,00 |
| Picolés | 19 | R$ 62,00 |

Números extraídos com [`scripts/relatorio-festa.sql`](scripts/relatorio-festa.sql)
(`psql "$DATABASE_URL" -f scripts/relatorio-festa.sql`).

## Como funciona

```
Cliente (celular)                    Operador (balcão)
      │                                     │
   cardápio                              kanban
      │  POST /pedidos                       ↑ Socket.IO: pedidoAtualizado
      ▼                                      │
  QR Pix ──> Mercado Pago ──webhook──> status = paid
```

**Loja pública** — cardápio por categorias, carrinho no `localStorage`, pedido
gera QR code Pix de verdade na resposta do `POST /pedidos`, e a tela faz poll
até o pagamento confirmar. Sem login.

**Painel do operador** — login JWT, quadro kanban de quatro colunas
(`pending → paid → ready → delivered`) que se move sozinho via WebSocket, busca
pelo nº da ficha, e CRUD do cardápio com upload de foto.

O nº da ficha são os 5 últimos caracteres do `orderId` em maiúsculas — curto o
bastante pra gritar no balcão, e a API não precisou de sequência.

## Stack

Node + Express · PostgreSQL via Sequelize · Socket.IO · Mercado Pago (Orders
API, Pix) · Object Storage da Magalu (compatível com S3, mesmo
`@aws-sdk/client-s3`) · front em **HTML/CSS/JS puro** — sem framework, sem build
step, sem CDN de biblioteca.

Tudo numa VM só: um processo Node atrás do Caddy, Postgres em `localhost`.
Nada de Docker, PM2 ou cluster — o `io.emit` é local ao processo, então escalar
horizontalmente quebraria o tempo real em silêncio ([deploy.md](docs/deploy.md#9-uma-instância-só)).

## Rodar local

```bash
npm ci
cp .env.example .env    # preencha: JWT_SECRET, REGISTER_SECRET, Mercado Pago, DATABASE_URL, bucket
npm run setup:tables    # sequelize.sync(), idempotente
npm run smoke           # valida banco + object storage de ponta a ponta e limpa o que criou
npm start
```

- Loja → <http://localhost:3000/>
- Painel → <http://localhost:3000/painel.html>

O front é servido pelo próprio Express. É de propósito: a API não manda header
`Access-Control-*` nenhum, e servir pela mesma origem resolve CORS e o WebSocket
de uma vez.

```bash
node front/test.js   # 61 asserções da lógica pura (categorias, esteira, busca, formatação)
npx eslint .         # airbnb-base no backend (front fica de fora, é código de browser)
```

Coleção Bruno pra bater na API na mão em [`docs-api/`](docs-api/) — o request
"Login" já salva o token nas variáveis do environment.

## Documentação

Escrita durante o desenvolvimento, não depois. Cada documento registra **o que
foi decidido e por quê**, incluindo o que deu errado:

| | |
|---|---|
| [`docs/handoff.md`](docs/handoff.md) | Visão geral, histórico de sessões, bugs e descobertas. **Comece por aqui.** |
| [`docs/api-contract.md`](docs/api-contract.md) | Rotas, formatos, erros, contrato do WebSocket |
| [`docs/core-plan.md`](docs/core-plan.md) | Arquitetura e modelagem (parte de infra é histórica — ver aviso no topo) |
| [`docs/front-handoff.md`](docs/front-handoff.md) | Decisões do front, design, armadilhas |
| [`docs/magalu-setup.md`](docs/magalu-setup.md) | Banco e Object Storage na Magalu Cloud |
| [`docs/deploy.md`](docs/deploy.md) | VM, systemd, TLS, deploy por `git pull`, backup |
| [`front/README.md`](front/README.md) | Como rodar o front e o detalhe de cada tela |

## Decisões que valem a leitura antes de mexer

- **Orders API, não Payments API.** As credenciais de teste que o Mercado Pago
  gera hoje devolvem `401 Unauthorized use of live credentials` em `/v1/payments`
  — em qualquer método de pagamento. `/v1/orders` funciona com a mesma
  credencial. Detalhe em [core-plan.md](docs/core-plan.md#payments-api-vs-orders-api-correção-feita-durante-o-teste).
- **A validação de assinatura do webhook está relaxada só pro tópico `order`**,
  por um bug do próprio Mercado Pago — o `WebhookSignatureValidator` oficial
  deles rejeita notificações reais e legítimas. Não é brecha: o status nunca vem
  do corpo da notificação, é sempre reconsultado na API autenticada antes de
  mudar o pedido. [Investigação completa](docs/handoff.md#descoberta-importante-bug-do-mercado-pago-na-assinatura-do-webhook-de-order--2026-09-05).
- **Preço nunca vem do front.** O `POST /pedidos` recebe `itemId` + `quantity` e
  busca o preço no banco. Valores em centavos, em todo lugar.
- **O pedido guarda um snapshot dos itens** (`items` em JSONB) — editar ou
  desativar um item não reescreve o histórico de quem já comprou.
- **Soft-delete nos itens**, pelo mesmo motivo.
- **Categoria é prefixo no `name`** (`"Bebidas: Guaraná Lata"`). A API não tem
  campo de categoria; o operador nunca digita o prefixo, o front junta e separa
  em um único ponto (`splitCategory`/`joinCategory` em `core.js`).
- **`dotenv.config()` no topo do entrypoint**, antes de qualquer `require` do
  projeto — os services leem `process.env` no carregamento do módulo.
- **Toda rota async passa pelo `asyncHandler`.** Sem isso, uma rejeição não
  tratada derruba o processo inteiro.

## Como foi construído

Desenvolvido com auxílio de IA (Claude, via Claude Code), mas com o processo
invertido em relação ao "pede e aceita": engenharia de requisitos antes de
qualquer código, uma abstração de *spec-driven development*, a estrutura inicial
de pastas e arquivos criada por mim, linter configurado desde o começo, e uma
stack que eu já conheço e consigo manter. Tudo que foi gerado passou por
revisão minha antes de entrar.

O resultado disso está nos documentos acima: cada decisão não óbvia tem um "por
quê" escrito ao lado, e os becos sem saída (a Payments API, o bug de assinatura
do webhook, o `403` do Object Storage) estão registrados com a investigação
inteira — pra ninguém, humano ou agente, refazer o caminho.

## Licença

Sem licença definida. Código de um projeto real de uma festa beneficente,
publicado como referência.

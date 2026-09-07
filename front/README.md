# Front — Festa Beneficente

HTML/CSS/JS puro. Sem framework, sem build step, sem `npm install`, sem CDN de
biblioteca. Consome a API descrita em [`../docs/api-contract.md`](../docs/api-contract.md).

```
front/
  index.html          loja pública — cardápio, carrinho, Pix, acompanhamento
  painel.html         área logada — kanban de pedidos + CRUD do cardápio
  assets/base.css     tokens e componentes compartilhados (a identidade)
  assets/core.js      fetch, auth, formatação, categorias, esteira, ícones
  assets/loja.css     assets/loja.js     loja
  assets/painel.css   assets/painel.js   painel
  test.js             auto-teste da lógica pura — `node front/test.js`
```

## Como rodar

O front é servido pela **própria API**. É a única forma que não esbarra em
CORS: a API de hoje não manda nenhum header `Access-Control-*`, então um front
em outra origem (`file://`, Live Server na 5500) tem toda requisição bloqueada
pelo navegador.

Isso exigiu **uma linha fora de `front/`**, em `gerenciador-fichas-api.js`, ao
lado do `express.static` que já existia:

```js
app.use(express.static(path.join(__dirname, 'front')));
```

Depois, `npm start`:

- loja → <http://localhost:3000/>
- painel → <http://localhost:3000/painel.html>

Mesma origem também resolve o WebSocket: `painel.js` carrega o cliente do
Socket.IO de `<API_BASE>/socket.io/socket.io.js`, servido pelo próprio servidor
já na versão certa — sem CDN e sem risco de versão trocada.

Se um dia o front for hospedado em outro domínio, a alternativa é habilitar
CORS na API (`npm i cors` + `app.use(cors())`) e alinhar a origem com a do
Socket.IO, hoje em `origin: '*'`.

### Apontar para outra API

`API_BASE` é a origem da página. Para trocar sem editar arquivo, no console do
navegador:

```js
localStorage.setItem('fichas:apiBase', 'https://api.suafesta.org');
```

## Categorias — a única divergência com a spec

A spec pede o cardápio dividido em categorias populadas dinamicamente pela API.
**O contrato não tem campo de categoria**: `GET /itens` devolve só `itemId`,
`name`, `description`, `price`, `active`, `imageKey`, `imageUrl`.

Convenção acordada, sem tocar no backend: **a categoria é um prefixo no próprio
`name`**, separado por `:`.

```
"Bebidas: Guaraná Lata"   → seção BEBIDAS, item "Guaraná Lata"
"Pipoca"                  → seção OUTROS
```

O operador nunca digita esse prefixo na mão — o formulário de item tem um campo
**Categoria** separado (com autocomplete das categorias já existentes) e
`core.js` junta os dois antes do `POST`/`PUT`. Seções saem em ordem alfabética,
com "Outros" sempre por último.

Se um dia a API ganhar um campo `category` de verdade, o ponto de troca é
`splitCategory` / `joinCategory` em `core.js` — nada mais lê o prefixo.

## Loja (`index.html`)

Rotas por hash: `#/` (cardápio) e `#/ficha/<orderId>`.

`GET /itens` → carrinho montado no front (`localStorage`) → `POST /pedidos` →
QR code + copia-e-cola → poll em `GET /pedidos/:id` a cada 5 s até sair de
`pending`. O poll pausa com a aba em segundo plano.

- Falha ao gerar o Pix (`500`) **não limpa o carrinho** — a pessoa tenta de novo
  sem remontar o pedido.
- Item desativado entre uma visita e outra some do carrinho no próximo load.
- "Minhas fichas" guarda os últimos 20 pedidos feitos naquele aparelho.
- Preço vem em **centavos** do contrato; o front só formata.

## Painel (`painel.html`)

Login/cadastro por JWT em `localStorage`. `401` em qualquer rota logada devolve
para a tela de login com aviso de sessão expirada — inclusive quando o
`connect_error` do Socket.IO acusa token expirado.

### Fila — quadro kanban

Quatro colunas, todas ordenadas do mais recente para o mais antigo, alimentadas
pelo evento `pedidoAtualizado` (upsert por `orderId`):

| Coluna | Status na API |
|---|---|
| Fila total | `pending` |
| Pagos | `paid` |
| Separados | `ready` |
| Entregues | `delivered` |

Cada card mostra **nome, telefone e e-mail** do cliente (telefone e e-mail são
links `tel:`/`mailto:`), mais nº da ficha, itens, total e horário.

As setas `←` / `→` movem pela esteira linear `pending → paid → ready →
delivered`, uma casa por clique, cada uma virando um `PATCH /pedidos/:id/status`.
Seta na ponta fica desabilitada com o motivo no `title`/`aria-label`.

Uma única confirmação na esteira: `pending → paid`, porque marcar pago na mão é
afirmar que o dinheiro entrou sem o webhook do Pix ter confirmado.

**Cancelados ficam fora do quadro**, como manda a spec. Não somem de vez: um
botão "N cancelados" na barra abre um bloco separado, só leitura — um Pix que
expirou sozinho não pode desaparecer sem o operador ver.

Busca (atalho `/`) filtra as quatro colunas por nome, e-mail ou telefone
(client-side, sobre os dados já carregados). Aceita também o nº da ficha, que é
o que gritam no balcão. Colunas renderizam 60 cards por vez, com "mostrar mais".

Sem WebSocket (servidor fora, script indisponível) o painel cai sozinho em poll
de 10 s e a lâmpada do topo passa de "ao vivo" para "sem tempo real".

### Cardápio

CRUD de itens em `multipart/form-data`: preço digitado em reais e enviado em
centavos, foto opcional com preview. Arquivo não-imagem ou acima de 5 MB é
barrado no front com aviso — a API o ignoraria em silêncio, criando o item sem
foto. Desativar é soft-delete (`DELETE /itens/:id`), com confirmação; o
formulário avisa antes de descartar alterações não salvas.

### O nº da ficha

A API não tem número sequencial de pedido. Loja e painel usam os 5 últimos
caracteres do `orderId` em maiúsculas — estável, curto o bastante pra ser
gritado no balcão, e com espaço grande o bastante pra não repetir numa festa.

## Design — "Quermesse Suíça"

Colisão: **barraca de festa junina** (papel kraft, serrilha de
canhoto de ficha) × **sinalização ferroviária suíça** (grid rígido, tipografia
condensada em caixa alta, seções numeradas `01 SALGADOS`, régua grossa, zero
ornamento). Wildcard: o nº da ficha em **dígitos de placar mecânico de estação**.

- Fundo branco predominante; kraft como superfície secundária.
- Amarelo, vermelho e azul só em ação, estado e destaque — nunca como fundo de
  página. Contrastes conferidos: tinta sobre amarelo 13:1, branco sobre
  vermelho 6,0:1, branco sobre azul 6,8:1.
- Tipografia: Archivo (display), Instrument Sans (interface), Azeret Mono
  (números e códigos), com fallback de sistema — a festa pode estar sem
  internet boa.
- **Modo escuro recusado de propósito**: a identidade inteira é papel sob luz de
  quintal; invertida, ela some.
- Densidade compacta no painel, confortável na loja. Uma escolha, aplicada em
  tudo.

## Verificação

```bash
node front/test.js      # 61 asserções: categorias, esteira, busca, formatação
```

# Handoff — front (loja pública + painel do operador)

Sessão de **2026-09-06**, que construiu o front inteiro do zero em `front/`.
Documento para qualquer pessoa (ou agente) que continue o trabalho sem ter visto
a conversa original.

Leia nesta ordem: [handoff.md](handoff.md) (visão geral do projeto e estado do
backend) → [api-contract.md](api-contract.md) (o contrato que este front
consome, seguido à risca) → este arquivo. Para o **como rodar** e o detalhe
operacional de cada tela, veja [`../front/README.md`](../front/README.md) — este
documento não repete o README, ele registra **o que foi decidido e por quê**.

## Estado no fim da sessão

Front completo e **testado de ponta a ponta contra a API real** (mesmo servidor,
mesmo banco, mesmo Mercado Pago sandbox). Não há mock em lugar nenhum.

- **Loja pública**: cardápio por categorias, carrinho único, `POST /pedidos`,
  QR Pix real renderizado, poll de status.
- **Painel logado**: login JWT, quadro kanban de 4 colunas em tempo real via
  Socket.IO, movimentação por setas, busca, e CRUD de itens com upload.
- HTML/CSS/JS puro: **sem framework, sem build step, sem `npm install`, sem CDN
  de biblioteca**. 2.900 linhas em 10 arquivos.
- `node front/test.js` → 61 asserções, verdes.

Existia um front anterior em `front-bkp/` (de uma sessão passada). **Não foi
aproveitado como código** — o `front/` atual foi escrito do zero sobre uma spec
nova e um design novo. `front-bkp/` pode ser apagado quando você quiser; nada em
`front/` depende dele.

## Decisões tomadas com o usuário nesta sessão

Perguntadas explicitamente e respondidas antes de escrever qualquer código:

1. **Categorias do cardápio → prefixo no `name` do item.** Ver a seção própria
   abaixo; é a decisão mais importante deste documento.
2. **Direção visual → "Quermesse Suíça"** (entre três opções apresentadas). Ver
   seção "Design" abaixo.
3. **O painel inclui CRUD de itens**, mesmo não estando na spec original do
   escopo (que pedia só o kanban). Sem isso o sistema não é autossuficiente no
   dia da festa — não haveria como cadastrar item sem Bruno/curl.

Decisões que **não** foram perguntadas, tomadas por mim e sinalizadas ao
usuário no fim da sessão (revise se discordar):

4. **Cancelados não somem de vez.** A spec manda tirá-los do quadro, e eles
   estão fora. Mas um botão "N cancelados" na barra abre um bloco separado, **só
   leitura**, porque um Pix que expira sozinho desaparecendo da tela é dinheiro
   perdido sem o operador ver. Se preferir sumir de vez: apague `renderCancelled`
   e o `#cancelledBox`/`#btnCancelled`.
5. **Seta para trás (`←`) existe**, além da seta para frente. A spec diz "ícone
   de seta indicando a direção do movimento"; num balcão cheio o operador vai
   errar o clique, e desfazer é uma chamada `PATCH` igual à de avançar.
6. **Uma única confirmação na esteira**: `pending → paid`. Marcar pago na mão é
   afirmar que o dinheiro entrou sem o webhook do Pix ter confirmado. As outras
   transições são instantâneas — o operador vai fazer isso centenas de vezes.
7. **Modo escuro recusado de propósito.** Ver "Design".

## A divergência com a spec: categorias

**Isto é o que mais importa saber antes de mexer no cardápio.**

A spec pedia o menu dividido em categorias "populadas dinamicamente a partir dos
dados vindos da API". **O contrato não tem campo de categoria**: `GET /itens`
devolve `itemId`, `name`, `description`, `price`, `active`, `imageKey`,
`imageUrl` — e o modelo no banco ([core-plan.md](core-plan.md), seção
"Modelagem de dados") também não tem. Não dá pra popular categoria a partir de
dado que não existe.

Convenção acordada com o usuário, **sem tocar no backend**: a categoria é um
prefixo no próprio `name`, separado por `:`.

```
"Bebidas: Guaraná Lata"   → seção BEBIDAS, item "Guaraná Lata"
"Salgados: Coxinha"       → seção SALGADOS, item "Coxinha"
"Pipoca"                  → seção OUTROS
```

Regras implementadas em `front/assets/core.js`:

- `splitCategory(name)` → `{ category, label }`. Só o **primeiro** `:` separa
  (`"Bebidas: Água: com gás"` → categoria `Bebidas`, item `Água: com gás`).
  Categoria vazia ou nome vazio caem em `Outros` com o `name` cru como label.
- `joinCategory(category, label)` → remonta o `name` antes do `POST`/`PUT`, e
  descarta qualquer `:` digitado na categoria.
- `groupByCategory(items)` → seções em ordem alfabética pt-BR, **`Outros`
  sempre por último**.

**O operador nunca digita o prefixo.** O formulário de item no painel tem um
campo **Categoria** separado (com `<datalist>` autocompletando as categorias já
existentes) e o front junta os dois na hora de salvar. O campo valida que a
categoria não contenha `:`.

Itens antigos, criados antes desta sessão (os 4 "Coxinha" de teste), não têm
prefixo e aparecem em "Outros" — comportamento correto, não é bug.

**Se um dia a API ganhar um campo `category` de verdade**, o ponto de troca é
`splitCategory`/`joinCategory` em `core.js`. Nada mais no front lê o prefixo:
`loja.js` e `painel.js` só consomem `.category` e `.label` já prontos.

## Mudanças fora de `front/`

Duas, ambas necessárias, ambas de uma linha:

1. **`gerenciador-fichas-api.js:21`** — `app.use(express.static(path.join(__dirname, 'front')))`,
   ao lado do `express.static('public')` que já existia.
   **Sem isso o front não funciona de jeito nenhum.** A API não manda nenhum
   header `Access-Control-*`; um front em qualquer outra origem (`file://`,
   Live Server) tem toda requisição bloqueada pelo navegador. Servir pela
   própria API resolve CORS e o WebSocket de uma vez.
   Alternativa, se um dia o front for pra outro domínio: `npm i cors` +
   `app.use(cors())`, e alinhar a origem com a do Socket.IO (hoje `origin: '*'`
   em `services/socketService.js`).
2. **`.eslintignore`** — adicionado `front/`. O `.eslintrc.json` do projeto é
   `env: { node: true }` com `airbnb-base`; rodar isso sobre código de browser
   (`window`, `document`, `var`, IIFE) só produziria ruído.

Nenhum arquivo do backend foi alterado além dessa linha. Nenhuma dependência
nova em `package.json`.

## Mapa dos arquivos

```
front/
  index.html          69   loja pública (shell + <dialog>s)
  painel.html        168   painel (login + shell + <dialog>s)
  assets/base.css    391   tokens e componentes compartilhados — a identidade
  assets/core.js     333   window.F: fetch, auth, formatação, categorias,
                           esteira de status, busca, ícones, toasts
  assets/loja.css    268
  assets/loja.js     547   cardápio, carrinho, checkout, ficha com Pix
  assets/painel.css  239
  assets/painel.js   608   login, kanban, tempo real, CRUD de itens
  test.js            112   auto-teste da lógica pura (node front/test.js)
  README.md          165   como rodar + detalhe operacional de cada tela
```

`core.js` é carregado primeiro nas duas páginas e expõe tudo em `window.F`.
Não há módulos ES nem bundler — são scripts clássicos no fim do `<body>`.

## Como o front mapeia o contrato

**Colunas do kanban ↔ `status` da API** (`F.COLUMNS` em `core.js`):

| Coluna | `status` |
|---|---|
| Fila total | `pending` |
| Pagos | `paid` |
| Separados | `ready` |
| Entregues | `delivered` |

`cancelled` **não é coluna** e não entra na esteira (`F.FLOW`). `nextStatus` e
`prevStatus` devolvem `null` para ele, o que já desabilita as duas setas nos
cards do bloco de cancelados sem código extra.

**Tempo real**: `painel.js` carrega o cliente de
`<API_BASE>/socket.io/socket.io.js` — servido pelo próprio servidor, já na
versão certa. Sem CDN, sem risco de versão trocada. Autentica com
`auth: { token }` no handshake, faz **upsert por `orderId`** no
`pedidoAtualizado`, e cai sozinho em poll de 10 s se o WebSocket não subir (a
lâmpada do topo muda de "ao vivo" pra "sem tempo real"). `connect_error` cuja
mensagem casa com `/[Tt]oken/` é tratado como sessão morta → volta pro login.

**Nº da ficha**: a API não tem número sequencial de pedido. Loja e painel usam
os **5 últimos caracteres do `orderId`** em maiúsculas (`F.ticketCode`).
Estável, curto pra gritar no balcão, ~1M de espaço. A busca do painel aceita o
código com ou sem `#`.

**Preços** vêm e vão em **centavos**. O front só formata (`F.brl`) e converte na
entrada do operador (`F.reaisToCents`, que aceita `6,00`, `6.00`, `1.234,50` e
`R$ 12,90`).

**Upload**: o contrato diz que a API ignora **em silêncio** arquivo não-imagem
ou acima de 5 MB — o item seria criado sem foto e sem erro. O front barra isso
antes de enviar, com aviso. Não mude isso achando que é redundante.

## Design — Vibe Spec "Quermesse Suíça"

Colisão deliberada de duas influências, ambas visíveis:

- **Barraca de festa junina**: papel kraft como superfície secundária,
  bandeirinha triangular (**removida a pedido do usuário em 2026-09-06** — o
  token `--bunting` e a classe `.bunting` não existem mais), serrilha de
  canhoto de ficha no topo do ticket.
- **Sinalização ferroviária suíça**: grid rígido, tipografia condensada em caixa
  alta, seções numeradas (`01 SALGADOS`), régua grossa separando blocos, zero
  ornamento, sombra dura sem blur.

**Wildcard** (o elemento que deliberadamente não encaixa): o nº da ficha em
**dígitos de placar mecânico de estação** — `.board` em `base.css`, peças com
linha de dobra no meio. Sobre a faixa preta do ticket as peças invertem (creme
sobre preto), senão sumiriam no fundo.

**Cores** — branco predomina; amarelo/vermelho/azul só em ação, estado e
destaque, nunca como fundo de página. Tudo em CSS custom properties no `:root`,
sem hex solto em componente. Contrastes conferidos: tinta sobre amarelo 13:1,
branco sobre vermelho (`#c81e1e`) 6,0:1, branco sobre azul (`#1d4ed8`) 6,8:1.

**Tipografia**: Archivo (display), Instrument Sans (interface), Azeret Mono
(números e códigos), todas do Google Fonts com fallback de sistema real — a
festa pode estar sem internet boa.

**Modo escuro recusado de propósito.** A identidade inteira é papel sob luz de
quintal; invertida, ela some. Não é um "falta implementar".

**Densidade**: compacta no painel, confortável na loja. Uma escolha por
superfície, aplicada em tudo.

## Bugs encontrados e corrigidos (contexto pra não reintroduzir)

1. **`[hidden]` era vencido por `display:` de classe.** A tela de login
   (`.login { display: grid }`) continuava visível **atrás** do painel; o mesmo
   valia pro botão de limpar busca, o pill de cancelados e o preview de foto.
   Corrigido com `[hidden] { display: none !important; }` no reset de
   `base.css`. **Não remova essa regra.**
2. **`.ticket__top span` vencia `.board` por especificidade**, forçando
   `display: block` nas peças do placar; o `padding` grande dos elementos inline
   vazava a linha e cortava o rótulo acima. Corrigido trocando o seletor por uma
   classe (`.ticket__lbl`) e dando `display: inline-grid` ao `.board b`.
3. **Ícones de fechar vinham vazios** nos `<dialog>` porque eram preenchidos por
   JS só em alguns botões. Trocado por um preenchedor declarativo único:
   `<button data-icon="close" data-icon-size="15">` + `F.paintIcons()` no fim de
   `core.js`. Botão novo com ícone deve usar esse atributo, não `innerHTML`.
4. **Listener duplicado**: `wireMenu()` registrava um `click` em `#view` a cada
   render de rota. A delegação agora é registrada **uma vez só**, no nível do
   IIFE.
5. **`confirmDlg` resolvia duas vezes**: o `onclick` chamava `close()`, que
   disparava o `close` do `<dialog>`, que resolvia `false` antes do `true`.
   Agora a resposta é guardada numa variável e lida **só** no evento `close` —
   o que também faz Esc e backdrop responderem "não" corretamente.

## Verificação feita nesta sessão

Tudo contra a API real rodando em `localhost:3000`, nada mockado.

- `node front/test.js` → 61 asserções (categorias, esteira, busca, formatação
  de dinheiro/telefone, escape de HTML).
- Todas as rotas estáticas + `/socket.io/socket.io.js` → 200.
- **WebSocket validado de ponta a ponta pela primeira vez no projeto** — isso
  fecha a pendência nº 3 de [handoff.md](handoff.md), que dizia que
  `pedidoAtualizado` nunca tinha sido testado com um cliente de verdade:
  - token inválido → `44{"message":"Token inválido ou expirado."}`, conexão
    recusada (é exatamente a string que `painel.js` casa pra derrubar a sessão);
  - token válido → `40{"sid":...}`, conecta;
  - `PATCH /pedidos/:id/status` idempotente → `pedidoAtualizado` chegou com
    `buyerName`/`buyerPhone`/`buyerEmail` presentes.

  Feito **sem `socket.io-client`** (não está instalado), falando o protocolo na
  mão por polling: `GET /socket.io/?EIO=4&transport=polling` pra pegar o `sid`,
  `POST` do pacote `40{"token":"<jwt>"}`, e `GET` de novo pra ler a resposta.
  Vale repetir assim se precisar testar de novo.
- CRUD de item real: `POST` multipart com nome prefixado → `PUT` trocando preço
  → `GET /itens` agrupado pelo próprio `core.js` (saiu `01 BEBIDAS` /
  `02 OUTROS`) → `DELETE` soft-delete → confirmado que sumiu da lista pública.
- Kanban conferido sobre os 11 pedidos reais da tabela: Fila 4 · Pagos 1 ·
  Separados 0 · Entregues 0 · 6 cancelados fora do quadro.
- `scrollWidth == clientWidth` em 390, 900 e 1440 px — sem scroll horizontal de
  página em nenhuma tela (o kanban rola dentro da própria régua).

### Como tirar screenshot (armadilha que custou tempo)

**O Chrome headless no macOS trava a janela num mínimo de 500 px de largura.**
`--window-size=390,...` com `--screenshot` não erra: ele renderiza a 500 px e
**recorta** a imagem em 390, o que parece exatamente um bug de layout que não
existe. Não confie nesse caminho pra validar responsivo.

O que funciona: subir o Chrome com `--headless=new --remote-debugging-port=9333`
e falar CDP por WebSocket (o `WebSocket` nativo do Node 24 basta, sem
dependência). Pegue o alvo com `type === 'page'` em `/json/list`, mande
`Emulation.setDeviceMetricsOverride` com `mobile: false`, **reaplique o override
logo antes** de `Page.captureScreenshot` (ele se perde entre navegações — sem
isso o `innerWidth` volta 1) e capture com `captureBeyondViewport: true`.
Semear estado (token, carrinho) é `Runtime.evaluate` com `localStorage.setItem`
depois de uma primeira navegação na origem certa.

## Dados de teste criados (não precisa limpar, mas é bom saber)

- 1 item `"Bebidas: Guaraná Lata [teste-front]"`
  (`1286d925-57fd-49e3-aa49-93652f80d2b5`), criado, atualizado e **já
  desativado** (`active: false`) no mesmo teste. Não aparece no cardápio.
- 1 `PATCH` idempotente no pedido `0f91b545-5a10-4463-85ec-92d211b326cc`
  (`cancelled` → `cancelled`): não mudou nada no banco, só serviu pra disparar o
  evento do WebSocket.
- Login usado nos testes: a conta de operador criada na sessão anterior.

## O que **não** foi construído

Nada disso está na spec do escopo; são omissões deliberadas, não pendências
esquecidas:

- **Ação de cancelar pedido no painel.** Hoje `cancelled` só vem do webhook do
  Mercado Pago. Se o operador precisar cancelar na mão, é um botão a mais no
  card chamando `PATCH` com `{"status":"cancelled"}` — a rota já aceita.
- **Reabrir um cancelado** (voltar pra `pending`).
- **Visão/filtro de cancelados além do bloco só-leitura** já descrito.
- **Paginação server-side** — não existe na API ([api-contract.md](api-contract.md),
  seção "O que ainda não existe"). As colunas renderizam 60 cards por vez com
  "mostrar mais", client-side; suficiente pra uma festa.
- **Reativar item desativado** — a API só tem soft-delete (`DELETE`), não há
  rota pra voltar `active: true`.
- **Logout no servidor** — não existe; logout é o front descartar o token.

## Próximos passos sugeridos

1. **Abrir num celular de verdade**, na rede da festa. Toda a validação de
   responsivo foi feita em Chrome headless via CDP; o que ninguém testou é
   toque, teclado virtual subindo sobre o `<dialog>` de checkout, e a leitura do
   QR na tela sob luz forte.
2. **Cadastrar o cardápio real** pelo painel, usando o campo Categoria. As
   quatro "Coxinha" de teste ainda estão ativas e aparecem em "Outros" — vale
   desativar antes da festa.
3. **Testar um pedido real de ponta a ponta pelo front**: criar pelo cardápio →
   pagar o Pix sandbox (truque `payer.first_name: "APRO"`, ver
   [handoff.md](handoff.md) — basta o `buyerName` começar com "APRO") → ver o
   card pular de Fila total pra Pagos sozinho no painel, sem recarregar. Esse
   caminho completo (loja → webhook → WebSocket → kanban) ainda não foi feito
   numa tacada só; as pontas foram testadas separadamente.
4. **Corte pra produção**: continua valendo o checklist do item 4 de
   [handoff.md](handoff.md) (credenciais do MP, URL do webhook fora do ngrok).
   Somar a isso: decidir se o front continua servido pela própria API (mais
   simples) ou vai pra um domínio separado — nesse caso, habilitar CORS **e**
   restringir a origem do Socket.IO junto.
5. **Apagar `front-bkp/`** quando tiver certeza de que não quer nada de lá.

# Deploy — EC2 (Amazon Linux 2023) + Load Balancer

> **Desatualizado em parte desde 2026-09-07**: os passos de EC2/IAM/DynamoDB/S3 são da infra AWS antiga. Para Magalu Cloud, ver [magalu-setup.md](magalu-setup.md). O que continua valendo aqui: dimensionamento da máquina, systemd, TLS com Caddy, e a análise do WebSocket atrás de load balancer.

Como colocar esta aplicação no ar na AWS, que tamanho de máquina usar, e o que a
arquitetura com Load Balancer quebra (spoiler: **uma coisa só, e é o WebSocket
com mais de uma instância**).

Contexto do sistema em [handoff.md](handoff.md); rotas em
[api-contract.md](api-contract.md); front em [front-handoff.md](front-handoff.md).

---

## TL;DR

- **1 instância `t4g.small`** (ARM, 2 vCPU, 2 GB) roda isso folgado. Uma festa
  de igreja não chega perto de saturar.
- **ALB na frente funciona** — e vale a pena, porque dá TLS de graça (ACM).
  **Com um único alvo, nada quebra.**
- **A partir de 2 instâncias o painel quebra em silêncio**: o Socket.IO
  faz broadcast só pros clientes da instância que processou a mudança. Operador
  conectado na instância B não vê o pedido que o webhook confirmou na A. Ver
  [WebSocket atrás do LB](#websocket-atrás-do-lb-o-único-problema-real).
- **Se quiser mais barato**: Lightsail 2 GB (US$ 12/mês fixo, IP e banda
  inclusos) + TLS pelo Caddy elimina o custo do ALB inteiro.

---

## As duas perguntas, respondidas direto

### Rotas atrás do LB: nenhum problema

Nada no código depende de host, path base ou de estado em memória:

- Todas as rotas são absolutas na raiz (`/itens`, `/pedidos`, `/auth`,
  `/pagamentos`) — não há `basePath` pra ajustar.
- O front descobre a API sozinho: `API_BASE = location.origin`
  ([core.js:14](../front/assets/core.js#L14)). Servido pelo mesmo processo
  ([gerenciador-fichas-api.js:21](../gerenciador-fichas-api.js#L21)), então
  atrás de `https://festa.suaigreja.org` ele chama a si mesmo em HTTPS. Sem
  mixed content, sem CORS, sem variável pra editar no deploy.
- Todo estado está no DynamoDB. Não há sessão em memória, nem arquivo em disco
  (o upload de imagem é `multer` em memória → vai direto pro S3). **A aplicação
  é stateless pra HTTP** — qualquer requisição pode cair em qualquer instância.
- O webhook do Mercado Pago (`POST /pagamentos/notifications`) é só mais uma
  rota HTTP. Cai em qualquer instância e funciona: o controller nunca confia no
  corpo, sempre revalida via `getOrder` autenticado.

Um detalhe de configuração, não de código: o ALB precisa de um **health check**.
Use `GET /` — é o `index.html` do front, servido estático, responde `200` sem
tocar no DynamoDB. Não aponte pra `/itens`: funciona, mas paga uma leitura no
Dynamo a cada 30 s, por instância, pra sempre.

### WebSocket atrás do LB: o único problema real

O ALB fala WebSocket nativamente (faz o upgrade sozinho, não precisa habilitar
nada). Com **uma** instância, está tudo certo. O problema aparece ao escalar:

**1. Broadcast não atravessa instâncias.** `socketService.emitOrderUpdated`
([socketService.js](../gerenciador-fichas/services/socketService.js)) chama
`io.emit`, que alcança só os sockets conectados **naquele processo**. Com 2
instâncias:

```
Operador A ──ws──> instância 1
Operador B ──ws──> instância 2
Webhook do MP ────> instância 1  → emit → só A vê o pedido virar "Pago"
```

O painel de B fica desatualizado até alguém dar F5. E **não dá erro nenhum** —
é o pior tipo de bug pra descobrir no dia da festa.

Correção, se um dia precisar de 2+ instâncias — 3 linhas + um Redis:

```bash
npm i @socket.io/redis-adapter redis
```
```js
// services/socketService.js, dentro do init(), depois do new Server(...)
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const pub = createClient({ url: process.env.REDIS_URL });
const sub = pub.duplicate();
await Promise.all([pub.connect(), sub.connect()]);
io.adapter(createAdapter(pub, sub));
```

ElastiCache Serverless tem um piso de custo que, pra este porte, é mais caro que
a segunda instância que você está tentando adicionar. **Por isso a recomendação
é ficar em uma instância** — ver [alternativas](#alternativas-mais-baratas).

**2. Sticky sessions.** O handshake do Socket.IO por polling faz várias
requisições que precisam cair na mesma instância. O painel pede
`transports: ['websocket', 'polling']` ([painel.js:158](../front/assets/painel.js#L158)),
ou seja, tenta WebSocket direto e só cai pro polling se o WS falhar — o que
reduz, mas não elimina o risco (rede da festa com proxy chato bloqueia WS).
Com 2+ alvos, **ligue stickiness** no target group (`lb_cookie`, 1 dia). Com 1
alvo, é irrelevante.

**3. Idle timeout.** O padrão do ALB é 60 s. O Socket.IO manda ping a cada 25 s,
então não estoura — mas suba pra **300 s** de qualquer forma; é grátis e evita
desconexão em rede ruim.

**4. Token expirado ≠ socket derrubado.** O JWT dura 12 h e só é checado no
handshake. Uma festa que passe das 12 h vai ver operadores caindo pro poll de
10 s ao reconectar. Comportamento conhecido, tratado no front (a lâmpada muda
pra "sem tempo real"), não é problema do LB.

---

## Tamanho da máquina

O processo é um Node só, sem banco local, sem cache, sem processamento pesado.
O trabalho de verdade (DynamoDB, S3, Mercado Pago) acontece em outro lugar —
esta máquina é quase só I/O.

| Instância | vCPU / RAM | Serve pra | Custo aprox. sa-east-1 |
|---|---|---|---|
| `t4g.micro` | 2 / 1 GB | Funciona. RAM apertada só durante `npm ci`. | ~US$ 12/mês |
| **`t4g.small`** | **2 / 2 GB** | **Recomendada.** Folga pra tudo, inclusive build. | ~US$ 25/mês |
| `t4g.medium` | 2 / 4 GB | Desperdício aqui. | ~US$ 50/mês |

> Preços são **ordem de grandeza** (on-demand, 730 h, sa-east-1 é ~1,5× o
> us-east-1). Confira na calculadora da AWS antes de orçar.

**Use ARM (`t4g`/família Graviton)**: ~20 % mais barato que o `t3` equivalente e
o Node roda igual. `bcrypt` — a única dependência nativa — publica binário
pronto pra `linux-arm64`, então nem compila.

Ordem de grandeza do que a máquina aguenta: um pedido é ~4 escritas/leituras no
Dynamo e uma chamada ao Mercado Pago (que leva ~1 s, mas é I/O, não bloqueia).
Node aguenta centenas de conexões WebSocket simultâneas nessa máquina. Uma festa
com 500 pedidos ao longo de 6 h é **carga desprezível** — o gargalo será a
latência do Mercado Pago, não a CPU.

**Disco**: 20 GB gp3 (padrão) sobra. O código são ~3 MB e nada é gravado em
disco além de log.

**Sobre Auto Scaling**: configure `min=1, max=1, desired=1` distribuído em 2
AZs. Isso **não é pra escalar** — é pra que a instância se recrie sozinha se
morrer. Escalar pra 2 é o que quebra o WebSocket (ver acima).

---

## Passo a passo — Amazon Linux 2023

### 1. IAM: use uma role, não chaves no `.env`

Crie uma **IAM role** pra instância (nunca `AWS_ACCESS_KEY_ID` em arquivo — o
SDK usa a chain de credenciais e pega a role sozinho, exatamente como hoje ele
pega o AWS CLI da sua máquina):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
                 "dynamodb:Scan", "dynamodb:Query"],
      "Resource": [
        "arn:aws:dynamodb:sa-east-1:440466198161:table/fichas-itens",
        "arn:aws:dynamodb:sa-east-1:440466198161:table/fichas-pedidos",
        "arn:aws:dynamodb:sa-east-1:440466198161:table/fichas-usuarios",
        "arn:aws:dynamodb:sa-east-1:440466198161:table/fichas-*/index/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::sistema-feira/itens/*"
    }
  ]
}
```

Anexe também a policy gerenciada `AmazonSSMManagedInstanceCore` — assim você
acessa a máquina pelo **Session Manager** e não precisa abrir a porta 22 nem
gerenciar chave SSH.

### 2. Security groups

Dois grupos, e a regra que importa é a segunda:

- **`sg-alb`**: entrada `443` (e `80`, só pra redirecionar) de `0.0.0.0/0`.
- **`sg-app`**: entrada `3000` **com origem `sg-alb`**, não do mundo. Sem SSH
  (você entra por SSM). Saída liberada — a app precisa falar com DynamoDB, S3 e
  Mercado Pago.

### 3. Subir a máquina

AMI **Amazon Linux 2023 (arm64)**, tipo `t4g.small`, subnet **privada** se
estiver usando ALB (com NAT pra saída), ou pública com IP se for a opção sem LB.
Cole isto no **user data** — instala tudo e deixa pronto pra receber o código:

```bash
#!/bin/bash
dnf update -y
dnf install -y nodejs npm git
# AL2023 traz Node 20+; confirme com: node -v  (precisa ser >= 18)
useradd -r -m -d /opt/fichas -s /sbin/nologin fichas
```

### 4. Código e dependências

```bash
sudo -u fichas git clone <seu-repo> /opt/fichas/app
cd /opt/fichas/app
sudo -u fichas npm ci --omit=dev
```

**Nunca copie `node_modules` da sua máquina.** `bcrypt` é binário nativo
compilado pro macOS — na EC2 dá erro de "invalid ELF header". Sempre `npm ci` na
própria instância.

> Se o `npm ci` reclamar de compilação (`node-gyp`), instale as ferramentas e
> repita: `sudo dnf install -y gcc-c++ make python3`. Normalmente não é
> necessário, o `bcrypt` baixa binário pronto.

### 5. `.env` na instância

```bash
sudo -u fichas tee /opt/fichas/app/.env > /dev/null <<'EOF'
JWT_SECRET=<gere um novo, longo, diferente do de dev>
REGISTER_SECRET=<senha de convite pra criar conta de operador>
MP_ACCESS_TOKEN=<token de PRODUÇÃO>
MP_WEBHOOK_SECRET=<secret de PRODUÇÃO, da MESMA aplicação do token>
AWS_REGION=sa-east-1
ITEMS_TABLE=fichas-itens
ORDERS_TABLE=fichas-pedidos
USERS_TABLE=fichas-usuarios
S3_BUCKET=sistema-feira
EOF
sudo chmod 600 /opt/fichas/app/.env
```

Sem `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` — a role da instância resolve.
`DYNAMO_ENDPOINT` também não: só existia pra apontar pra um Dynamo local.

**Gere um `JWT_SECRET` novo pra produção.** Reaproveitar o de dev significa que
qualquer token emitido na sua máquina vale no servidor da festa.

### 6. systemd

```bash
sudo tee /etc/systemd/system/fichas.service > /dev/null <<'EOF'
[Unit]
Description=Gerenciador de fichas
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=fichas
WorkingDirectory=/opt/fichas/app
ExecStart=/usr/bin/node gerenciador-fichas-api.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now fichas
sudo systemctl status fichas
curl -s localhost:3000/itens | head -c 200   # sanity check
```

`Restart=always` é o que substitui o PM2 aqui — systemd já faz o trabalho, não
precisa de mais uma dependência.

Logs: `sudo journalctl -u fichas -f`.

### 7. Load Balancer

- **Target group**: protocolo `HTTP`, porta **3000**, tipo `instance`.
  - Health check: path **`/`**, código esperado `200`, intervalo 30 s.
  - Atributos: **stickiness** `lb_cookie` (só importa com 2+ alvos).
- **ALB**: internet-facing, nas subnets públicas, com `sg-alb`.
  - Listener `443` → certificado do **ACM** (grátis) → forward pro target group.
  - Listener `80` → redirect 301 pra `443`.
  - Atributo do ALB: **idle timeout = 300**.
- **Route 53**: registro A (alias) do seu domínio → ALB.

Não é preciso configurar nada pra WebSocket: o ALB faz o upgrade sozinho quando
o alvo responde `101`.

### 8. Mercado Pago

No painel do MP, troque a URL do webhook de ngrok para
`https://festa.suaigreja.org/pagamentos/notifications`, no tópico
**"Order (Mercado Pago)"**. Confirme que o `MP_ACCESS_TOKEN` e o
`MP_WEBHOOK_SECRET` do `.env` são **da mesma aplicação e ambos de produção** —
misturar os dois faz a assinatura nunca bater, e hoje isso passa em silêncio
(só um `console.warn`, ver [handoff.md](handoff.md#descoberta-importante-bug-do-mercado-pago-na-assinatura-do-webhook-de-order)).

E confirme que **a conta do MP tem chave Pix cadastrada** — sem isso a criação
da cobrança falha com o mesmo `400` opaco do sandbox.

### 9. Atualizar o código depois

```bash
cd /opt/fichas/app && sudo -u fichas git pull && sudo -u fichas npm ci --omit=dev
sudo systemctl restart fichas
```

O restart derruba os WebSockets conectados; o painel reconecta sozinho em
segundos. Não faça isso durante a festa.

---

## Alternativas mais baratas

O ALB custa quase tanto quanto a instância e, no seu caso, entrega **só o TLS
gerenciado** — porque com uma instância ele não está balanceando nada.

| Opção | Custo aprox./mês | TLS | Resiliência | Quando faz sentido |
|---|---|---|---|---|
| ALB + 1 EC2 `t4g.small` | ~US$ 25 + ~US$ 25 | ACM, automático | ASG recria a instância; o DNS não muda | Você já quer o LB e não se importa com o custo |
| **1 EC2 `t4g.small` + Caddy + Elastic IP** | **~US$ 25** | Let's Encrypt, automático | Recriar é manual (~10 min a partir de uma AMI) | **Melhor custo/benefício aqui** |
| **Lightsail 2 GB** | **US$ 12 fixo** | Let's Encrypt via Caddy | Snapshot + restore manual | **Mais barato e mais previsível** — banda e IP inclusos |
| App Runner / Fargate | ~US$ 30+ | Automático | Alta | Só se quiser parar de administrar servidor — e aí volta o problema do WebSocket ao escalar |

**Caddy** substitui o ALB em 4 linhas e tira o custo do LB do orçamento:

```bash
sudo dnf install -y 'dnf-command(copr)' && sudo dnf copr enable -y @caddy/caddy
sudo dnf install -y caddy
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
festa.suaigreja.org {
    reverse_proxy localhost:3000
}
EOF
sudo systemctl enable --now caddy
```

Ele tira certificado do Let's Encrypt sozinho, renova sozinho, e faz proxy de
WebSocket sem configuração nenhuma. Nesse caso o `sg-app` abre `80`/`443` pro
mundo e a instância fica em subnet pública com Elastic IP (o IP fixo é o que
mantém o DNS válido depois de um restart).

**O que eu faria**: Lightsail 2 GB com Caddy. US$ 12/mês fixos, sem surpresa de
LCU no fim do mês, e um snapshot antes da festa te dá restore em minutos. A
"resiliência" que o ALB entrega — recriar a instância sozinha — só vale se o
resto também for redundante, e com uma instância só ele não está entregando isso.

Se a festa for crítica ao ponto de precisar de verdade de 2 instâncias, então o
Redis adapter deixa de ser opcional: **ALB + 2 EC2 + ElastiCache**, e o custo
triplica. Vale conversar sobre isso antes, não durante.

---

## Checklist antes da festa

- [ ] `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` **de produção, mesma aplicação**
- [ ] Conta do Mercado Pago com **chave Pix cadastrada**
- [ ] URL do webhook atualizada no painel do MP (domínio real, não ngrok)
- [ ] `JWT_SECRET` novo, diferente do de dev
- [ ] `REGISTER_SECRET` definido (sem ele ninguém cria conta de operador)
- [ ] Health check do ALB em `/` respondendo `200`
- [ ] Um pedido de verdade, de ponta a ponta: cardápio → Pix real (pague R$ 0,01
      no seu celular) → card pula pra "Pagos" no painel sozinho
- [ ] Itens de teste ("Coxinha" ×4) desativados, cardápio real cadastrado
- [ ] Usuários de teste (`teste@igreja.org`) removidos, operadores reais criados
- [ ] Snapshot/AMI da instância pronta, pra restaurar se algo morrer
- [ ] Um celular de verdade, na rede da festa, abrindo a loja e lendo o QR

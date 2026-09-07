# Deploy na Magalu Cloud

Colocar a aplicação no ar numa VM da Magalu, com deploy por `git pull`, TLS
automático e restart automático se o processo cair. Pressupõe a infraestrutura
já criada em [magalu-setup.md](magalu-setup.md) (PostgreSQL na VM + bucket do
Object Storage). Contexto do sistema em [handoff.md](handoff.md).

---

## O que roda na VM

```
internet ──443──> Caddy ──> localhost:3000  node gerenciador-fichas-api.js
   (TLS automático)              │           (systemd, Restart=always)
                                 ├─> localhost:5432  PostgreSQL
                                 └─> br-se1.magaluobjects.com  imagens
```

Um processo Node só, servindo a API **e** o front (`front/` é estático, servido
pelo próprio Express). Nada de Docker, PM2 ou build step — não há o que buildar.

---

## 1. A VM

Console da Magalu → **Virtual Machine** → criar:

| Campo | Valor |
|---|---|
| Imagem | Ubuntu 24.04 LTS |
| Tipo | 2 vCPU / 2 GB |
| Região | `br-se1` (a mesma do bucket) |
| Chave SSH | a sua |

2 GB é folgado: a máquina é quase só I/O (rede pro Mercado Pago e pro bucket) e
o banco tem algumas centenas de linhas. **Não desça pra 1 GB** — o `npm ci`
sozinho já encosta nisso.

No **security group**, libere só `22`, `80` e `443`. A porta `3000` fica fechada
pra fora: quem fala com ela é o Caddy, por `localhost`. E o mesmo na VM:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```

### DNS

Aponte um registro **A** do seu domínio (ex: `festa.suaigreja.org.br`) pro IP
público da VM **antes** de configurar o Caddy — ele emite o certificado na hora
que sobe, e pra isso o domínio já precisa resolver pra cá.

---

## 2. Node

O Node do apt do Ubuntu é velho demais. Use o repositório oficial da NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v   # v22.x
```

Node 22 LTS. Não precisa de mais nada — `bcrypt` tem binário pronto pra essa
plataforma, então não há compilação nem `build-essential` no caminho.

---

## 3. Clonar o repositório

O deploy é `git pull`, então a VM precisa ler o repositório. Se ele for
**público**, é só clonar por HTTPS e pular pra próxima seção:

```bash
cd ~ && git clone https://github.com/pedrorchagas/gerenciador-fichas.git
```

Se for **privado**, gere uma chave na VM e cadastre como *deploy key* de
leitura — é o mínimo que resolve, e não coloca sua conta do GitHub inteira
dentro da máquina:

```bash
ssh-keygen -t ed25519 -C "vm-festa" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
# GitHub → repositório → Settings → Deploy keys → Add deploy key
# cole a chave, deixe "Allow write access" DESMARCADO
cd ~ && git clone git@github.com:pedrorchagas/gerenciador-fichas.git
```

> Chave sem passphrase (`-N ""`) é proposital: o systemd não tem como digitar
> uma. Ela é read-only e vive só nesta VM — se a máquina for comprometida, o
> pior caso é alguém ler um código que já é seu.

---

## 4. Instalar e configurar

```bash
cd ~/gerenciador-fichas
npm ci --omit=dev          # instala exatamente o que está no package-lock
cp .env.example .env
chmod 600 .env
nano .env                  # preencha tudo — modelo comentado na seção 3 do magalu-setup.md
```

`--omit=dev` deixa o `eslint` de fora; em produção ele não serve pra nada.

Com o `.env` pronto, crie as tabelas e valide a infraestrutura inteira antes de
subir o serviço:

```bash
npm run setup:tables
npm run smoke
```

O `smoke` bate no banco e no Object Storage de verdade (e limpa o que criou). Se
ele passar, o que sobra é só processo e rede. Se falhar, a resposta está em
[magalu-setup.md](magalu-setup.md) — não adianta seguir pro systemd.

---

## 5. systemd

O serviço que mantém o processo vivo, sobe junto com a máquina e reinicia se
cair:

```bash
sudo nano /etc/systemd/system/fichas.service
```

```ini
[Unit]
Description=Gerenciador de fichas
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/gerenciador-fichas
ExecStart=/usr/bin/node gerenciador-fichas-api.js
Environment=NODE_ENV=production
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fichas
systemctl status fichas
curl -fsS localhost:3000/itens   # rota pública: precisa devolver JSON
```

Três detalhes que quebram silenciosamente se você mudar:

- **`WorkingDirectory` é obrigatório.** O app carrega as variáveis com
  `dotenv.config()`, que lê `./.env` — relativo ao diretório de trabalho. Sem
  isso o serviço sobe sem env nenhuma e morre no primeiro acesso ao banco.
- **`User=ubuntu`, não `root`.** O processo não precisa de privilégio nenhum: a
  porta é 3000 (acima de 1024) e os arquivos são do próprio usuário.
- **`Restart=always` com `RestartSec=3`.** Sem o `RestartSec`, um erro logo no
  boot vira loop de restart e o systemd desiste ("start request repeated too
  quickly") — aí o serviço fica fora do ar de vez.

Logs, sempre:

```bash
journalctl -u fichas -f          # ao vivo
journalctl -u fichas --since today -p err
```

---

## 6. TLS com Caddy

Caddy porque ele emite e renova o certificado do Let's Encrypt sozinho, e faz
proxy de WebSocket sem configuração extra — o painel depende disso.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

O `/etc/caddy/Caddyfile` inteiro:

```
festa.suaigreja.org.br {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
journalctl -u caddy -n 30        # confirme a emissão do certificado
```

É isso — HTTP redireciona pro HTTPS, o certificado renova sozinho e o
`/socket.io/` passa pelo proxy como qualquer outra rota. Se aparecer erro de
emissão, o motivo quase sempre é o DNS ainda não ter propagado ou a porta 80
estar fechada no security group.

---

## 7. Mercado Pago em produção

Com o domínio no ar, três trocas no painel do Mercado Pago — e as três precisam
ser da **mesma aplicação**, senão a assinatura do webhook nunca bate:

1. `MP_ACCESS_TOKEN` no `.env`: token de **produção**.
2. `MP_WEBHOOK_SECRET` no `.env`: secret de **produção**.
3. URL do webhook: `https://festa.suaigreja.org.br/pagamentos/notifications`,
   tópico **"Order (Mercado Pago)"** (não "Pagamentos" — ver [handoff.md](handoff.md)).

`sudo systemctl restart fichas` depois de mexer no `.env` — o processo lê as
variáveis uma vez, na subida.

> A validação de assinatura do tópico `order` está deliberadamente relaxada por
> um bug do próprio Mercado Pago, documentado em [handoff.md](handoff.md). Não
> reverta sem ler aquela seção: o status do pedido nunca vem do corpo da
> notificação, é sempre reconsultado na API autenticada.

---

## 8. O deploy do dia a dia

Uma linha, do seu computador pra VM:

```bash
git push                                   # local
ssh ubuntu@festa.suaigreja.org.br \
  'cd gerenciador-fichas && git pull && npm ci --omit=dev && sudo systemctl restart fichas'
```

A ordem importa: código novo, dependências do lock novo, restart. O `npm ci` é
rápido quando nada mudou no lock e é o que evita o clássico "funciona na minha
máquina" — ele instala o `package-lock.json`, não resolve versões de novo.

**Se o schema mudou**, rode `npm run setup:tables` entre o `npm ci` e o restart.
Ele é idempotente, mas **só cria o que falta** — alterar coluna de tabela
existente continua sendo migração manual no `psql`.

**Rollback** é o mesmo caminho, apontando pro commit anterior:

```bash
git log --oneline -5
git reset --hard <sha> && npm ci --omit=dev && sudo systemctl restart fichas
```

O `.env` não é versionado, então nenhum deploy sobrescreve suas credenciais. Em
compensação, **variável nova no `.env.example` não chega sozinha na VM** — se um
deploy adicionar uma, preencha na mão antes do restart.

---

## 9. Uma instância só

Não escale isso horizontalmente. O `socketService.emitOrderUpdated` faz
`io.emit` no **processo local**: com duas instâncias atrás de um load balancer,
o operador conectado na instância A não recebe o pedido que foi confirmado na
instância B. E o pior é o modo da falha — nenhum erro, nenhum log, o card
simplesmente não aparece no painel até alguém dar F5.

Se um dia precisar de duas máquinas de verdade, o caminho é o adaptador de Redis
do Socket.IO — não sticky session, que resolve a conexão mas não o broadcast.
Pra uma festa, uma VM aguenta com sobra.

Pelo mesmo motivo, nada de `node --cluster` ou PM2 em modo cluster aqui.

---

## 10. Backup

`pg_dump` no cron **e** um dump manual copiado pra fora da VM antes da festa —
o procedimento está em [magalu-setup.md](magalu-setup.md#backup--isto-agora-é-responsabilidade-sua).
Sem isso, a VM morrer no dia significa perder os pedidos.

---

## Checklist de corte

Infra (o detalhe está em [magalu-setup.md](magalu-setup.md)):

- [ ] `npm run smoke` passando na VM, banco **e** object storage
- [ ] `pg_dump` no cron + dump manual fora da VM

Máquina:

- [ ] Security group e `ufw` com só `22`, `80`, `443` — a `3000` e a `5432` fechadas
- [ ] DNS apontando pro IP da VM, certificado emitido (`journalctl -u caddy`)
- [ ] `systemctl is-enabled fichas` → `enabled` (sobe sozinho depois de um reboot)
- [ ] Testado: `sudo reboot`, e o site volta sozinho

Aplicação:

- [ ] `.env` com `chmod 600`, `JWT_SECRET` e `REGISTER_SECRET` novos e diferentes dos de dev
- [ ] `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` de **produção**, da mesma aplicação
- [ ] Webhook do MP no domínio real, tópico "Order (Mercado Pago)"
- [ ] Um pedido de verdade, de ponta a ponta: cardápio → Pix pago → card pula pra "Pagos" sozinho no painel
- [ ] Itens e pedidos de teste apagados do banco
- [ ] Uma conta de operador criada, e o `REGISTER_SECRET` guardado (é ele que barra cadastro de estranho)

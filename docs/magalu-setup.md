# Configurar o sistema na infraestrutura da Magalu Cloud

Substitui DynamoDB por **PostgreSQL instalado na própria VM** e o S3 da AWS por
**Object Storage da Magalu**. O deploy da aplicação em si (systemd, TLS, load
balancer) continua valendo o que está em [deploy.md](deploy.md) — só as seções
de AWS mudam.

Contexto do sistema em [handoff.md](handoff.md); rotas em [api-contract.md](api-contract.md).

---

## TL;DR

```bash
# 1. Instale o PostgreSQL na própria VM (seção 1) + crie 1 bucket Object Storage público (seção 2)
# 2. Preencha o .env (modelo em .env.example)
npm ci
npm run setup:tables   # cria as 3 tabelas (idempotente)
npm run smoke          # valida banco + object storage de ponta a ponta
npm start
```

---

## 1. Banco: PostgreSQL na própria VM

Decisão de 2026-09-07: o banco roda **na mesma VM da aplicação**, não no DBaaS.
Pra uma festa (centenas de pedidos, um processo Node) isso é mais barato e mais
simples — e o app fala com o banco por `localhost`, sem rede no meio. O custo é
que backup e atualização passam a ser seus (ver "Backup" no fim da seção). O
DBaaS continua descrito em [Alternativa: DBaaS](#alternativa-dbaas-gerenciado)
caso um dia valha a pena.

### Instalar (Ubuntu)

```bash
sudo apt update && sudo apt install -y postgresql
sudo systemctl enable --now postgresql
```

> Amazon Linux / RHEL: `sudo dnf install -y postgresql16-server && sudo postgresql-setup --initdb`.

### Criar banco e usuário

Um usuário só pra aplicação — nunca use o `postgres`:

```bash
sudo -u postgres psql <<'SQL'
CREATE USER fichas WITH PASSWORD 'ponha-uma-senha-forte-aqui';
CREATE DATABASE fichas OWNER fichas;
SQL
```

A connection string vai pro `.env` apontando pra `localhost`:

```
DATABASE_URL=postgres://fichas:SENHA@localhost:5432/fichas
DB_SSL=false
```

`DB_SSL=false` porque a conexão nem sai da máquina — não há rede pra
interceptar. O código liga TLS por padrão
([databaseService.js](../gerenciador-fichas/services/databaseService.js)); essa
é a exceção legítima.

> Se a senha tiver caractere especial (`@`, `/`, `:`, `#`, `?`), faça URL-encode
> antes de colar na string — senão o parser corta a senha no meio e o erro que
> aparece é de autenticação, não de sintaxe. Gerar sem símbolo nenhum evita o
> problema: `openssl rand -base64 24 | tr -d '/+='`.

### Fechar o banco pra fora

Instalação padrão do Postgres já escuta **só em `localhost`** — confirme e
mantenha assim:

```bash
sudo -u postgres psql -c "SHOW listen_addresses;"   # precisa ser: localhost
```

Não abra a porta `5432` no firewall da VM. Se precisar acessar da sua máquina
pra depurar, use túnel SSH em vez de expor a porta:

```bash
ssh -L 5432:localhost:5432 usuario@<ip-da-vm>
# no seu .env local: DATABASE_URL=postgres://fichas:SENHA@localhost:5432/fichas
```

### Backup — isto agora é responsabilidade sua

Sem o DBaaS não existe backup automático. Um `pg_dump` diário resolve pro porte
deste sistema:

```bash
sudo -u postgres crontab -e
# 0 3 * * * pg_dump fichas | gzip > /var/backups/fichas-$(date +\%F).sql.gz
```

E **antes da festa**, um dump manual + uma cópia fora da VM (baixe pro seu
computador). Se a VM morrer no dia, é isso que salva os pedidos.

> Restaurar: `gunzip -c fichas-2026-09-07.sql.gz | sudo -u postgres psql fichas`.

### Criar as tabelas

```bash
npm run setup:tables
```

Idempotente: cria só o que falta (`sequelize.sync()`). **Não** altera colunas de
tabelas que já existem — mudança de schema depois do primeiro deploy é migração
manual no `psql`.

Três tabelas, nomes vindos do `.env` (`ITEMS_TABLE`, `ORDERS_TABLE`,
`USERS_TABLE`), com underscore em vez de hífen porque agora são identificadores
SQL:

- `fichas_itens` — PK `itemId` (UUID), `price` em centavos, `active` (soft-delete), `imageKey`.
- `fichas_pedidos` — PK `orderId` (UUID), `items` em **JSONB** (snapshot da compra, sem tabela de junção), `status`, `total`, campos do Mercado Pago.
- `fichas_usuarios` — PK `email`, `passwordHash`.
### Alternativa: DBaaS gerenciado

Se um dia quiser tirar o banco da VM: console da Magalu → **Banco de dados
(DBaaS)** → criar instância PostgreSQL 16, menor tipo disponível, 10 GB, na
mesma região do bucket. Aí a `DATABASE_URL` usa o endpoint da instância, o
`DB_SSL` volta a ficar **vazio** (o DBaaS exige TLS), e a porta `5432` é
liberada no security group **com origem no security group da aplicação**, nunca
`0.0.0.0/0`. Nenhuma mudança de código — só `.env`.

---

## 2. Imagens: Object Storage

No console → **Object Storage** → *Criar bucket*:

| Campo | Valor |
|---|---|
| Nome | `sistema-feira` (o que você usar vai no `MGC_BUCKET`) |
| Região | `br-se1` |
| Acesso | **Público para leitura** |

O bucket precisa ser público porque as fotos do cardápio são exibidas pra
qualquer visitante, sem login — a URL é fixa e cacheável, o que evita gerar URL
assinada a cada exibição. **Só imagens de item vão pra esse bucket**; nada
sensível.

Se o painel oferecer política de bucket em JSON, a permissão mínima é leitura
anônima só no prefixo das imagens:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::sistema-feira/itens/*"
  }]
}
```

### Credenciais

Console → **API Keys** → criar uma chave com escopo de Object Storage. A Magalu
devolve um par `access key` / `secret key` compatível com S3 — vão em
`MGC_ACCESS_KEY_ID` e `MGC_SECRET_ACCESS_KEY`.

> A secret aparece **uma vez só**. Guarde na hora.

### Por que o SDK ainda é o `@aws-sdk/client-s3`

O Object Storage da Magalu implementa a API do S3. Trocar de provedor foi trocar
endpoint e credenciais em
[storageService.js](../gerenciador-fichas/services/storageService.js) —
`https://br-se1.magaluobjects.com`, `forcePathStyle: true`. Manter o SDK é a
opção com menos código; não existe cliente nativo da Magalu que faça algo a mais
aqui.

URL pública das imagens: `https://br-se1.magaluobjects.com/<bucket>/itens/<itemId>/<uuid>.<ext>`.

---

## 3. `.env` da aplicação

Modelo completo em [.env.example](../.env.example):

```bash
JWT_SECRET=<gere um novo, longo, diferente do de dev>
REGISTER_SECRET=<senha de convite pra criar conta de operador>

MP_ACCESS_TOKEN=<token de PRODUÇÃO do Mercado Pago>
MP_WEBHOOK_SECRET=<secret de PRODUÇÃO, da MESMA aplicação do token>

DATABASE_URL=postgres://fichas:senha@localhost:5432/fichas
DB_SSL=false
ITEMS_TABLE=fichas_itens
ORDERS_TABLE=fichas_pedidos
USERS_TABLE=fichas_usuarios

MGC_REGION=br-se1
MGC_BUCKET=sistema-feira
MGC_ACCESS_KEY_ID=<api key da Magalu>
MGC_SECRET_ACCESS_KEY=<secret da api key>
```

`chmod 600 .env` — o arquivo tem a senha do banco e o token de produção do
Mercado Pago.

Diferença importante em relação à AWS: **não existe "instance role" aqui**. Na
AWS o SDK pegava credencial da role da EC2 e o `.env` não guardava chave nenhuma;
na Magalu a API key fica no `.env`. Trate o arquivo como segredo, e rotacione a
chave se a máquina for comprometida ou o repositório vazar.

---

## 4. Verificar

```bash
npm run smoke
```

Exercita CRUD real das três tabelas (incluindo os casos que já quebraram antes:
update sem imagem preservando `imageKey`, `items` voltando como JSON e não
string, e-mail duplicado virando `409`), sobe uma imagem de teste no bucket,
confirma que ela responde `200` **sem autenticação**, e apaga tudo que criou.
Seguro rodar em produção.

Se o object storage não estiver configurado, ele pula essa parte e valida só o
banco.

Depois, o fluxo manual de sempre:

1. `POST /auth/register` → `POST /auth/login` → JWT.
2. `POST /itens` com imagem → `GET /itens` sem JWT → `imageUrl` abre no navegador.
3. `POST /pedidos` → QR code do Pix na resposta.
4. Webhook do Mercado Pago apontando pro domínio real → card pula pra "Pagos" no painel.

---

## 5. Deploy da aplicação

Continua igual ao [deploy.md](deploy.md), com três ajustes:

- **A VM**: Magalu Cloud → *Virtual Machine*, imagem Ubuntu, 2 vCPU / 2 GB. O
  perfil de carga é o mesmo descrito lá — a máquina é quase só I/O. Com o
  PostgreSQL junto na máquina, 2 GB continua folgado (o banco aqui tem algumas
  centenas de linhas), mas não desça pra 1 GB.
- **Sem IAM role**: as credenciais vão no `.env` (seção 3), não numa role.
- **Uma instância só.** O motivo não mudou de provedor: o Socket.IO faz
  `io.emit` no processo local, então com 2+ instâncias o painel de um operador
  não recebe o pedido confirmado na outra — em silêncio, sem erro. Ver
  [WebSocket atrás do LB](deploy.md#websocket-atrás-do-lb-o-único-problema-real).

O `systemd`, o Caddy pro TLS e o checklist pré-festa valem sem mudança.

---

## Checklist

- [ ] PostgreSQL instalado na VM, escutando **só em localhost** (`SHOW listen_addresses`)
- [ ] Banco `fichas` e usuário `fichas` criados — nunca rodar a app como `postgres`
- [ ] `DATABASE_URL` apontando pra `localhost`, `DB_SSL=false` (senha URL-encoded se tiver caractere especial)
- [ ] `npm run setup:tables` rodado — 3 tabelas criadas
- [ ] Bucket criado, **público para leitura**, na mesma região do banco
- [ ] API key da Magalu gerada, secret guardada, `.env` com `chmod 600`
- [ ] `npm run smoke` passando, incluindo a parte do object storage
- [ ] `JWT_SECRET` e `REGISTER_SECRET` de produção, diferentes dos de dev
- [ ] Credenciais de **produção** do Mercado Pago, token e webhook secret da mesma aplicação
- [ ] `pg_dump` diário no cron **e** um dump manual copiado pra fora da VM antes da festa

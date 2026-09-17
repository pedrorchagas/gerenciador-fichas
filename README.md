![Claude Code](https://img.shields.io/badge/Claude%20Code-%23D97757.svg?style=for-the-badge&logo=claudecode&logoColor=white)
![Postgres](https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)
![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E)
![ESLint](https://img.shields.io/badge/ESLint-%234B3263.svg?style=for-the-badge&logo=eslint&logoColor=white)

# Sistema Gerenciador de fichas
Um sistema para gerenciamento e venda de fichas de alimentos para uma festa beneficente que acontece na igreja que congrego. O objetivo é otimizar a venda das fichas para que as pessoas possam aproveitar mais a festa ao invés de ficar em pé em uma fila.

Esse sistema rodou em produção durante uma noite no dia 12/09

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

## Como funciona?
O cliente acessa o nosso cardápio digital pelo navegador do celular, pelo site ele consegue ver todos os produtos disponíveis e criar o pedido de fichas. Ao finalizar o pedido um QR Code do Pix é gerado e apresentado em tela. Ao mesmo tempo a notificação é inserida em um quadro kanban no painel da administração que acompanha todo o processo de criação, pagamento, separação e entrega das fichas. 

## Stack utilizada
Utilizei nesse projeto NodeJS + Express, PostgreSQL via Sequelize, integração webhook com Mercado Pago, Object Storage da Magalu Cloud, front em HTML/CSS/JS.

Tudo rodando em uma máquina virtual na Magalu Cloud. 

## Rode o projeto localmente
Se você for um curioso, você pode rodar o projeto localmente e ver como tudo funciona.
```
npm ci
cp .env.example .env    # preencha: JWT_SECRET, REGISTER_SECRET, Mercado Pago, DATABASE_URL, bucket
npm run setup:tables    # sequelize.sync(), idempotente
npm run smoke           # valida banco + object storage de ponta a ponta e limpa o que criou
npm start
```

Acessos:
- Loja: http://localhost:3000/
- Painel ADM: http://localhost:3000/painel.html

## Como foi construído:
Desenvolvi o projeto com auxílio de IA (Claude, via Claude Code), mas com um workflow bem definido.
O processo foi o seguinte: 
- Antes de tudo, defini bem todos os requisitos que precisava (Uma abstração de spec-driven-development), stack e outras informações necessárias para a IA.
- Criei toda a estrutura de pastas e arquivos.
- Configurei o linter em uma estrutura que já conheço.
- Após tudo bem definido o código foi gerado com a IA.

O resultado desse workflow está bem descrito na @docs/Handoff pois foi o que utilizei para manter um fluxo de conhecimento sobre decisões e outras informações importantes entre as sessões.
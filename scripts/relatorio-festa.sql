-- Relatório da festa. Rode na VPS com:
--   psql "$DATABASE_URL" -f scripts/relatorio-festa.sql
-- Só leitura — não altera nada.
--
-- Valores no banco são em CENTAVOS; as queries já dividem por 100.
-- "Pago" = status paid/ready/delivered (o dinheiro entrou; ready/delivered só
-- avançaram na esteira do balcão). pending = Pix gerado e nunca pago.

\pset border 2
\timing off

-- createdAt é timestamptz; sem isto a VPS (quase sempre UTC) desloca a query 5 em 3h.
SET TIME ZONE 'America/Sao_Paulo';

\echo ''
\echo '=== 1. RESUMO GERAL (só pedidos pagos) ==='
SELECT
  COUNT(*)                                  AS pedidos,
  ROUND(SUM(total) / 100.0, 2)              AS arrecadado_reais,
  ROUND(AVG(total) / 100.0, 2)              AS ticket_medio_reais,
  ROUND(MIN(total) / 100.0, 2)              AS menor_pedido,
  ROUND(MAX(total) / 100.0, 2)              AS maior_pedido,
  MIN("createdAt")                          AS primeiro_pedido,
  MAX("createdAt")                          AS ultimo_pedido
FROM fichas_pedidos
WHERE status IN ('paid', 'ready', 'delivered');

\echo ''
\echo '=== 2. PEDIDOS POR STATUS (inclui o que não foi pago) ==='
SELECT
  status,
  COUNT(*)                     AS pedidos,
  ROUND(SUM(total) / 100.0, 2) AS valor_reais
FROM fichas_pedidos
GROUP BY status
ORDER BY SUM(total) DESC;

\echo ''
\echo '=== 3. QUANTIDADE VENDIDA POR PRODUTO (só pedidos pagos) ==='
SELECT
  COALESCE(NULLIF(split_part(i.name, ':', 1), i.name), 'Outros') AS categoria,
  BTRIM(CASE WHEN POSITION(':' IN i.name) > 0
             THEN SUBSTRING(i.name FROM POSITION(':' IN i.name) + 1)
             ELSE i.name END)                                    AS produto,
  SUM(i.quantity)                                                AS unidades,
  COUNT(DISTINCT o."orderId")                                    AS pedidos,
  ROUND(SUM(i.quantity * i."unitPrice") / 100.0, 2)              AS receita_reais
FROM fichas_pedidos o
CROSS JOIN LATERAL jsonb_to_recordset(o.items)
  AS i(name text, quantity int, "unitPrice" int)
WHERE o.status IN ('paid', 'ready', 'delivered')
GROUP BY 1, 2
ORDER BY unidades DESC, receita_reais DESC;

\echo ''
\echo '=== 4. RECEITA POR CATEGORIA (só pedidos pagos) ==='
SELECT
  COALESCE(NULLIF(split_part(i.name, ':', 1), i.name), 'Outros') AS categoria,
  SUM(i.quantity)                                                AS unidades,
  ROUND(SUM(i.quantity * i."unitPrice") / 100.0, 2)              AS receita_reais
FROM fichas_pedidos o
CROSS JOIN LATERAL jsonb_to_recordset(o.items)
  AS i(name text, quantity int, "unitPrice" int)
WHERE o.status IN ('paid', 'ready', 'delivered')
GROUP BY 1
ORDER BY receita_reais DESC;

\echo ''
\echo '=== 5. MOVIMENTO POR HORA (só pedidos pagos) ==='
SELECT
  date_trunc('hour', "createdAt")            AS hora,
  COUNT(*)                                   AS pedidos,
  ROUND(SUM(total) / 100.0, 2)               AS arrecadado_reais
FROM fichas_pedidos
WHERE status IN ('paid', 'ready', 'delivered')
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '=== 6. CONFERÊNCIA: soma dos itens x total gravado no pedido ==='
-- Deve voltar 0 linhas. Qualquer linha aqui é pedido cujo total não bate com o
-- snapshot dos itens — investigue antes de confiar nos números acima.
SELECT o."orderId", o.total AS total_gravado, s.soma_itens
FROM fichas_pedidos o
CROSS JOIN LATERAL (
  SELECT SUM(i.quantity * i."unitPrice") AS soma_itens
  FROM jsonb_to_recordset(o.items) AS i(quantity int, "unitPrice" int)
) s
WHERE o.status IN ('paid', 'ready', 'delivered')
  AND o.total IS DISTINCT FROM s.soma_itens;

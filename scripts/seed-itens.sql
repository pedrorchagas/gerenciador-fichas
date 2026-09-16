-- Cardápio inicial. Rode com: psql "$DATABASE_URL" -f scripts/seed-itens.sql
-- Categoria é prefixo no name ("Categoria: Item") — convenção do front, ver docs/front-handoff.md.
-- price é em CENTAVOS (inteiro). "imageKey" NULL = item sem foto (dá pra subir depois pelo painel).

INSERT INTO fichas_itens ("itemId", name, description, price, active, "imageKey") VALUES
  (gen_random_uuid(), 'Hambúrgueres: O Clássico', 'Pão, 130g blend bovino, queijo cheddar, cebola caramelizada, bacon, salada e maionese da casa', 2890, true, NULL),
  (gen_random_uuid(), 'Hambúrgueres: O Marrento', 'Pão, 160g de hambúrguer de costela, duas fatias de cheddar, bacon, alface, cebola roxa, molho barbecue e mostarda', 3290, true, NULL),
  (gen_random_uuid(), 'Hambúrgueres: O Grandão do Seu Elizeu', 'Pão, blend 180g recheado com requeijão cremoso, queijo prato, cebola caramelizada, ovo, bacon, alface, tomate e maionese da casa', 3890, true, NULL),
  (gen_random_uuid(), 'Hambúrgueres: Cheese Burger', 'Pão, blend 130g, queijo e maionese da casa', 1990, true, NULL),
  (gen_random_uuid(), 'Picolés: Picolé de Fruta e Creme', 'Sabores disponíveis: abacaxi, açaí, maracujá, groselha, uva, limão, blue, flocos, coco e chocolate', 200, true, NULL),
  (gen_random_uuid(), 'Picolés: Picolé Casquinha', 'Sabores disponíveis: Expresso (cappuccino c/ chocolate), Skimo (prestígio c/ chocolate), Pinkinho (ninho c/ morango), Black (chocolate/chocolate), Pistache (pistache c/ chocolate branco e castanha)', 350, true, NULL),
  (gen_random_uuid(), 'Crepes: Crepe Suíço de Frango com Catupiry', 'Massa suíça recheada com frango desfiado e catupiry cremoso', 1000, true, NULL),
  (gen_random_uuid(), 'Crepes: Crepe Suíço de Presunto e Queijo', 'Massa suíça recheada com presunto e queijo', 1000, true, NULL),
  (gen_random_uuid(), 'Crepes: Crepe Suíço de Queijo', 'Massa suíça recheada com queijo', 1000, true, NULL),
  (gen_random_uuid(), 'Crepes: Crepe Suíço de Chocolate ao Leite', 'Massa suíça recheada com chocolate ao leite', 1000, true, NULL),
  (gen_random_uuid(), 'Crepes: Crepe Suíço de Chocolate Branco', 'Massa suíça recheada com chocolate branco', 1000, true, NULL),
  (gen_random_uuid(), 'Crepes: Crepe Suíço de Morango com Nutella', 'Massa suíça recheada com morango fresco e Nutella', 1500, true, NULL),
  (gen_random_uuid(), 'Batata Frita: Batata Frita (P)', 'Porção pequena de batata frita', 800, true, NULL),
  (gen_random_uuid(), 'Batata Frita: Batata Frita (G)', 'Porção grande de batata frita', 1500, true, NULL),
  (gen_random_uuid(), 'Arroz Carreteiro: Arroz Carreteiro', 'Porção aproximada de 350g', 1500, true, NULL),
  (gen_random_uuid(), 'Brinquedos: Play Kids (até 6 anos)', 'Pulseira de acesso ilimitado à área kids para crianças de até 6 anos', 1000, true, NULL),
  (gen_random_uuid(), 'Brinquedos: Parede de Escalada', 'Pulseira/acesso à parede de escalada', 1000, true, NULL),
  (gen_random_uuid(), 'Churrasquinho: Medalhão e Contra Filé', 'Espetinho de medalhão e contra filé', 1000, true, NULL);

-- 2ª leva (bebidas, feijão tropeiro, pamonha). Rode só se ainda não inseriu.
INSERT INTO fichas_itens ("itemId", name, description, price, active, "imageKey") VALUES
  (gen_random_uuid(), 'Bebidas: Água com Gás', 'Água mineral com gás', 400, true, NULL),
  (gen_random_uuid(), 'Bebidas: Água sem Gás', 'Água mineral sem gás', 200, true, NULL),
  (gen_random_uuid(), 'Bebidas: Coca-Cola Lata', 'Refrigerante Coca-Cola lata', 700, true, NULL),
  (gen_random_uuid(), 'Bebidas: Coca-Cola Zero Lata', 'Refrigerante Coca-Cola Zero lata', 700, true, NULL),
  (gen_random_uuid(), 'Bebidas: Limoneto Lata', 'Refrigerante Limoneto lata', 700, true, NULL),
  (gen_random_uuid(), 'Bebidas: Guaraná Lata', 'Refrigerante Guaraná lata', 500, true, NULL),
  (gen_random_uuid(), 'Bebidas: Suco (300ml)', 'Suco natural 300ml. Sabores: laranja com morango, maracujá', 700, true, NULL),
  (gen_random_uuid(), 'Feijão Tropeiro: Feijão Tropeiro', 'Porção aproximada de 350g', 1000, true, NULL),
  (gen_random_uuid(), 'Pamonha: Pamonha (Sal/Doce)', 'Pamonha tradicional, salgada ou doce', 1200, true, NULL),
  (gen_random_uuid(), 'Pamonha: Pamonha à Moda', 'Pamonha preparada "à moda" (com acompanhamento especial)', 1400, true, NULL);

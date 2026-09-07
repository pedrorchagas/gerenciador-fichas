/* Auto-teste da lógica pura de core.js — `node front/test.js`.
   Sem framework: se um assert quebrar, o processo sai com código 1. */
'use strict';
const assert = require('assert');

// core.js é script de browser: stub do mínimo que ele toca no carregamento.
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.window = {};
require('./assets/core.js');
const F = global.window.F;

// Intl usa espaço não-separável no R$ — normaliza pra comparar.
const nbsp = (s) => s.replace(/\u00a0/g, " ");
let n = 0;
const is = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, msg); };

/* ---------------------------------------------------- centavos ↔ reais */
is(nbsp(F.brl(500)), 'R$ 5,00', 'brl 500');
is(nbsp(F.brl(0)), 'R$ 0,00', 'brl 0');
is(nbsp(F.brl(123456)), 'R$ 1.234,56', 'brl milhar');

is(F.reaisToCents('6,00'), 600, 'vírgula');
is(F.reaisToCents('6.00'), 600, 'ponto');
is(F.reaisToCents('1.234,50'), 123450, 'milhar + vírgula');
is(F.reaisToCents('R$ 12,90'), 1290, 'com prefixo');
is(F.reaisToCents('0,05'), 5, 'centavos soltos');
is(Number.isNaN(F.reaisToCents('')), true, 'vazio é NaN');
is(Number.isNaN(F.reaisToCents('abc')), true, 'lixo é NaN');
is(F.centsToReais(600), '6,00', 'volta pra reais');
is(F.centsToReais(5), '0,05', 'volta centavos');

/* ----------------------------------------------------------- categorias */
is(F.splitCategory('Bebidas: Guaraná'), { category: 'Bebidas', label: 'Guaraná' }, 'prefixo simples');
is(F.splitCategory('  Doces :  Brigadeiro '), { category: 'Doces', label: 'Brigadeiro' }, 'espaços aparados');
is(F.splitCategory('Pipoca'), { category: 'Outros', label: 'Pipoca' }, 'sem prefixo');
is(F.splitCategory(': Coxinha'), { category: 'Outros', label: ': Coxinha' }, 'categoria vazia não conta');
is(F.splitCategory('Bebidas:'), { category: 'Outros', label: 'Bebidas:' }, 'nome vazio não conta');
is(F.splitCategory(null), { category: 'Outros', label: '' }, 'null não quebra');
is(F.splitCategory('Bebidas: Água: com gás').label, 'Água: com gás', 'só o primeiro ":" separa');

is(F.joinCategory('Bebidas', 'Guaraná'), 'Bebidas: Guaraná', 'junta');
is(F.joinCategory('', 'Pipoca'), 'Pipoca', 'sem categoria não vira prefixo');
is(F.joinCategory('Beb:idas', 'X'), 'Bebidas: X', 'dois-pontos da categoria é removido');

const grouped = F.groupByCategory([
  { itemId: '1', name: 'Pipoca', price: 400 },
  { itemId: '2', name: 'Bebidas: Guaraná', price: 500 },
  { itemId: '3', name: 'Salgados: Coxinha', price: 600 },
  { itemId: '4', name: 'Bebidas: Água', price: 300 }
]);
is(grouped.map((g) => g.name), ['Bebidas', 'Salgados', 'Outros'], 'alfabética, Outros por último');
is(grouped[0].items.length, 2, 'duas bebidas');
is(grouped[0].items[0].label, 'Guaraná', 'label sem o prefixo');
is(grouped[0].items[0].price, 500, 'campos originais preservados');
is(grouped[2].items[0].label, 'Pipoca', 'sem prefixo cai em Outros');
is(F.groupByCategory([]), [], 'lista vazia');

/* ------------------------------------------------------- esteira/status */
is(F.COLUMNS.map((c) => c.key), ['pending', 'paid', 'ready', 'delivered'], 'as 4 colunas do quadro');
is(F.COLUMNS.some((c) => c.key === 'cancelled'), false, 'cancelado não é coluna');

is(F.nextStatus('pending'), 'paid', 'pending → paid');
is(F.nextStatus('paid'), 'ready', 'paid → ready');
is(F.nextStatus('ready'), 'delivered', 'ready → delivered');
is(F.nextStatus('delivered'), null, 'delivered é o fim');
is(F.prevStatus('pending'), null, 'pending é o começo');
is(F.prevStatus('delivered'), 'ready', 'volta uma casa');
is(F.nextStatus('cancelled'), null, 'cancelado não anda');
is(F.prevStatus('cancelled'), null, 'cancelado não volta');
is(F.nextStatus('lixo'), null, 'status desconhecido não anda');

/* ------------------------------------------------------------- ficha/busca */
is(F.ticketCode('c2ffgc8d-1111-2222-3333-44445555abcd'), '5ABCD', 'últimos 5 do uuid');
is(F.ticketCode(null), '', 'sem id, sem código');

const o = {
  orderId: 'c2ffgc8d-1111-2222-3333-44445555abcd',
  buyerName: 'Maria Silva',
  buyerEmail: 'maria@example.com',
  buyerPhone: '11999998888'
};
is(F.orderMatches(o, ''), true, 'busca vazia passa tudo');
is(F.orderMatches(o, 'maria'), true, 'nome');
is(F.orderMatches(o, 'MARIA'), true, 'nome sem case');
is(F.orderMatches(o, 'silva'), true, 'sobrenome');
is(F.orderMatches(o, '@example'), true, 'e-mail');
is(F.orderMatches(o, '99999'), true, 'telefone cru');
is(F.orderMatches(o, '(11) 99999-8888'), true, 'telefone mascarado');
is(F.orderMatches(o, '5abcd'), true, 'nº da ficha');
is(F.orderMatches(o, '#5ABCD'), true, 'nº da ficha com #');
is(F.orderMatches(o, 'joão'), false, 'não bate');
is(F.orderMatches(o, '11'), false, 'menos de 3 dígitos não vira busca de telefone');

is([{ createdAt: '2026-09-05T10:00:00Z' }, { createdAt: '2026-09-05T12:00:00Z' }].sort(F.byNewest)[0].createdAt,
  '2026-09-05T12:00:00Z', 'mais recente primeiro');

/* ------------------------------------------------------------- formatação */
is(F.phoneMask('11999998888'), '(11) 99999-8888', 'celular');
is(F.phoneMask('1133334444'), '(11) 3333-4444', 'fixo');
is(F.phoneMask('11'), '11', 'parcial');
is(F.phoneMask('119999988889999'), '(11) 99999-8888', 'corta em 11 dígitos');
is(F.digits('(11) 99999-8888'), '11999998888', 'só dígitos');
is(F.esc('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;', 'escape de html');
is(F.statusOf('paid').short, 'Pago', 'rótulo de status');
is(F.statusOf('zzz').short, 'zzz', 'status desconhecido não quebra');

console.log('ok — ' + n + ' asserções');

// Checagem da infraestrutura: bate no banco (Sequelize) e, se as credenciais do
// Object Storage estiverem preenchidas, sobe e apaga uma imagem de teste.
// Uso: npm run smoke  — cria e remove dados de teste, seguro rodar em produção.
const assert = require('assert');
const dotenv = require('dotenv');

dotenv.config();

const { sequelize, Item, User } = require('../gerenciador-fichas/services/databaseService');
const itemModel = require('../gerenciador-fichas/models/itemModel');
const orderModel = require('../gerenciador-fichas/models/orderModel');
const userModel = require('../gerenciador-fichas/models/userModel');
const storageService = require('../gerenciador-fichas/services/storageService');

async function checkDatabase() {
  await sequelize.sync();

  const item = await itemModel.createItem({
    name: 'Smoke test', description: 'apagar', price: 500, imageKey: 'itens/smoke.png',
  });
  assert.strictEqual(item.active, true, 'item deve nascer ativo');

  // Update sem imageKey não pode apagar a imagem existente.
  const updated = await itemModel.updateItem(item.itemId, { name: 'Smoke 2', description: 'x', price: 600 });
  assert.strictEqual(updated.imageKey, 'itens/smoke.png', 'update sem imagem preservou imageKey');
  assert.strictEqual(updated.price, 600);

  assert.strictEqual(await itemModel.updateItem('00000000-0000-0000-0000-000000000000', { name: 'x', price: 1 }), null, 'update de item inexistente devolve null');

  const deactivated = await itemModel.deactivateItem(item.itemId);
  assert.strictEqual(deactivated.active, false);
  assert.ok(!(await itemModel.getAllItems({ onlyActive: true })).some((i) => i.itemId === item.itemId), 'item inativo some da listagem pública');

  const order = await orderModel.createOrder({
    buyerName: 'Smoke',
    buyerPhone: '11999999999',
    buyerEmail: 'smoke@teste.com',
    items: [{
      itemId: item.itemId, name: 'Smoke test', unitPrice: 500, quantity: 2,
    }],
    total: 1000,
  });
  assert.strictEqual(order.status, 'pending');
  assert.strictEqual((await orderModel.getOrderById(order.orderId)).items[0].quantity, 2, 'items volta como JSON, não string');

  const paid = await orderModel.updateOrderPayment(order.orderId, {
    mpOrderId: 'mp-1', mpStatus: 'processed', qrCode: 'qr', qrCodeBase64: 'b64', status: 'paid',
  });
  assert.strictEqual(paid.status, 'paid');
  assert.strictEqual(await orderModel.updateOrderStatus('00000000-0000-0000-0000-000000000000', 'ready'), null, 'status de pedido inexistente devolve null');

  const email = `smoke-${Date.now()}@teste.com`;
  await userModel.createUser({ email, passwordHash: 'hash' });
  assert.strictEqual((await userModel.getUserByEmail(email)).passwordHash, 'hash');
  await assert.rejects(
    userModel.createUser({ email, passwordHash: 'hash' }),
    (err) => err.name === 'SequelizeUniqueConstraintError',
    'e-mail duplicado precisa estourar UniqueConstraint (vira 409)',
  );

  await Item.destroy({ where: { itemId: item.itemId } });
  await sequelize.models.Order.destroy({ where: { orderId: order.orderId } });
  await User.destroy({ where: { email } });

  console.log('OK  banco (Sequelize/PostgreSQL)');
}

async function checkStorage() {
  if (!process.env.MGC_BUCKET || !process.env.MGC_ACCESS_KEY_ID) {
    console.log('--  object storage: MGC_BUCKET/MGC_ACCESS_KEY_ID não configurados, pulando');
    return;
  }

  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const key = await storageService.uploadItemImage('smoke', { originalname: 'smoke.png', buffer: png, mimetype: 'image/png' });
  const url = storageService.buildImageUrl(key);

  const res = await fetch(url);
  assert.strictEqual(res.status, 200, `imagem precisa ser pública (${url} devolveu ${res.status})`);

  await storageService.deleteItemImage(key);
  console.log(`OK  object storage (Magalu) — ${url}`);
}

checkDatabase()
  .then(checkStorage)
  .then(() => sequelize.close())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FALHOU:', err);
    process.exit(1);
  });

const itemModel = require('../models/itemModel');
const orderModel = require('../models/orderModel');
const mercadoPagoService = require('../services/mercadoPagoService');
const errorService = require('../services/errorService');
const socketService = require('../services/socketService');

const VALID_STATUSES = ['pending', 'paid', 'ready', 'delivered', 'cancelled'];

async function createOrder({ req, res }) {
  const {
    buyerName, buyerPhone, buyerEmail, items,
  } = req.body;

  if (!buyerName || !buyerPhone || !buyerEmail || !Array.isArray(items) || items.length === 0) {
    return errorService.returnError(
      res,
      errorService.validationError,
      'buyerName, buyerPhone, buyerEmail e items são obrigatórios.',
    );
  }

  const orderItems = [];
  let total = 0;

  for (let i = 0; i < items.length; i += 1) {
    const { itemId, quantity } = items[i];
    // eslint-disable-next-line no-await-in-loop
    const item = await itemModel.getItemById(itemId);

    if (!item || !item.active) {
      return errorService.returnError(res, errorService.validationError, `Item ${itemId} indisponível.`);
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return errorService.returnError(res, errorService.validationError, `Quantidade inválida para o item ${itemId}.`);
    }

    orderItems.push({
      itemId: item.itemId, name: item.name, unitPrice: item.price, quantity,
    });
    total += item.price * quantity;
  }

  const order = await orderModel.createOrder({
    buyerName, buyerPhone, buyerEmail, items: orderItems, total,
  });

  try {
    const mpOrder = await mercadoPagoService.createPixOrder({
      amount: total / 100,
      orderId: order.orderId,
      payerEmail: buyerEmail,
      payerFirstName: buyerName.split(' ')[0],
    });

    const updatedOrder = await orderModel.updateOrderPayment(order.orderId, {
      mpOrderId: mpOrder.mpOrderId,
      mpStatus: mpOrder.status,
      qrCode: mpOrder.qrCode,
      qrCodeBase64: mpOrder.qrCodeBase64,
      status: 'pending',
    });

    socketService.emitOrderUpdated(updatedOrder);
    return res.status(201).json(updatedOrder);
  } catch (err) {
    console.error('Falha ao gerar pagamento Pix:', err.cause ?? err);
    const cancelledOrder = await orderModel.updateOrderStatus(order.orderId, 'cancelled');
    socketService.emitOrderUpdated(cancelledOrder);
    return errorService.returnError(res, errorService.internalError, 'Falha ao gerar pagamento Pix.');
  }
}

async function getAllOrders({ req, res }) {
  const orders = await orderModel.getAllOrders({ status: req.query.status });
  return res.json(orders);
}

async function getOrderById({ req, res }) {
  const order = await orderModel.getOrderById(req.params.id);
  if (!order) {
    return errorService.returnError(res, errorService.notFound);
  }
  return res.json(order);
}

async function updateOrderStatus({ req, res }) {
  const { status } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return errorService.returnError(res, errorService.validationError, `status deve ser um de: ${VALID_STATUSES.join(', ')}.`);
  }

  const order = await orderModel.updateOrderStatus(req.params.id, status);

  if (!order) {
    return errorService.returnError(res, errorService.notFound);
  }

  socketService.emitOrderUpdated(order);
  return res.json(order);
}

async function handleMercadoPagoWebhook({ req, res }) {
  const mpOrderId = req.query['data.id'] || req.body?.data?.id;

  if (!mpOrderId) {
    return res.sendStatus(200);
  }

  let mpOrder;
  try {
    mpOrder = await mercadoPagoService.getOrder(mpOrderId);
  } catch (err) {
    console.error(`Falha ao buscar order ${mpOrderId} no Mercado Pago (webhook):`, err.cause ?? err);
    return res.sendStatus(200);
  }

  const order = await orderModel.getOrderById(mpOrder.externalReference);

  if (!order || order.status !== 'pending') {
    return res.sendStatus(200);
  }

  const statusMap = {
    processed: 'paid', expired: 'cancelled', canceled: 'cancelled', failed: 'cancelled',
  };
  const nextStatus = statusMap[mpOrder.status];

  if (nextStatus) {
    const updatedOrder = await orderModel.updateOrderPayment(order.orderId, {
      mpOrderId: mpOrder.mpOrderId,
      mpStatus: mpOrder.status,
      qrCode: order.qrCode,
      qrCodeBase64: order.qrCodeBase64,
      status: nextStatus,
    });
    socketService.emitOrderUpdated(updatedOrder);
  }

  return res.sendStatus(200);
}

module.exports = {
  createOrder, getAllOrders, getOrderById, updateOrderStatus, handleMercadoPagoWebhook,
};

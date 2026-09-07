const { Order } = require('../services/databaseService');

async function createOrder({
  buyerName, buyerPhone, buyerEmail, items, total,
}) {
  const order = await Order.create({
    buyerName,
    buyerPhone,
    buyerEmail,
    items,
    total,
    status: 'pending',
    createdAt: new Date(),
  });

  return order.get({ plain: true });
}

async function getAllOrders({ status } = {}) {
  return Order.findAll({
    ...(status && { where: { status } }),
    order: [['createdAt', 'DESC']],
    raw: true,
  });
}

async function getOrderById(orderId) {
  return Order.findByPk(orderId, { raw: true });
}

// Devolve null quando o pedido não existe — controllers tratam como 404.
async function updateOrderStatus(orderId, status) {
  const [, [updated]] = await Order.update(
    { status },
    { where: { orderId }, returning: true },
  );

  return updated ? updated.get({ plain: true }) : null;
}

async function updateOrderPayment(orderId, {
  mpOrderId, mpStatus, qrCode, qrCodeBase64, status,
}) {
  const [, [updated]] = await Order.update(
    {
      mpOrderId, mpStatus, qrCode, qrCodeBase64, status,
    },
    { where: { orderId }, returning: true },
  );

  return updated ? updated.get({ plain: true }) : null;
}

module.exports = {
  createOrder,
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  updateOrderPayment,
};

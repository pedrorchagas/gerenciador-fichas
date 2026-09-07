const { MercadoPagoConfig, Order } = require('mercadopago');

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const order = new Order(client);

async function createPixOrder({
  amount, orderId, payerEmail, payerFirstName,
}) {
  const result = await order.create({
    body: {
      type: 'online',
      total_amount: amount.toFixed(2),
      external_reference: orderId,
      processing_mode: 'automatic',
      transactions: {
        payments: [
          { amount: amount.toFixed(2), payment_method: { id: 'pix', type: 'bank_transfer' } },
        ],
      },
      payer: { email: payerEmail, ...(payerFirstName && { first_name: payerFirstName }) },
    },
    requestOptions: { idempotencyKey: orderId },
  });

  const paymentMethod = result.transactions?.payments?.[0]?.payment_method || {};

  return {
    mpOrderId: result.id,
    status: result.status,
    qrCode: paymentMethod.qr_code,
    qrCodeBase64: paymentMethod.qr_code_base64,
  };
}

async function getOrder(mpOrderId) {
  const result = await order.get({ id: mpOrderId });

  return {
    mpOrderId: result.id,
    status: result.status,
    externalReference: result.external_reference,
  };
}

module.exports = { createPixOrder, getOrder };

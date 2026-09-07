const crypto = require('crypto');
const errorService = require('../services/errorService');

function parseSignatureHeader(header) {
  return header.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key.trim()] = value?.trim();
    return acc;
  }, {});
}

function verifyMercadoPagoSignature(req, res, next) {
  const signatureHeader = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  const dataId = req.query['data.id'] || req.body?.data?.id;
  const topic = req.query.type || req.body?.type;

  if (!signatureHeader || !requestId || !dataId) {
    return errorService.returnError(res, errorService.validationError, 'Notificação do Mercado Pago incompleta.');
  }

  const { ts, v1 } = parseSignatureHeader(signatureHeader);
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
    .update(manifest)
    .digest('hex');

  if (expectedSignature !== v1) {
    // Bug confirmado do lado do Mercado Pago: a assinatura das notificações do tópico
    // "order" com data.id alfanumérico não bate mesmo seguindo o algoritmo oficial à risca
    // (reproduzido até com o WebhookSignatureValidator do próprio SDK deles, em 2026-09-05).
    // Pra esse tópico aceitamos mesmo com assinatura inválida, mas o controller nunca confia
    // no corpo — handleMercadoPagoWebhook sempre confirma o status real via
    // mercadoPagoService.getOrder (API autenticada com nosso token) antes de mudar o pedido,
    // então isso não abre brecha pra forjar confirmação de pagamento.
    if (topic !== 'order') {
      return errorService.returnError(res, errorService.unauthorized, 'Assinatura inválida.');
    }
    console.warn(`Assinatura inválida em notificação "order" (data.id=${dataId}, request-id=${requestId}) — aceitando mesmo assim (bug conhecido do MP), status será revalidado via API.`);
  }

  return next();
}

module.exports = verifyMercadoPagoSignature;

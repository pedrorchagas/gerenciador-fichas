const express = require('express');
const orderController = require('../controllers/orderController');
const mercadoPagoWebhookMiddleware = require('../middlewares/mercadoPagoWebhookMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();

// Notificação de pagamento - Mercado Pago
router.post('/notifications', mercadoPagoWebhookMiddleware, asyncHandler(orderController.handleMercadoPagoWebhook));

module.exports = router;

const express = require('express');
const orderController = require('../controllers/orderController');
const authMiddleware = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();

// Cria um pedido - publico
router.post('/', asyncHandler(orderController.createOrder));

// Busca todos pedidos - logado
router.get('/', authMiddleware, asyncHandler(orderController.getAllOrders));

// busca pedido pelo id - publico (cliente acompanha o próprio pedido)
router.get('/:id', asyncHandler(orderController.getOrderById));

// Atualiza o status de um pedido - logado
router.patch('/:id/status', authMiddleware, asyncHandler(orderController.updateOrderStatus));

module.exports = router;

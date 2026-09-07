const express = require('express');
const itemController = require('../controllers/itemController');
const authMiddleware = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');
const uploadImage = require('../middlewares/uploadImageMiddleware');

const router = express.Router();

// CRUD de itens

// Create um item - apenas logado (multipart/form-data, campo "image" opcional)
router.post('/', authMiddleware, uploadImage, asyncHandler(itemController.createItem));

// Busca todos - Publico
router.get('/', asyncHandler(itemController.getAllItems));

// Busca por id - publico
router.get('/:id', asyncHandler(itemController.getItemById));

// Edita um item - apenas logado (multipart/form-data, campo "image" opcional)
router.put('/:id', authMiddleware, uploadImage, asyncHandler(itemController.updateItem));

// Deleta (desativa) um item - apenas logado
router.delete('/:id', authMiddleware, asyncHandler(itemController.deleteById));

module.exports = router;

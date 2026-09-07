const express = require('express');
const userController = require('../controllers/userController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();

// Cria um usuário
router.post('/register', asyncHandler(userController.register));

// Faz login
router.post('/login', asyncHandler(userController.login));

module.exports = router;

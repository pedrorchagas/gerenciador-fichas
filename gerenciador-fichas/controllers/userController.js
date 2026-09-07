const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const errorService = require('../services/errorService');

const SALT_ROUNDS = 10;

async function register({ req, res }) {
  const { email, password, registerSecret } = req.body;

  // Cadastro de operador é fechado: só quem tem a senha de convite cria conta.
  // Sem REGISTER_SECRET configurado, ninguém cria — falha fechada de propósito,
  // senão um deploy com .env incompleto deixaria o painel aberto pra qualquer um.
  if (!process.env.REGISTER_SECRET) {
    return errorService.returnError(res, errorService.internalError, 'Cadastro indisponível: REGISTER_SECRET não configurado no servidor.');
  }

  if (registerSecret !== process.env.REGISTER_SECRET) {
    return errorService.returnError(res, errorService.unauthorized, 'Senha de cadastro inválida.');
  }

  if (!email || !password) {
    return errorService.returnError(res, errorService.validationError, 'email e password são obrigatórios.');
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await userModel.createUser({ email, passwordHash });
    return res.status(201).json(user);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return errorService.returnError(res, errorService.conflict, 'Usuário já cadastrado.');
    }
    throw err;
  }
}

async function login({ req, res }) {
  const { email, password } = req.body;

  if (!email || !password) {
    return errorService.returnError(res, errorService.validationError, 'email e password são obrigatórios.');
  }

  const user = await userModel.getUserByEmail(email);
  if (!user) {
    return errorService.returnError(res, errorService.unauthorized);
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return errorService.returnError(res, errorService.unauthorized);
  }

  const token = jwt.sign({ id: user.email, email: user.email }, process.env.JWT_SECRET, { expiresIn: '12h' });
  return res.json({ token });
}

module.exports = { register, login };

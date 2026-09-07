const { User } = require('../services/databaseService');

// Lança SequelizeUniqueConstraintError se o e-mail já existe (PK) — vira 409 no controller.
async function createUser({ email, passwordHash }) {
  await User.create({ email, passwordHash });

  return { email };
}

async function getUserByEmail(email) {
  return User.findByPk(email, { raw: true });
}

module.exports = { createUser, getUserByEmail };

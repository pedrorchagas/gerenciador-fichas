const jwt = require('jsonwebtoken');
const errorService = require('../services/errorService');

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return errorService.returnError(res, errorService.tokenNotFound);
  }

  return jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
    if (err) {
      return errorService.returnError(res, errorService.invalidToken);
    }

    req.user = {
      id: payload.id,
      email: payload.email,
    };

    return next();
  });
}

module.exports = authenticateToken;

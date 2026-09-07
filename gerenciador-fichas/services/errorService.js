const errors = {
  tokenNotFound: { status: 401, message: 'Token não informado.' },
  invalidToken: { status: 401, message: 'Token inválido ou expirado.' },
  notFound: { status: 404, message: 'Recurso não encontrado.' },
  validationError: { status: 400, message: 'Dados inválidos.' },
  unauthorized: { status: 401, message: 'Credenciais inválidas.' },
  conflict: { status: 409, message: 'Recurso já existe.' },
  internalError: { status: 500, message: 'Erro interno do servidor.' },
};

function returnError(res, error, details) {
  return res.status(error.status).json({ message: error.message, details });
}

module.exports = { ...errors, returnError };

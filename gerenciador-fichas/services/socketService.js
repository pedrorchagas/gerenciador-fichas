const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

let io = null;

function init(server) {
  io = new Server(server, { cors: { origin: '*' } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Token não informado.'));
    }

    return jwt.verify(token, process.env.JWT_SECRET, (err) => {
      if (err) {
        return next(new Error('Token inválido ou expirado.'));
      }
      return next();
    });
  });

  return io;
}

function emitOrderUpdated(order) {
  if (io) {
    io.emit('pedidoAtualizado', order);
  }
}

module.exports = { init, emitOrderUpdated };

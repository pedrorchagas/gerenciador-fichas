const itemRoute = require('./itemRoute');
const orderRoute = require('./orderRoute');
const authRoute = require('./authRoute');
const paymentRoute = require('./paymentRoute');

function handleRoutes(app) {
  app.use('/itens', itemRoute);
  app.use('/pedidos', orderRoute);
  app.use('/auth', authRoute);
  app.use('/pagamentos', paymentRoute);
}

module.exports = handleRoutes;

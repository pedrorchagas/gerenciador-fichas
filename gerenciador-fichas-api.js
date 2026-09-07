const dotenv = require('dotenv');

dotenv.config();

const express = require('express');
const path = require('path');
const logger = require('morgan');
const http = require('http');
const routes = require('./gerenciador-fichas/routes/routes');
const errorService = require('./gerenciador-fichas/services/errorService');
const socketService = require('./gerenciador-fichas/services/socketService');

const app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
// Front (HTML/CSS/JS puro) servido pela própria API: mesma origem resolve
// CORS — a REST hoje não manda nenhum header Access-Control-*. Ver front/README.md.
app.use(express.static(path.join(__dirname, 'front')));

routes(app);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  errorService.returnError(res, errorService.internalError);
});

const port = 3000;

app.set('port', port);

const server = http.createServer(app);

socketService.init(server);

server.listen(port);

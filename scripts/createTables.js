const dotenv = require('dotenv');

dotenv.config();

const { sequelize } = require('../gerenciador-fichas/services/databaseService');

// Idempotente: cria as tabelas que faltam e não mexe nas que já existem.
// Alterações de coluna em tabela existente NÃO são aplicadas — pra isso, rode a
// migração manualmente no psql.
// ponytail: sync() no lugar de migrations; migre pra umzug se o schema começar a evoluir.
sequelize.sync()
  .then(() => {
    console.log('Tabelas prontas.');
    return sequelize.close();
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Falha ao criar tabelas:', err);
    process.exit(1);
  });

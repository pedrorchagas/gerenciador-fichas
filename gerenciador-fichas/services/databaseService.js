const { Sequelize, DataTypes } = require('sequelize');

// Magalu Cloud DBaaS (PostgreSQL) exige TLS. Os certificados são de CA pública,
// mas o hostname do endpoint gerenciado nem sempre bate com o CN do certificado
// — por isso rejectUnauthorized: false, alinhado ao que o painel da Magalu
// documenta pro cliente psql (`sslmode=require`).
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: process.env.DB_SSL === 'false' ? false : { require: true, rejectUnauthorized: false },
  },
});

const Item = sequelize.define('Item', {
  itemId: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  name: { type: DataTypes.STRING, allowNull: false },
  description: DataTypes.TEXT,
  price: { type: DataTypes.INTEGER, allowNull: false }, // centavos
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  imageKey: DataTypes.STRING,
}, { tableName: process.env.ITEMS_TABLE || 'fichas_itens', timestamps: false });

const Order = sequelize.define('Order', {
  orderId: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  buyerName: { type: DataTypes.STRING, allowNull: false },
  buyerPhone: { type: DataTypes.STRING, allowNull: false },
  buyerEmail: { type: DataTypes.STRING, allowNull: false },
  // Snapshot do item no momento da compra — sem tabela de junção, como no desenho original.
  items: { type: DataTypes.JSONB, allowNull: false },
  total: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
  mpOrderId: DataTypes.STRING,
  mpStatus: DataTypes.STRING,
  qrCode: DataTypes.TEXT,
  qrCodeBase64: DataTypes.TEXT,
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { tableName: process.env.ORDERS_TABLE || 'fichas_pedidos', timestamps: false });

const User = sequelize.define('User', {
  email: { type: DataTypes.STRING, primaryKey: true },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
}, { tableName: process.env.USERS_TABLE || 'fichas_usuarios', timestamps: false });

module.exports = {
  sequelize, Item, Order, User,
};

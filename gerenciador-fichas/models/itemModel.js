const { Item } = require('../services/databaseService');

async function createItem({
  itemId, name, description, price, imageKey,
}) {
  const item = await Item.create({
    itemId, name, description, price, imageKey,
  });

  return item.get({ plain: true });
}

async function getAllItems({ onlyActive } = {}) {
  return Item.findAll({
    ...(onlyActive && { where: { active: true } }),
    raw: true,
  });
}

async function getItemById(itemId) {
  return Item.findByPk(itemId, { raw: true });
}

// Devolve null quando o item não existe — controllers tratam como 404.
async function updateItem(itemId, {
  name, description, price, imageKey,
}) {
  const [, [updated]] = await Item.update(
    // imageKey undefined não entra no SET: update sem imagem nova não apaga a existente.
    {
      name, description, price, ...(imageKey !== undefined && { imageKey }),
    },
    { where: { itemId }, returning: true },
  );

  return updated ? updated.get({ plain: true }) : null;
}

// Soft-delete: pedidos antigos referenciam o item embutido, não pode sumir.
async function deactivateItem(itemId) {
  const [, [updated]] = await Item.update(
    { active: false },
    { where: { itemId }, returning: true },
  );

  return updated ? updated.get({ plain: true }) : null;
}

module.exports = {
  createItem, getAllItems, getItemById, updateItem, deactivateItem,
};

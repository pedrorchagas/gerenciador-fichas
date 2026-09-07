const crypto = require('crypto');
const itemModel = require('../models/itemModel');
const errorService = require('../services/errorService');
const storageService = require('../services/storageService');

function withImageUrl(item) {
  if (!item) return item;
  return { ...item, imageUrl: storageService.buildImageUrl(item.imageKey) };
}

async function createItem({ req, res }) {
  const { name, description } = req.body;
  const price = Number(req.body.price);

  if (!name || Number.isNaN(price)) {
    return errorService.returnError(res, errorService.validationError, 'name e price são obrigatórios.');
  }

  const itemId = crypto.randomUUID();
  const imageKey = req.file ? await storageService.uploadItemImage(itemId, req.file) : undefined;

  const item = await itemModel.createItem({
    itemId, name, description, price, imageKey,
  });
  return res.status(201).json(withImageUrl(item));
}

async function getAllItems({ res }) {
  const items = await itemModel.getAllItems({ onlyActive: true });
  return res.json(items.map(withImageUrl));
}

async function getItemById({ req, res }) {
  const item = await itemModel.getItemById(req.params.id);
  if (!item) {
    return errorService.returnError(res, errorService.notFound);
  }
  return res.json(withImageUrl(item));
}

async function updateItem({ req, res }) {
  const { name, description } = req.body;
  const price = Number(req.body.price);

  if (!name || Number.isNaN(price)) {
    return errorService.returnError(res, errorService.validationError, 'name e price são obrigatórios.');
  }

  let imageKey;
  if (req.file) {
    const existing = await itemModel.getItemById(req.params.id);
    imageKey = await storageService.uploadItemImage(req.params.id, req.file);
    if (existing && existing.imageKey) {
      await storageService.deleteItemImage(existing.imageKey);
    }
  }

  const item = await itemModel.updateItem(req.params.id, {
    name, description, price, imageKey,
  });

  if (!item) {
    return errorService.returnError(res, errorService.notFound);
  }

  return res.json(withImageUrl(item));
}

async function deleteById({ req, res }) {
  const item = await itemModel.deactivateItem(req.params.id);

  if (!item) {
    return errorService.returnError(res, errorService.notFound);
  }

  return res.json(item);
}

module.exports = {
  createItem, getAllItems, getItemById, updateItem, deleteById,
};

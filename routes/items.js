const express = require('express');
const router = express.Router();
const { 
    readJSON, 
    writeJSON 
} = require('../helpers/database');
const { logAction } = require('../helpers/logger');
const apiKeyAuth = require('../middleware/auth');

router.get('/:id', apiKeyAuth, async (req, res) => {
  console.log(`[GET ITEM] ID: ${req.params.id}`);
  try {
    const items = await readJSON('items');
    const item = items.find(i => i.id === req.params.id);

    if (!item) {
      console.log(`[GET ITEM] Item not found: ${req.params.id}`);
      return res.status(404).json({ status: false, error: 'Item not found' });
    }

    res.json({ status: true, data: item });
  } catch (error) {
    console.error('[GET ITEM ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

router.post('/', apiKeyAuth, async (req, res) => {
  console.log('[CREATE ITEM] Request body:', req.body);
  try {
    const items = await readJSON('items');
    const itemName = req.body.name.trim().toLowerCase();
    const existing = items.find(i => i.name.trim().toLowerCase() === itemName);

    if (existing) {
      console.log(`[CREATE ITEM] Updating stock for: ${existing.name}`);
      existing.stock += parseInt(req.body.stock) || 0;
      await logAction(req.user, `Stock updated for ${existing.name}`);
    } else {
      const newItem = {
        id: Math.random().toString(36).substr(2, 6).toUpperCase(),
        ...req.body,
        name: req.body.name.trim(),
        category: req.body.category || 'Uncategorized', 
        photo: null,
        discount: 0,
        stock: parseInt(req.body.stock) || 0
      };
      console.log(`[CREATE ITEM] New item created: ${newItem.name}`);
      items.push(newItem);
      await logAction(req.user, `New item created: ${newItem.name}`);
    }

    await writeJSON('items', items);
    res.status(201).json({ status: true, data: items });
  } catch (error) {
    console.error('[CREATE ITEM ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

router.put('/:id', apiKeyAuth, async (req, res) => {
  console.log(`[UPDATE ITEM] ID: ${req.params.id}, Body:`, req.body);
  try {
    const items = await readJSON('items');
    const item = items.find(i => i.id === req.params.id);

    if (!item) {
      console.log(`[UPDATE ITEM] Item not found: ${req.params.id}`);
      return res.status(404).json({ status: false, error: 'Item not found' });
    }

    const updateData = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (value !== undefined && value !== null) {
        if (typeof value === 'string') {
          const trimmedValue = value.trim();
          if (trimmedValue !== '') {
            updateData[key] = trimmedValue;
          }
        } else {
          updateData[key] = value;
        }
      }
    }

    if (updateData.name) {
      const newName = updateData.name.trim().toLowerCase();
      const existingItem = items.find(i => 
        i.id !== req.params.id && 
        i.name.trim().toLowerCase() === newName
      );

      if (existingItem) {
        return res.status(400).json({ 
          status: false, 
          error: 'Item name already exists' 
        });
      }
    }

    Object.assign(item, updateData);
    await writeJSON('items', items);
    await logAction(req.user, `Item updated: ${item.name}`);
    res.json({ status: true, data: item });
  } catch (error) {
    console.error('[UPDATE ITEM ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

router.delete('/:id', apiKeyAuth, async (req, res) => {
  console.log(`[DELETE ITEM] ID: ${req.params.id}`);
  try {
    let items = await readJSON('items');
    const initialLength = items.length;
    items = items.filter(i => i.id !== req.params.id);

    if (items.length === initialLength) {
      console.log(`[DELETE ITEM] Item not found: ${req.params.id}`);
      return res.status(404).json({ status: false, error: 'Item not found' });
    }

    await writeJSON('items', items);
    await logAction(req.user, `Item deleted: ${req.params.id}`);
    res.status(200).json({ status: true, message: 'Item deleted successfully' });
  } catch (error) {
    console.error('[DELETE ITEM ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

module.exports = router;
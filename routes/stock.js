const express = require('express');
const router = express.Router();
const { readJSON } = require('../helpers/database');
const apiKeyAuth = require('../middleware/auth');

router.get('/', apiKeyAuth, async (req, res) => {
  console.log('[GET STOCK] Request received');
  try {
    const items = await readJSON('items');
    const sortedItems = items.sort((a, b) => a.stock - b.stock);
    res.json({ status: true, data: sortedItems });
  } catch (error) {
    console.error('[GET STOCK ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

router.get('/category/:category', apiKeyAuth, async (req, res) => {
  const category = req.params.category;
  console.log(`[GET STOCK BY CATEGORY] Category: ${category}`);
  try {
    const items = await readJSON('items');
    const filteredItems = items
      .filter(item => item.category && item.category.toLowerCase() === category.toLowerCase())
      .sort((a, b) => a.stock - b.stock);

    res.json({ status: true, data: filteredItems });
  } catch (error) {
    console.error('[GET STOCK BY CATEGORY ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

module.exports = router;
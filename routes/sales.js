const express = require('express');
const router = express.Router();
const { generatePurchaseID } = require('../helpers/purchase');
const { logAction } = require('../helpers/logger');
const { createDailyReport } = require('../helpers/reports');
const { 
    readJSON, 
    writeJSON 
} = require('../helpers/database');
const moment = require('../config/timezone'); 
const apiKeyAuth = require('../middleware/auth');

router.post('/', apiKeyAuth, async (req, res) => {
  console.log('[CREATE SALE] Request body:', req.body);
  try {
    const { buyer, items: saleItems, paymentAmount } = req.body;

    if (!buyer || !saleItems || !Array.isArray(saleItems) || paymentAmount === undefined) {
      return res.status(400).json({ 
        status: false, 
        error: 'Invalid request format. Buyer, items, and paymentAmount are required.' 
      });
    }

    const date = moment();
    const salesFile = `sales-${date.format('YYYY-MM')}`;

    let sales = await readJSON(salesFile);
    if (!Array.isArray(sales)) {
      sales = [];
    }

    const store = await readJSON('store');
    const purchaseId = await generatePurchaseID();

    const sale = {
      id: purchaseId,
      timestamp: date.format(),
      cashier: store.cashier || 'Unknown',
      buyer,
      items: [],
      total: 0,
      paymentAmount: parseFloat(paymentAmount),
      change: 0
    };

    const allItems = await readJSON('items');

    for (const item of saleItems) {
      const product = allItems.find(p => p.id === item.id);
      if (!product) {
        return res.status(400).json({ status: false, error: `Item ${item.id} not found` });
      }

      if (product.stock < item.qty) {
        return res.status(400).json({ status: false, error: `Insufficient stock for ${product.name}` });
      }

      product.stock -= item.qty;
      const originalPrice = product.price;
      const discount = product.discount || 0;
      const discountedPrice = originalPrice * (1 - discount / 100);
      const itemTotal = item.qty * discountedPrice;

      sale.items.push({
        id: item.id,
        name: product.name,
        qty: item.qty,
        price: originalPrice,    
        discount: discount,      
        total: itemTotal         
      });

      sale.total += itemTotal;
    }

    if (sale.paymentAmount < sale.total) {
      return res.status(400).json({ 
        status: false, 
        error: `Insufficient payment. Total: ${sale.total}, Received: ${sale.paymentAmount}` 
      });
    }

    sale.change = sale.paymentAmount - sale.total;

    await Promise.all([
      writeJSON('items', allItems),
      writeJSON(salesFile, sales)
    ]);

    await createDailyReport(sale);
    await logAction(req.user, `New sale: ${sale.id}`);
    res.status(201).json({ status: true, data: sale });
  } catch (error) {
    console.error('[CREATE SALE ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

module.exports = router;
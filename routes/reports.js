const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const apiKeyAuth = require('../middleware/auth');
const { readJSON } = require('../helpers/database');
const moment = require('../config/timezone'); 
const { 
    createDailyReport, 
    updateMonthlyReport 
} = require('../helpers/reports'); 

const dataPath = path.join(__dirname, '../data');

router.get('/popular', apiKeyAuth, async (req, res) => {
  try {
    const files = await fs.readdir(path.join(dataPath, 'reports/monthly'));
    const monthlyReports = await Promise.all(
      files.map(file => readJSON(`reports/monthly/${path.parse(file).name}`))
    );

    const itemMap = new Map();

    monthlyReports.forEach(report => {
      Object.entries(report.popularItems).forEach(([id, item]) => {
        const existing = itemMap.get(id) || { id, name: item.name, quantity: 0 };
        existing.quantity += item.quantity;
        itemMap.set(id, existing);
      });

      report.transactions.forEach(transaction => {
        transaction.items.forEach(item => {
          const existing = itemMap.get(item.id) || { id: item.id, name: item.name, quantity: 0 };
          existing.quantity += item.qty;
          itemMap.set(item.id, existing);
        });
      });
    });

    const popularItems = Array.from(itemMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    res.json({ status: true, data: popularItems });
  } catch (error) {
    console.error('[REPORT POPULAR ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

router.get('/top-customers', apiKeyAuth, async (req, res) => {
  try {
    const files = await fs.readdir(path.join(dataPath, 'reports/monthly'));
    const monthlyReports = await Promise.all(
      files.map(file => readJSON(`reports/monthly/${path.parse(file).name}`))
    );

    const customerMap = new Map();

    monthlyReports.forEach(report => {
      report.topCustomers.forEach(customer => {
        const existing = customerMap.get(customer.customer) || { 
          customer: customer.customer, 
          total: 0 
        };
        existing.total += customer.total;
        customerMap.set(customer.customer, existing);
      });

      report.transactions.forEach(transaction => {
        const normalizedName = transaction.buyer.trim().toLowerCase();
        const existing = customerMap.get(normalizedName) || { 
          customer: normalizedName, 
          total: 0 
        };
        existing.total += transaction.total;
        customerMap.set(normalizedName, existing);
      });
    });

    const topCustomers = Array.from(customerMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map(c => ({ ...c, total: parseFloat(c.total.toFixed(2)) }));

    res.json({ status: true, data: topCustomers });
  } catch (error) {
    console.error('[REPORT TOP CUSTOMERS ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

router.get('/daily/:date', apiKeyAuth, async (req, res) => {
  const date = req.params.date;
  console.log(`[GET DAILY REPORT] Date: ${date}`);
  try {
    const dailyReportFile = `reports/daily/${date}`;
    const dailyReport = await readJSON(dailyReportFile);

    res.json({ status: true, data: dailyReport });
  } catch (error) {
    console.error('[GET DAILY REPORT ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

router.get('/monthly/:yearMonth', apiKeyAuth, async (req, res) => {
  const yearMonth = req.params.yearMonth; 
  console.log(`[GET MONTHLY REPORT] YearMonth: ${yearMonth}`);
  try {
    const monthlyReportFile = `reports/monthly/${yearMonth}`;
    const monthlyReport = await readJSON(monthlyReportFile);

    res.json({ status: true, data: monthlyReport });
  } catch (error) {
    console.error('[GET MONTHLY REPORT ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

router.get('/download', apiKeyAuth, async (req, res) => {
  console.log('[DOWNLOAD REPORT] Request received');
  try {
    const files = await fs.readdir(dataPath);
    const salesFiles = files.filter(f => f.startsWith('sales-') && f.endsWith('.json'));
    console.log(`[DOWNLOAD REPORT] Found ${salesFiles.length} sales files`);

    const allSales = [];
    for(const file of salesFiles) {
      const sales = await readJSON(path.parse(file).name);
      allSales.push(...sales);
    }

    const csvData = allSales.map(sale => {
      return sale.items.map(item => {
        const saleDate = moment(sale.timestamp).format();
        return `${sale.timestamp},${sale.buyer},${item.name},${item.qty},${item.price},${item.total}`;
      }).join('\n');
    }).join('\n');

    const csvHeader = 'Timestamp,Buyer,Item Name,Quantity,Price,Total\n';
    const csv = csvHeader + csvData;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=sales-report.csv');
    res.send(csv);
  } catch (error) {
    console.error('[DOWNLOAD REPORT ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

module.exports = router;

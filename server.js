const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid');
const app = express();
const port = 3000;

app.set('trust proxy', 1);
app.set('json spaces', 2);

moment.tz.setDefault('Asia/Jakarta');
// Konfigurasi
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Helper functions
const dataPath = path.join(__dirname, 'data');
const readJSON = async (file) => {
  try {
    const data = await fs.readFile(path.join(dataPath, `${file}.json`), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

const writeJSON = async (file, data) => {
  await fs.writeFile(path.join(dataPath, `${file}.json`), JSON.stringify(data, null, 2));
};

const generatePurchaseID = async () => {
  const now = moment();
  const datePart = now.format('DDMMYY');
  const counterKey = now.format('YYYY-MM-DD');
  
  let counters = await readJSON('purchase-counters');
  let counter = counters.find(c => c.date === counterKey);
  
  if (!counter) {
    counter = { date: counterKey, sequence: 0 };
    counters.push(counter);
  }
  
  counter.sequence++;
  await writeJSON('purchase-counters', counters);
  
  return `${datePart}${counter.sequence.toString().padStart(3, '0')}`;
};

// Middleware API Key
const apiKeyAuth = async (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  if (!apiKey) return res.status(401).json({ status: false, error: 'API Key required' });

  try {
    const keys = await readJSON('api-keys');
    const validKey = keys.find(k => k.key === apiKey);
    if (!validKey) return res.status(403).json({ status: false, error: 'Invalid API Key' });

    req.user = validKey.user;
    next();
  } catch (error) {
    res.status(500).json({ status: false, error: error.message });
  }
};

// Generate ID
const generateID = () => {
  const id = Math.random().toString(36).substr(2, 6).toUpperCase();
  console.log(`[GENERATE ID] New ID: ${id}`);
  return id;
};

// Logging
const logAction = async (user, action) => {
  try {
    const logs = await readJSON('logs');
    logs.push({ 
      timestamp: moment().format(),
      user,
      action 
    });
    await writeJSON('logs', logs);
  } catch (error) {
    console.error('Logging error:', error);
  }
};

// Routes
app.get('/items/:id', apiKeyAuth, async (req, res) => {
  try {
    const items = await readJSON('items');
    const item = items.find(i => i.id === req.params.id);
    item ? res.json({ status: true, data: item }) : res.status(404).json({ status: false, error: 'Item not found' });
  } catch (error) {
    res.status(500).json({ status: false, error: error.message });
  }
});

app.post('/items', apiKeyAuth, async (req, res) => {
  try {
    const items = await readJSON('items');
    const itemName = req.body.name.trim().toLowerCase();
    const existing = items.find(i => i.name.trim().toLowerCase() === itemName);

    if (existing) {
      existing.stock += parseInt(req.body.stock) || 0;
    } else {
      items.push({
        id: uuidv4(),
        ...req.body,
        name: req.body.name.trim(),
        category: req.body.category || 'uncategorized',
        photo: null,
        stock: parseInt(req.body.stock) || 0
      });
    }

    await writeJSON('items', items);
    res.status(201).json({ status: true, data: items });
  } catch (error) {
    res.status(500).json({ status: false, error: error.message });
  }
});

app.put('/items/:id', apiKeyAuth, async (req, res) => {
  console.log(`[UPDATE ITEM] ID: ${req.params.id}, Body:`, req.body);
  try {
    const items = await readJSON('items');
    const item = items.find(i => i.id === req.params.id);

    if (!item) {
      console.log(`[UPDATE ITEM] Item not found: ${req.params.id}`);
      return res.status(404).json({ status: false, error: 'Item not found' });
    }

    if (req.body.name) {
      const newName = req.body.name.trim().toLowerCase();
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
      req.body.name = req.body.name.trim();
    }

    Object.assign(item, req.body);
    await writeJSON('items', items);
    await logAction(req.user, `Item updated: ${item.name}`);
    res.json({ status: true, data: item });
  } catch (error) {
    console.error('[UPDATE ITEM ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

app.delete('/items/:id', apiKeyAuth, async (req, res) => {
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

app.post('/sales', apiKeyAuth, async (req, res) => {
  try {
    const { buyer, items: saleItems, amount } = req.body;
    if (!buyer || !saleItems || !Array.isArray(saleItems)) {
      return res.status(400).json({ status: false, error: 'Invalid request format' });
    }

    const transactionDate = moment();
    const dailySalesFile = `sales-${transactionDate.format('YYYY-MM-DD')}`;
    const monthlySalesFile = `sales-${transactionDate.format('YYYY-MM')}`;

    // Hitung total transaksi
    const allItems = await readJSON('items');
    let total = 0;
    const itemsWithDetails = [];
    
    for (const item of saleItems) {
      const product = allItems.find(p => p.id === item.id);
      if (!product) return res.status(400).json({ status: false, error: `Item ${item.id} not found` });
      if (product.stock < item.qty) return res.status(400).json({ status: false, error: `Insufficient stock for ${product.name}` });

      const price = product.price * (1 - (product.discount/100));
      const itemTotal = item.qty * price;
      total += itemTotal;
      
      itemsWithDetails.push({
        ...item,
        name: product.name,
        price,
        total: itemTotal
      });

      product.stock -= item.qty;
    }

    // Validasi pembayaran
    if (amount < total) {
      return res.status(400).json({ status: false, error: 'Insufficient payment' });
    }

    // Simpan transaksi
    const transaction = {
      id: await generatePurchaseID(),
      timestamp: transactionDate.format(),
      cashier: req.user,
      buyer,
      items: itemsWithDetails,
      total,
      payment: amount,
      change: amount - total
    };

    const [dailySales, monthlySales] = await Promise.all([
      readJSON(dailySalesFile),
      readJSON(monthlySalesFile)
    ]);

    await Promise.all([
      writeJSON('items', allItems),
      writeJSON(dailySalesFile, [...dailySales, transaction]),
      writeJSON(monthlySalesFile, [...monthlySales, transaction])
    ]);

    res.status(201).json({ status: true, data: transaction });
  } catch (error) {
    res.status(500).json({ status: false, error: error.message });
  }
});

app.get('/reports/daily/:date', apiKeyAuth, async (req, res) => {
  try {
    const sales = await readJSON(`sales-${req.params.date}`);
    const totalRevenue = sales.reduce((sum, t) => sum + t.total, 0);
    
    res.json({
      status: true,
      data: {
        date: req.params.date,
        total_transactions: sales.length,
        total_revenue: totalRevenue,
        transactions: sales
      }
    });
  } catch (error) {
    res.status(500).json({ status: false, error: error.message });
  }
});

app.get('/reports/monthly/:yearMonth', apiKeyAuth, async (req, res) => {
  try {
    const sales = await readJSON(`sales-${req.params.yearMonth}`);
    const totalRevenue = sales.reduce((sum, t) => sum + t.total, 0);
    
    // Hitung pelanggan teratas
    const customerSpending = sales.reduce((acc, t) => {
      acc[t.buyer] = (acc[t.buyer] || 0) + t.total;
      return acc;
    }, {});
    
    // Hitung barang populer
    const itemSales = sales.reduce((acc, t) => {
      t.items.forEach(item => {
        acc[item.id] = (acc[item.id] || 0) + item.qty;
      });
      return acc;
    }, {});

    res.json({
      status: true,
      data: {
        month: req.params.yearMonth,
        total_transactions: sales.length,
        total_revenue: totalRevenue,
        top_customers: Object.entries(customerSpending)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
        popular_items: Object.entries(itemSales)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
        daily_transactions: sales
      }
    });
  } catch (error) {
    res.status(500).json({ status: false, error: error.message });
  }
});

app.get('/stock/category', apiKeyAuth, async (req, res) => {
  try {
    const items = await readJSON('items');
    const stockByCategory = items.reduce((acc, item) => {
      const category = item.category || 'uncategorized';
      acc[category] = (acc[category] || 0) + item.stock;
      return acc;
    }, {});
    
    res.json({ status: true, data: stockByCategory });
  } catch (error) {
    res.status(500).json({ status: false, error: error.message });
  }
});

app.get('/reports/stock', apiKeyAuth, async (req, res) => {
  console.log('[REPORT STOCK] Request received');
  try {
    const items = await readJSON('items');
    res.json({ status: true, data: items });
  } catch (error) {
    console.error('[REPORT STOCK ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

app.get('/reports/popular', apiKeyAuth, async (req, res) => {
  console.log('[REPORT POPULAR] Request received');
  try {
    const files = await fs.readdir(dataPath);
    const salesFiles = files.filter(f => f.startsWith('sales-') && f.endsWith('.json'));
    console.log(`[REPORT POPULAR] Found ${salesFiles.length} sales files`);

    const allSales = [];
    for(const file of salesFiles) {
      const sales = await readJSON(path.parse(file).name);
      allSales.push(...sales);
    }

    const itemCounts = allSales.reduce((acc, sale) => {
      sale.items.forEach(item => {
        const nameKey = item.name.trim().toLowerCase();
        acc[nameKey] = (acc[nameKey] || 0) + item.qty;
      });
      return acc;
    }, {});

    const items = await readJSON('items');
    const popularItems = Object.entries(itemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([nameKey, quantity]) => {
        const item = items.find(i => 
          i.name.trim().toLowerCase() === nameKey
        );
        return item ? { id: item.id, name: item.name, quantity } : null;
      })
      .filter(item => item !== null);

    res.json({ status: true, data: popularItems });
  } catch (error) {
    console.error('[REPORT POPULAR ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

app.get('/reports/top-customers', apiKeyAuth, async (req, res) => {
  console.log('[REPORT TOP CUSTOMERS] Request received');
  try {
    const files = await fs.readdir(dataPath);
    const salesFiles = files.filter(f => f.startsWith('sales-') && f.endsWith('.json'));
    console.log(`[REPORT TOP CUSTOMERS] Found ${salesFiles.length} sales files`);

    const allSales = [];
    for(const file of salesFiles) {
      const sales = await readJSON(path.parse(file).name);
      allSales.push(...sales);
    }

    const customerSpending = allSales.reduce((acc, sale) => {
      acc[sale.buyer] = (acc[sale.buyer] || 0) + sale.total;
      return acc;
    }, {});

    const topCustomers = Object.entries(customerSpending)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    res.json({ status: true, data: topCustomers });
  } catch (error) {
    console.error('[REPORT TOP CUSTOMERS ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

app.put('/store', apiKeyAuth, async (req, res) => {
  console.log('[UPDATE STORE] Request body:', req.body);
  try {
    await writeJSON('store', req.body);
    await logAction(req.user, 'Store settings updated');
    console.log('[UPDATE STORE] Success');
    res.json({ status: true, data: req.body });
  } catch (error) {
    console.error('[UPDATE STORE ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

app.post('/store/logo', apiKeyAuth, upload.single('logo'), async (req, res) => {
  console.log('[UPLOAD LOGO] File received:', req.file);
  try {
    const store = await readJSON('store');
    store.logo = `/uploads/${req.file.filename}`;
    await writeJSON('store', store);
    console.log('[UPLOAD LOGO] Success');
    res.json({ status: true, data: store });
  } catch (error) {
    console.error('[UPLOAD LOGO ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

app.get('/logs', apiKeyAuth, async (req, res) => {
  console.log('[GET LOGS] Request received');
  try {
    const logs = await readJSON('logs');
    res.json({ status: true, data: logs });
  } catch (error) {
    console.error('[GET LOGS ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

// Endpoint untuk mengunduh laporan penjualan
app.get('/reports/download', apiKeyAuth, async (req, res) => {
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

// Inisialisasi
app.listen(port, async () => {
  console.log(`Server running at http://localhost:${port}`);

  try {
    await fs.mkdir(dataPath, { recursive: true });
    console.log('[INIT] Created data directory');
    await fs.mkdir('uploads', { recursive: true });
    console.log('[INIT] Created uploads directory');

    const initialFiles = {
      'items': [],
      'logs': [],
      'store': {},
      'api-keys': [{ key: 'DEFAULT_KEY', user: 'admin' }]
    };

    for(const [file, data] of Object.entries(initialFiles)) {
      try {
        await readJSON(file);
        console.log(`[INIT] File ${file}.json already exists`);
      } catch (error) {
        if (error.code === 'ENOENT') {
          await writeJSON(file, data);
          console.log(`[INIT] Created ${file}.json`);
        }
      }
    }
  } catch (error) {
    console.error('[INIT ERROR]', error);
    process.exit(1);
  }
});
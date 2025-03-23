const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const moment = require('moment-timezone');
const app = express();
const port = 3000;

// Set zona waktu ke Asia/Jakarta
moment.tz.setDefault('Asia/Jakarta');

app.set('trust proxy', 1);
app.set('json spaces', 2);

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
const readJSON = async (file, defaultValue = []) => {
  try {
    const data = await fs.readFile(path.join(dataPath, `${file}.json`), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return defaultValue;
    throw error;
  }
};

const writeJSON = async (file, data) => {
  await fs.mkdir(path.dirname(path.join(dataPath, `${file}.json`)), { recursive: true });
  await fs.writeFile(path.join(dataPath, `${file}.json`), JSON.stringify(data, null, 2));
};

// Middleware API Key
const apiKeyAuth = async (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  console.log(`[AUTH] Checking API Key: ${apiKey}`);

  if (!apiKey) {
    console.log('[AUTH] No API Key provided');
    return res.status(401).json({ status: false, error: 'API Key required' });
  }

  try {
    const keys = await readJSON('api-keys');
    const validKey = keys.find(k => k.key === apiKey);

    if (!validKey) {
      console.log('[AUTH] Invalid API Key');
      return res.status(403).json({ status: false, error: 'Invalid API Key' });
    }

    req.user = validKey.user;
    console.log(`[AUTH] Authenticated user: ${validKey.user}`);
    next();
  } catch (error) {
    console.error('[AUTH ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
};

// Generate ID Pembelian berdasarkan format yang diminta
const generatePurchaseID = async () => {
  const now = moment();
  const formattedDate = now.format('DDMMYY');
  
  // Dapatkan tanggal hari ini dalam format YYYY-MM-DD untuk nama file laporan
  const today = now.format('YYYY-MM-DD');
  const dailyReportFile = `reports/daily/${today}`;
  
  try {
    // Baca laporan harian untuk menentukan nomor urut pembeli
    const dailyReport = await readJSON(dailyReportFile);
    // Jika sudah ada transaksi hari ini, ambil jumlah transaksi + 1, jika belum, mulai dari 1
    const orderNumber = dailyReport.transactions ? dailyReport.transactions.length + 1 : 1;
    
    // Format nomor urut dengan padding 3 digit
    const formattedOrderNumber = orderNumber.toString().padStart(3, '0');
    
    const purchaseID = `${formattedDate}${formattedOrderNumber}`;
    console.log(`[GENERATE PURCHASE ID] New ID: ${purchaseID}`);
    return purchaseID;
  } catch (error) {
    // Jika file laporan belum ada, berarti ini transaksi pertama hari ini
    console.log(`[GENERATE PURCHASE ID] First transaction of the day`);
    return `${formattedDate}001`;
  }
};

// Logging
const logAction = async (user, action) => {
  console.log(`[LOG ACTION] User: ${user}, Action: ${action}`);
  try {
    const logs = await readJSON('logs');
    logs.push({ 
      timestamp: moment().toISOString(),
      user,
      action 
    });
    await writeJSON('logs', logs);
  } catch (error) {
    console.error('[LOG ACTION ERROR]', error);
  }
};

// Membuat laporan harian
const createDailyReport = async (transaction) => {
  const now = moment();
  const today = now.format('YYYY-MM-DD');
  const dailyReportFile = `reports/daily/${today}`;
  
  try {
    // Baca laporan atau inisialisasi baru
    let dailyReport = await readJSON(dailyReportFile);
    
    // Handle jika file tidak ada atau format lama
    if (!dailyReport || Array.isArray(dailyReport)) {
      dailyReport = {
        date: today,
        totalRevenue: 0,
        transactionCount: 0,
        transactions: []
      };
    }

    // Pastikan transactions ada
    if (!dailyReport.transactions) {
      dailyReport.transactions = [];
    }

    // Tambahkan transaksi baru
    dailyReport.transactions.push(transaction);
    
    // Update total
    dailyReport.totalRevenue = dailyReport.transactions.reduce((sum, t) => sum + t.total, 0);
    dailyReport.transactionCount = dailyReport.transactions.length;
    
    // Simpan laporan
    await writeJSON(dailyReportFile, dailyReport);
    console.log(`[DAILY REPORT] Updated for ${today}`);
    
    // Update laporan bulanan
    await updateMonthlyReport(transaction);
    
    return dailyReport;
  } catch (error) {
    console.error('[DAILY REPORT ERROR]', error);
    throw error;
  }
};

// Update laporan bulanan
const updateMonthlyReport = async (transaction) => {
  const now = moment();
  const yearMonth = now.format('YYYY-MM');
  const monthlyReportFile = `reports/monthly/${yearMonth}`;
  
  try {
    // Baca laporan yang sudah ada atau buat baru jika belum ada
    let monthlyReport = await readJSON(monthlyReportFile);
    
    // Jika laporan kosong, inisialisasi
    if (!Array.isArray(monthlyReport) && !monthlyReport.transactions) {
      monthlyReport = {
        yearMonth,
        totalRevenue: 0,
        transactionCount: 0,
        topCustomers: [],
        popularItems: {},
        transactions: [] // Pastikan transactions diinisialisasi sebagai array
      };
    }

    // Pastikan transactions ada
    if (!monthlyReport.transactions) {
      monthlyReport.transactions = [];
    }
    
    // Tambahkan transaksi baru
    monthlyReport.transactions.push(transaction);
    
    // Update total pendapatan dan jumlah transaksi
    monthlyReport.totalRevenue = monthlyReport.transactions.reduce((sum, t) => sum + t.total, 0);
    monthlyReport.transactionCount = monthlyReport.transactions.length;
    
    // Update data pelanggan
    const customerSpending = {};
    for (const t of monthlyReport.transactions) {
      if (!customerSpending[t.buyer]) {
        customerSpending[t.buyer] = 0;
      }
      customerSpending[t.buyer] += t.total;
    }
    
    // Sortir pelanggan berdasarkan total belanja
    monthlyReport.topCustomers = Object.entries(customerSpending)
      .map(([customer, total]) => ({ customer, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    
    // Update data barang populer
    const itemCounts = {};
    for (const t of monthlyReport.transactions) {
      for (const item of t.items) {
        if (!itemCounts[item.id]) {
          itemCounts[item.id] = {
            id: item.id,
            name: item.name,
            quantity: 0
          };
        }
        itemCounts[item.id].quantity += item.qty;
      }
    }
    
    // Sortir barang berdasarkan jumlah terjual
    monthlyReport.popularItems = Object.values(itemCounts)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
    
    // Simpan laporan
    await writeJSON(monthlyReportFile, monthlyReport);
    console.log(`[MONTHLY REPORT] Updated for ${yearMonth}`);
    
    return monthlyReport;
  } catch (error) {
    console.error('[MONTHLY REPORT ERROR]', error);
    throw error;
  }
};

// Routes
app.get('/items/:id', apiKeyAuth, async (req, res) => {
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

app.post('/items', apiKeyAuth, async (req, res) => {
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
        category: req.body.category || 'Uncategorized', // Tambahkan kategori barang
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
  console.log('[CREATE SALE] Request body:', req.body);
  try {
    const { buyer, items: saleItems, paymentAmount } = req.body;

    // Validasi input
    if (!buyer || !saleItems || !Array.isArray(saleItems) || paymentAmount === undefined) {
      return res.status(400).json({ 
        status: false, 
        error: 'Invalid request format. Buyer, items, and paymentAmount are required.' 
      });
    }

    const date = moment();
    const salesFile = `sales-${date.format('YYYY-MM')}`;
    
    // Baca atau inisialisasi data penjualan
    let sales = await readJSON(salesFile);
    if (!Array.isArray(sales)) {
      sales = [];
    }

    // Proses transaksi
    const store = await readJSON('store');
    const purchaseId = await generatePurchaseID();
    
    const sale = {
      id: purchaseId,
      timestamp: date.toISOString(),
      cashier: store.cashier || 'Unknown',
      buyer,
      items: [],
      total: 0,
      paymentAmount: parseFloat(paymentAmount),
      change: 0
    };

    const allItems = await readJSON('items');
    
    // Proses setiap item
    for (const item of saleItems) {
      const product = allItems.find(p => p.id === item.id);
      if (!product) {
        return res.status(400).json({ status: false, error: `Item ${item.id} not found` });
      }
      
      if (product.stock < item.qty) {
        return res.status(400).json({ status: false, error: `Insufficient stock for ${product.name}` });
      }

      product.stock -= item.qty;
      const price = product.price * (1 - (product.discount/100));
      
      sale.items.push({
        id: item.id,
        name: product.name,
        qty: item.qty,
        price,
        total: item.qty * price
      });
      
      sale.total += item.qty * price;
    }

    // Validasi pembayaran
    if (sale.paymentAmount < sale.total) {
      return res.status(400).json({ 
        status: false, 
        error: `Insufficient payment. Total: ${sale.total}, Received: ${sale.paymentAmount}` 
      });
    }

    sale.change = sale.paymentAmount - sale.total;

    // Simpan data
    sales.push(sale);
    await Promise.all([
      writeJSON('items', allItems),
      writeJSON(salesFile, sales)
    ]);

    // Buat laporan
    await createDailyReport(sale);

    await logAction(req.user, `New sale: ${sale.id}`);
    res.status(201).json({ status: true, data: sale });
  } catch (error) {
    console.error('[CREATE SALE ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});
// Route untuk mendapatkan stok barang (diurutkan berdasarkan stok paling sedikit)
app.get('/stock', apiKeyAuth, async (req, res) => {
  console.log('[GET STOCK] Request received');
  try {
    const items = await readJSON('items');
    // Urutkan barang berdasarkan stok paling sedikit
    const sortedItems = items.sort((a, b) => a.stock - b.stock);
    res.json({ status: true, data: sortedItems });
  } catch (error) {
    console.error('[GET STOCK ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

// Route untuk mendapatkan stok barang berdasarkan kategori
app.get('/stock/category/:category', apiKeyAuth, async (req, res) => {
  const category = req.params.category;
  console.log(`[GET STOCK BY CATEGORY] Category: ${category}`);
  try {
    const items = await readJSON('items');
    // Filter barang berdasarkan kategori dan urutkan berdasarkan stok paling sedikit
    const filteredItems = items
      .filter(item => item.category && item.category.toLowerCase() === category.toLowerCase())
      .sort((a, b) => a.stock - b.stock);
    
    res.json({ status: true, data: filteredItems });
  } catch (error) {
    console.error('[GET STOCK BY CATEGORY ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

app.get('/reports/stock', apiKeyAuth, async (req, res) => {
  console.log('[REPORT STOCK] Request received');
  try {
    const items = await readJSON('items');
    // Urutkan barang berdasarkan stok paling sedikit
    const sortedItems = items.sort((a, b) => a.stock - b.stock);
    res.json({ status: true, data: sortedItems });
  } catch (error) {
    console.error('[REPORT STOCK ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

// Route untuk mendapatkan 10 barang populer
app.get('/popular-items', apiKeyAuth, async (req, res) => {
  console.log('[POPULAR ITEMS] Request received');
  try {
    const yearMonth = moment().format('YYYY-MM');
    const monthlyReportFile = `reports/monthly/${yearMonth}`;
    
    const monthlyReport = await readJSON(monthlyReportFile);
    
    if (!monthlyReport || !monthlyReport.popularItems) {
      return res.json({ status: true, data: [] });
    }
    
    res.json({ status: true, data: monthlyReport.popularItems });
  } catch (error) {
    console.error('[POPULAR ITEMS ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

// Route untuk mendapatkan 10 pelanggan teratas
app.get('/top-customers', apiKeyAuth, async (req, res) => {
  console.log('[TOP CUSTOMERS] Request received');
  try {
    const yearMonth = moment().format('YYYY-MM');
    const monthlyReportFile = `reports/monthly/${yearMonth}`;
    
    const monthlyReport = await readJSON(monthlyReportFile);
    
    if (!monthlyReport || !monthlyReport.topCustomers) {
      return res.json({ status: true, data: [] });
    }
    
    res.json({ status: true, data: monthlyReport.topCustomers });
  } catch (error) {
    console.error('[TOP CUSTOMERS ERROR]', error);
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
      .slice(0, 10) // Ubah dari 5 menjadi 10
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
      .slice(0, 10); // Ubah dari 5 menjadi 10

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

app.get('/reports/monthly-sales', apiKeyAuth, async (req, res) => {
  console.log('[REPORT MONTHLY SALES] Request received');
  try {
    const files = await fs.readdir(dataPath);
    const salesFiles = files.filter(f => f.startsWith('sales-') && f.endsWith('.json'));
    console.log(`[REPORT MONTHLY SALES] Found ${salesFiles.length} sales files`);

    const monthlySales = [];
    for (const file of salesFiles) {
      const match = file.match(/sales-(\d{4})-(\d{1,2})\.json/);
      if (!match) continue;

      const year = parseInt(match[1]);
      const month = parseInt(match[2]);
      const sales = await readJSON(path.parse(file).name);
      const total = sales.reduce((sum, sale) => sum + sale.total, 0);

      monthlySales.push({ year, month, total });
    }

    monthlySales.sort((a, b) => a.year - b.year || a.month - b.month);
    res.json({ status: true, data: monthlySales });
  } catch (error) {
    console.error('[REPORT MONTHLY SALES ERROR]', error);
    res.status(500).json({ status: false, error: error.message });
  }
});

// Endpoint untuk mendapatkan laporan harian
app.get('/reports/daily/:date', apiKeyAuth, async (req, res) => {
  const date = req.params.date; // Format YYYY-MM-DD
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

// Endpoint untuk mendapatkan laporan bulanan
app.get('/reports/monthly/:yearMonth', apiKeyAuth, async (req, res) => {
  const yearMonth = req.params.yearMonth; // Format YYYY-MM
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
    
    // Buat direktori untuk laporan
    await fs.mkdir(path.join(dataPath, 'reports/daily'), { recursive: true });
    console.log('[INIT] Created daily reports directory');
    await fs.mkdir(path.join(dataPath, 'reports/monthly'), { recursive: true });
    console.log('[INIT] Created monthly reports directory');

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
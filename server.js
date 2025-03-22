const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// Setup direktori database
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Path file JSON
const dbPaths = {
  items: path.join(dataDir, 'items.json'),
  sales: path.join(dataDir, 'sales.json'),
  settings: path.join(dataDir, 'settings.json')
};

// Fungsi bantu database
const readDB = (type) => {
  try {
    const data = fs.readFileSync(dbPaths[type], 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Buat file kosong jika tidak ditemukan
      const defaultValue = type === 'items' ? {} : type === 'sales' ? [] : { tax: 0.1 };
      writeDB(type, defaultValue);
      return defaultValue;
    }
    throw error;
  }
};

const writeDB = (type, data) => {
  fs.writeFileSync(dbPaths[type], JSON.stringify(data, null, 2));
};

// Inisialisasi database
let items = readDB('items');
let sales = readDB('sales');
let adminSettings = readDB('settings');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // Untuk serve file static

// Middleware admin
const isAdmin = (req, res, next) => {
  const adminSecret = req.headers['admin-secret'];
  if (adminSecret === 'rahasiaadmin') {
    next();
  } else {
    res.status(403).json({ error: 'Akses ditolak' });
  }
};

// Route utama untuk serve HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// CRUD Items
app.post('/items', isAdmin, (req, res) => {
  const { name, price, stock } = req.body;
  const id = uuidv4();
  items[id] = { id, name, price, stock: stock || 0 };
  writeDB('items', items);
  res.json(items[id]);
});

app.delete('/items/:id', isAdmin, (req, res) => {
  const { id } = req.params;
  if (!items[id]) return res.status(404).json({ error: 'Barang tidak ditemukan' });
  delete items[id];
  writeDB('items', items);
  res.json({ message: 'Barang berhasil dihapus' });
});

app.put('/items/:id/price', isAdmin, (req, res) => {
  const { id } = req.params;
  const { price } = req.body;
  if (!items[id]) return res.status(404).json({ error: 'Barang tidak ditemukan' });
  items[id].price = price;
  writeDB('items', items);
  res.json(items[id]);
});

// Laporan Penjualan
app.get('/sales', (req, res) => {
  const { month, year } = req.query;
  const filteredSales = sales.filter(sale => {
    const saleDate = new Date(sale.timestamp);
    return saleDate.getMonth() + 1 === Number(month) && 
           saleDate.getFullYear() === Number(year);
  });
  res.json(filteredSales);
});

// Sistem Stok
app.get('/stock', (req, res) => {
  const stockList = Object.values(items).map(({ id, name, stock }) => ({ id, name, stock }));
  res.json(stockList);
});

// Barang Populer
app.get('/popular', (req, res) => {
  const popularity = {};
  sales.forEach(sale => {
    sale.items.forEach(item => {
      popularity[item.id] = (popularity[item.id] || 0) + item.quantity;
    });
  });

  const popularItems = Object.entries(popularity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({
      item: items[id],
      totalSold: count
    }));

  res.json(popularItems);
});

// Transaksi Baru
app.post('/sales', (req, res) => {
  const { buyerName, items: saleItems } = req.body;
  const timestamp = new Date();

  // Validasi stok
  for (const item of saleItems) {
    const dbItem = items[item.id];
    if (!dbItem || dbItem.stock < item.quantity) {
      return res.status(400).json({ 
        error: `Stok ${dbItem?.name || 'unknown'} tidak cukup` 
      });
    }
  }

  // Update stok
  saleItems.forEach(item => {
    items[item.id].stock -= item.quantity;
  });
  writeDB('items', items);

  // Hitung total
  const total = saleItems.reduce((sum, item) => {
    return sum + (items[item.id].price * item.quantity);
  }, 0);

  // Tambah penjualan
  const newSale = {
    id: uuidv4(),
    buyerName,
    items: saleItems,
    total,
    timestamp,
  };

  sales.push(newSale);
  writeDB('sales', sales);
  res.json(newSale);
});

// Top Pembeli
app.get('/top-buyers', (req, res) => {
  const buyers = {};
  sales.forEach(sale => {
    buyers[sale.buyerName] = (buyers[sale.buyerName] || 0) + sale.total;
  });

  const topBuyers = Object.entries(buyers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, total]) => ({ name, total }));

  res.json(topBuyers);
});

// Menu Admin
app.get('/admin', isAdmin, (req, res) => {
  const adminReport = {
    totalItems: Object.keys(items).length,
    totalSales: sales.length,
    totalRevenue: sales.reduce((sum, sale) => sum + sale.total, 0),
    settings: adminSettings
  };
  res.json(adminReport);
});

// Update Settings Admin
app.put('/admin/settings', isAdmin, (req, res) => {
  adminSettings = { ...adminSettings, ...req.body };
  writeDB('settings', adminSettings);
  res.json(adminSettings);
});

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
  console.log(`File database disimpan di: ${dataDir}`);
});
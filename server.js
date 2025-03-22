const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs');
const path = require('path'); // Tambahkan modul path

const app = express();
const port = 9000;

// Setup direktori dan file database
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const paths = {
  items: path.join(dataDir, 'items.json'),
  sales: path.join(dataDir, 'sales.json'),
  settings: path.join(dataDir, 'settings.json')
};

// Fungsi bantu untuk baca/tulis file
const readJSON = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      fs.writeFileSync(file, JSON.stringify(file.includes('items') ? {} : []));
      return file.includes('items') ? {} : [];
    }
    throw e;
  }
};

const writeJSON = (file, data) => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

// Inisialisasi database
let items = readJSON(paths.items);
let sales = readJSON(paths.sales);
let adminSettings = Object.assign(
  { tax: 0.1 },
  readJSON(paths.settings)
);

app.use(cors());
app.use(bodyParser.json());

// Middleware admin
const isAdmin = (req, res, next) => {
  const adminSecret = req.headers['admin-secret'];
  if (adminSecret === 'rahasiaadmin') {
    next();
  } else {
    res.status(403).json({ error: 'Akses ditolak' });
  }
};

// Perbaikan route untuk serve file HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// CRUD Items
app.post('/items', isAdmin, (req, res) => {
  const { name, price, stock } = req.body;
  const id = uuidv4();
  items[id] = { id, name, price, stock: stock || 0 };
  writeJSON(paths.items, items);
  res.json(items[id]);
});

app.delete('/items/:id', isAdmin, (req, res) => {
  const { id } = req.params;
  if (!items[id]) return res.status(404).json({ error: 'Barang tidak ditemukan' });
  delete items[id];
  writeJSON(paths.items, items);
  res.json({ message: 'Barang berhasil dihapus' });
});

app.put('/items/:id/price', isAdmin, (req, res) => {
  const { id } = req.params;
  const { price } = req.body;
  if (!items[id]) return res.status(404).json({ error: 'Barang tidak ditemukan' });
  items[id].price = price;
  writeJSON(paths.items, items);
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

// Sistem stok
app.get('/stock', (req, res) => {
  res.json(Object.values(items).map(({ id, name, stock }) => ({ id, name, stock })));
});

// Transaksi baru
app.post('/sales', (req, res) => {
  const { buyerName, items: saleItems } = req.body;
  const timestamp = new Date();

  // Validasi stok
  for (const item of saleItems) {
    if (!items[item.id] || items[item.id].stock < item.quantity) {
      return res.status(400).json({ error: `Stok ${item.name} tidak cukup` });
    }
  }

  // Update stok dan catat penjualan
  saleItems.forEach(item => {
    items[item.id].stock -= item.quantity;
  });
  writeJSON(paths.items, items);

  const total = saleItems.reduce((sum, item) => sum + (items[item.id].price * item.quantity), 0);
  
  const sale = {
    id: uuidv4(),
    buyerName,
    items: saleItems,
    total,
    timestamp,
  };

  sales.push(sale);
  writeJSON(paths.sales, sales);
  res.json(sale);
});

// ... (tetap pertahankan route lainnya yang tidak disebutkan)

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});
// Top pembeli
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

// Menu admin
app.get('/admin', isAdmin, (req, res) => {
  res.json({
    totalItems: Object.keys(items).length,
    totalSales: sales.length,
    totalRevenue: sales.reduce((sum, sale) => sum + sale.total, 0),
    settings: adminSettings
  });
});

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});